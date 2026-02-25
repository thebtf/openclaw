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
