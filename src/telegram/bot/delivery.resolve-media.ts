import { GrammyError } from "grammy";
import { logVerbose, warn } from "../../globals.js";
import { formatErrorMessage } from "../../infra/errors.js";
import { retryAsync } from "../../infra/retry.js";
import { fetchRemoteMedia } from "../../media/fetch.js";
import { saveMediaBuffer } from "../../media/store.js";
import { getTelegramApiBase } from "../api-base.js";
import { cacheSticker, getCachedSticker } from "../sticker-cache.js";
import { resolveTelegramMediaPlaceholder } from "./helpers.js";
import type { StickerMetadata, TelegramContext } from "./types.js";

const FILE_TOO_BIG_RE = /file is too big/i;
const TELEGRAM_MEDIA_SSRF_POLICY = {
  // Telegram file downloads should trust api.telegram.org even when DNS/proxy
  // resolution maps to private/internal ranges in restricted networks.
  allowedHostnames: ["api.telegram.org"],
  allowRfc2544BenchmarkRange: true,
};

/**
 * Returns true if the error is Telegram's "file is too big" error.
 * This happens when trying to download files >20MB via the Bot API.
 * Unlike network errors, this is a permanent error and should not be retried.
 */
function isFileTooBigError(err: unknown): boolean {
  if (err instanceof GrammyError) {
    return FILE_TOO_BIG_RE.test(err.description);
  }
  return FILE_TOO_BIG_RE.test(formatErrorMessage(err));
}

/**
 * Returns true if the error is a transient network error that should be retried.
 * Returns false for permanent errors like "file is too big" (400 Bad Request).
 */
function isRetryableGetFileError(err: unknown): boolean {
  // Don't retry "file is too big" - it's a permanent 400 error
  if (isFileTooBigError(err)) {
    return false;
  }
  // Retry all other errors (network issues, timeouts, etc.)
  return true;
}

function resolveMediaFileRef(msg: TelegramContext["message"]) {
  return (
    msg.photo?.[msg.photo.length - 1] ??
    msg.video ??
    msg.video_note ??
    msg.document ??
    msg.audio ??
    msg.voice
  );
}

function resolveTelegramFileName(msg: TelegramContext["message"]): string | undefined {
  return (
    msg.document?.file_name ??
    msg.audio?.file_name ??
    msg.video?.file_name ??
    msg.animation?.file_name
  );
}

async function resolveTelegramFileWithRetry(
  ctx: TelegramContext,
): Promise<{ file_path?: string } | null> {
  try {
    return await retryAsync(() => ctx.getFile(), {
      attempts: 3,
      minDelayMs: 1000,
      maxDelayMs: 4000,
      jitter: 0.2,
      label: "telegram:getFile",
      shouldRetry: isRetryableGetFileError,
      onRetry: ({ attempt, maxAttempts }) =>
        logVerbose(`telegram: getFile retry ${attempt}/${maxAttempts}`),
    });
  } catch (err) {
    // Handle "file is too big" separately - Telegram Bot API has a 20MB download limit
    if (isFileTooBigError(err)) {
      logVerbose(
        warn(
          "telegram: getFile failed - file exceeds Telegram Bot API 20MB limit; skipping attachment",
        ),
      );
      return null;
    }
    // All retries exhausted — return null so the message still reaches the agent
    // with a type-based placeholder (e.g. <media:audio>) instead of being dropped.
    logVerbose(`telegram: getFile failed after retries: ${String(err)}`);
    return null;
  }
}

function resolveRequiredFetchImpl(fetchImpl?: typeof fetch): typeof fetch {
  const resolved = fetchImpl ?? globalThis.fetch;
  if (!resolved) {
    throw new Error("fetch is not available; set channels.telegram.proxy in config");
  }
  return resolved;
}

function resolveOptionalFetchImpl(fetchImpl?: typeof fetch): typeof fetch | null {
  try {
    return resolveRequiredFetchImpl(fetchImpl);
  } catch {
    return null;
  }
}

