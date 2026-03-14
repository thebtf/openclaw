/**
 * In-memory cache for Telegram forum topic names.
 *
 * Telegram delivers topic names only via forum_topic_created service messages.
 * We intercept them and cache chatId:threadId → name so subsequent messages
 * in the same topic can report a human-readable ThreadLabel to the agent.
 *
 * Cache is process-scoped (lost on restart). Degrades gracefully: if name is
 * not cached, ThreadLabel falls back to the numeric thread ID.
 */

const cache = new Map<string, string>();

function key(chatId: number, threadId: number): string {
  return `${chatId}:${threadId}`;
}

export function cacheForumTopicName(chatId: number, threadId: number, name: string): void {
  cache.set(key(chatId, threadId), name);
}

export function resolveForumTopicName(chatId: number, threadId: number): string | undefined {
  return cache.get(key(chatId, threadId));
}
