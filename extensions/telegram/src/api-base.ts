const DEFAULT_API_ROOT = "https://api.telegram.org";

/**
 * Resolves the Telegram Bot API base URL.
 * Returns the configured apiRoot (trimmed, trailing slash removed), or the
 * default https://api.telegram.org if not set.
 */
export function getTelegramApiBase(apiRoot?: string): string {
  const trimmed = apiRoot?.trim();
  if (!trimmed) {
    return DEFAULT_API_ROOT;
  }
  return trimmed.replace(/\/+$/, "");
}

/**
 * Normalizes a file path returned by Telegram's getFile API for use in
 * download URLs.
 *
 * The cloud Bot API returns relative paths (e.g. "photos/file_3.jpg").
 * The local Bot API (without --local) returns token-prefixed relative paths
 * (e.g. "<TOKEN>/photos/file_8.jpg") — these MUST be kept as-is because
 * the token directory is part of the on-disk layout and nginx routes via it.
 * The local Bot API (--local mode) returns absolute filesystem paths
 * (e.g. "/var/lib/telegram-bot-api/<TOKEN>/photos/file_3.jpg").
 *
 * Only absolute paths are normalized: we strip everything up to and including
 * the `/<token>/` directory segment.  Relative paths (with or without a token
 * prefix) are returned unchanged.
 */
export function normalizeLocalFilePath(filePath: string, token: string): string {
  if (!filePath.startsWith("/")) {
    return filePath;
  }
  // Absolute path with /<token>/ directory segment (local Bot API --local mode):
  // "/var/lib/telegram-bot-api/<token>/photos/file_3.jpg" → "<token>/photos/file_3.jpg"
  // We keep the token directory because the download URL is
  // /file/bot<TOKEN>/<token>/photos/file_3.jpg and nginx alias maps $1 to disk.
  const marker = `/${token}/`;
  const idx = filePath.indexOf(marker);
  if (idx !== -1) {
    return filePath.slice(idx + 1); // keep "<token>/photos/..." (strip only the data-dir prefix)
  }
  // Token not found — fall back to stripping leading slashes.
  return filePath.replace(/^\/+/, "");
}