/** Build SSRF policy that includes a custom API hostname when apiRoot is set. */
function resolveSsrfPolicy(apiRoot?: string) {
  const trimmed = apiRoot?.trim();
  if (!trimmed) {
    return TELEGRAM_MEDIA_SSRF_POLICY;
  }
  return {
    ...TELEGRAM_MEDIA_SSRF_POLICY,
    allowedHostnames: [
      ...TELEGRAM_MEDIA_SSRF_POLICY.allowedHostnames,
      new URL(getTelegramApiBase(apiRoot)).hostname,
    ],
  };
}

/** Default idle timeout for Telegram media downloads (30 seconds). */
const TELEGRAM_DOWNLOAD_IDLE_TIMEOUT_MS = 30_000;

async function downloadAndSaveTelegramFile(params: {
  filePath: string;
  token: string;
  fetchImpl: typeof fetch;
  maxBytes: number;
  telegramFileName?: string;
  apiRoot?: string;
}) {
  const base = getTelegramApiBase(params.apiRoot);
  const url = `${base}/file/bot${params.token}/${params.filePath}`;
  const fetched = await fetchRemoteMedia({
    url,
    fetchImpl: params.fetchImpl,
    filePathHint: params.filePath,
    maxBytes: params.maxBytes,
    readIdleTimeoutMs: TELEGRAM_DOWNLOAD_IDLE_TIMEOUT_MS,
    ssrfPolicy: resolveSsrfPolicy(params.apiRoot),
  });
  const originalName = params.telegramFileName ?? fetched.fileName ?? params.filePath;
  return saveMediaBuffer(
    fetched.buffer,
    fetched.contentType,
    "inbound",
    params.maxBytes,
    originalName,
  );
}

/**
 * Download the static thumbnail for an animated/video sticker.
 * Returns saved file info or null if no thumbnail is available.
 */
async function downloadStickerThumbnail(
  sticker: { thumbnail?: { file_id: string }; is_video?: boolean; is_animated?: boolean },
  token: string,
  fetchImpl: typeof fetch,
  maxBytes: number,
  apiRoot?: string,
): Promise<{ path: string; contentType?: string } | null> {
  const thumb = sticker.thumbnail;
  if (!thumb?.file_id) {
    return null;
  }
  const base = getTelegramApiBase(apiRoot);
  try {
    const getFileUrl = `${base}/bot${token}/getFile?file_id=${thumb.file_id}`;
    const getFileRes = await fetchImpl(getFileUrl);
    if (!getFileRes.ok) {
      logVerbose(`telegram: getFile for thumbnail failed: ${getFileRes.status}`);
      return null;
    }
    const getFileData = (await getFileRes.json()) as {
      ok: boolean;
      result?: { file_path?: string };
    };
    const filePath = getFileData.result?.file_path;
    if (!filePath) {
      logVerbose("telegram: getFile for thumbnail returned no file_path");
      return null;
    }
    const url = `${base}/file/bot${token}/${filePath}`;
    const fetched = await fetchRemoteMedia({ url, fetchImpl, filePathHint: filePath });
    const originalName = fetched.fileName ?? filePath;
    return await saveMediaBuffer(
      fetched.buffer,
      fetched.contentType,
      "inbound",
      maxBytes,
      originalName,
    );
  } catch (err) {
    logVerbose(`telegram: failed to download sticker thumbnail: ${String(err)}`);
    return null;
  }
}

async function resolveStickerMedia(params: {
  msg: TelegramContext["message"];
  ctx: TelegramContext;
  maxBytes: number;
  token: string;
  fetchImpl?: typeof fetch;
  apiRoot?: string;
}): Promise<
  | {
      path: string;
      contentType?: string;
      placeholder: string;
      stickerMetadata?: StickerMetadata;
    }
  | null
  | undefined
