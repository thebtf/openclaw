import { normalizeThinkLevel, type ThinkLevel } from "../../auto-reply/thinking.js";

function extractSupportedValues(raw: string): string[] {
  const match =
    raw.match(/supported values are:\s*([^\n.]+)/i) ?? raw.match(/supported values:\s*([^\n.]+)/i);
  if (!match?.[1]) {
    return [];
  }
  const fragment = match[1];
  const quoted = Array.from(fragment.matchAll(/['"]([^'"]+)['"]/g)).map((entry) =>
    entry[1]?.trim(),
  );
  if (quoted.length > 0) {
    return quoted.filter((entry): entry is string => Boolean(entry));
  }
  return fragment
    .split(/,|\band\b/gi)
    .map((entry) => entry.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, "").trim())
    .filter(Boolean);
}

export function pickFallbackThinkingLevel(params: {
  message?: string;
  attempted: Set<ThinkLevel>;
}): ThinkLevel | undefined {
  const raw = params.message?.trim();
  if (!raw) {
    return undefined;
  }

  // Try extracting explicit supported values (e.g. "Supported values are: 'low', 'medium', 'high'")
  const supported = extractSupportedValues(raw);
  if (supported.length > 0) {
    for (const entry of supported) {
      const normalized = normalizeThinkLevel(entry);
      if (!normalized) {
        continue;
      }
      if (params.attempted.has(normalized)) {
        continue;
      }
      return normalized;
    }
    return undefined;
  }

  // Handle "Budget N is invalid" errors from thinking-only models (e.g. Gemini 3.1-pro on AGM).
  // These models reject thinkingBudget: 0 or -1 but accept higher budgets via elevated thinking levels.
  if (/budget\b.*\binvalid/i.test(raw) || /invalid.*\bbudget/i.test(raw)) {
    const escalation: ThinkLevel[] = ["medium", "high"];
    for (const level of escalation) {
      if (!params.attempted.has(level)) {
        return level;
      }
    }
  }

  return undefined;
}
