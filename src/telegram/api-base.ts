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
 * The local Bot API (--local mode) returns absolute filesystem paths
 * (e.g. "/var/lib/telegram-bot-api/<TOKEN>/photos/file_3.jpg").
 *
 * For local paths we strip everything up to and including the `/<token>/`
 * directory segment so the resulting relative path can be appended to
 * `.../file/bot<TOKEN>/` to form a valid download URL.
 */
export function normalizeLocalFilePath(filePath: string, token: string): string {
  if (!filePath.startsWith("/")) {
    return filePath;
  }
  // Look for /<token>/ as a directory boundary in the absolute path.
  const marker = `/${token}/`;
  const idx = filePath.indexOf(marker);
  if (idx !== -1) {
    return filePath.slice(idx + marker.length);
  }
  // Token not found — fall back to stripping leading slashes.
  return filePath.replace(/^\/+/, "");
}