> {
  const { msg, ctx, maxBytes, token, fetchImpl, apiRoot } = params;
  if (!msg.sticker) {
    return undefined;
  }
  const sticker = msg.sticker;
  if (!sticker.file_id) {
    return null;
  }

  const isNonStatic = Boolean(sticker.is_animated || sticker.is_video);

  // Check sticker cache first (applies to all sticker types)
  const cached = sticker.file_unique_id ? getCachedSticker(sticker.file_unique_id) : null;

  try {
    const resolvedFetchImpl = resolveOptionalFetchImpl(fetchImpl);
    if (!resolvedFetchImpl) {
      logVerbose("telegram: fetch not available for sticker download");
      return null;
    }
    let saved: { path: string; contentType?: string } | null = null;

    if (isNonStatic) {
      // Animated/video stickers: download the static thumbnail
      const thumbResult = await downloadStickerThumbnail(
        sticker,
        token,
        resolvedFetchImpl,
        maxBytes,
        apiRoot,
      );
      if (thumbResult) {
        saved = thumbResult;
      } else if (cached) {
        // No thumbnail available but we have a cached description — still useful
        logVerbose(
          `telegram: no thumbnail for ${sticker.is_video ? "video" : "animated"} sticker, using cache`,
        );
      } else {
        logVerbose(
          `telegram: no thumbnail and no cache for ${sticker.is_video ? "video" : "animated"} sticker; skipping`,
        );
        return null;
      }
    } else {
      // Static WEBP stickers: download the full file (existing behavior)
      const file = await resolveTelegramFileWithRetry(ctx);
      if (!file?.file_path) {
        logVerbose("telegram: getFile returned no file_path for sticker");
        return null;
      }
      saved = await downloadAndSaveTelegramFile({
        filePath: file.file_path,
        token,
        fetchImpl: resolvedFetchImpl,
        maxBytes,
        apiRoot,
      });
    }

    if (cached) {
      logVerbose(`telegram: sticker cache hit for ${sticker.file_unique_id}`);
      const fileId = sticker.file_id ?? cached.fileId;
      const emoji = sticker.emoji ?? cached.emoji;
      const setName = sticker.set_name ?? cached.setName;
      if (fileId !== cached.fileId || emoji !== cached.emoji || setName !== cached.setName) {
        cacheSticker({
          ...cached,
          fileId,
          emoji,
          setName,
        });
      }
      return {
        path: saved?.path ?? "",
        contentType: saved?.contentType,
        placeholder: "<media:sticker>",
        stickerMetadata: {
          emoji,
          setName,
          fileId,
          fileUniqueId: sticker.file_unique_id,
          cachedDescription: cached.description,
          isVideo: sticker.is_video || undefined,
          isAnimated: sticker.is_animated || undefined,
        },
      };
    }

    // Cache miss — return metadata for vision processing
    if (!saved) {
      return null;
    }
    return {
      path: saved.path,
      contentType: saved.contentType,
      placeholder: "<media:sticker>",
      stickerMetadata: {
        emoji: sticker.emoji ?? undefined,
        setName: sticker.set_name ?? undefined,
        fileId: sticker.file_id,
        fileUniqueId: sticker.file_unique_id,
        isVideo: sticker.is_video || undefined,
        isAnimated: sticker.is_animated || undefined,
      },
    };
  } catch (err) {
    logVerbose(`telegram: failed to process sticker: ${String(err)}`);
    return null;
  }
}

export async function resolveMedia(
  ctx: TelegramContext,
  maxBytes: number,
  token: string,
  fetchImpl?: typeof fetch,
  apiRoot?: string,
): Promise<{
  path: string;
  contentType?: string;
  placeholder: string;
  stickerMetadata?: StickerMetadata;
} | null> {
  const msg = ctx.message;
  const stickerResolved = await resolveStickerMedia({
    msg,
    ctx,
    maxBytes,
    token,
    fetchImpl,
    apiRoot,
  });
  if (stickerResolved !== undefined) {
    return stickerResolved;
  }

  const m = resolveMediaFileRef(msg);
  if (!m?.file_id) {
    return null;
  }

  const file = await resolveTelegramFileWithRetry(ctx);
  if (!file) {
    return null;
  }
  if (!file.file_path) {
    throw new Error("Telegram getFile returned no file_path");
  }
  const saved = await downloadAndSaveTelegramFile({
    filePath: file.file_path,
    token,
    fetchImpl: resolveRequiredFetchImpl(fetchImpl),
    maxBytes,
    telegramFileName: resolveTelegramFileName(msg),
    apiRoot,
  });
  const placeholder = resolveTelegramMediaPlaceholder(msg) ?? "<media:document>";
  return { path: saved.path, contentType: saved.contentType, placeholder };
}
