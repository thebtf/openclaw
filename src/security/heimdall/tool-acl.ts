/**
 * Heimdall Security Layer — Tool ACL
 *
 * Determines whether a given tool is allowed for a specific sender tier.
 * Evaluation order:
 *   1. OWNER bypass (always allowed, cannot be restricted by config)
 *   2. Normalize tool name via normalizeToolName
 *   3. Custom toolACL entries (glob-matched, first match wins)
 *   4. Default rules: dangerous patterns → deny; safe lists → allow; else deny
 */

import type { HeimdallConfig, SenderTier } from "./types.js";
import { normalizeToolName } from "../../agents/tool-policy.js";
import { SenderTier as SenderTierEnum } from "./types.js";

// ---------------------------------------------------------------------------
// Glob helper
// ---------------------------------------------------------------------------

/**
 * Convert a glob pattern (with `*` wildcards) to a RegExp.
 * `*` matches any sequence of characters (including none).
 * All other regex-special characters are escaped.
 */
export function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^]*");
  return new RegExp(`^${escaped}$`);
}

// ---------------------------------------------------------------------------
// Built-in tool lists
// ---------------------------------------------------------------------------

/** Dangerous tools — only OWNER may invoke these by default. */
const DEFAULT_DANGEROUS_PATTERNS: string[] = [
  "exec",
  "process",
  "apply_patch",
  "write",
  "edit",
  "sandboxed_write",
  "sandboxed_edit",
  "mcp__*__execute_*",
  "mcp__*__write_*",
  "mcp__*__delete_*",
];

/** Tools considered safe for MEMBER tier by default (read-only / low-risk). */
const DEFAULT_MEMBER_SAFE: Set<string> = new Set([
  "search",
  "read",
  "sessions_list",
  "sessions_history",
  "session_status",
  "image",
  "memory_search",
  "memory_get",
  "web_search",
  "web_fetch",
  "agents_list",
]);

/** Read-only tools available to GUEST when defaultGuestPolicy is "read-only". */
const GUEST_READ_ONLY: Set<string> = new Set([
  "search",
  "read",
  "sessions_list",
  "sessions_history",
  "session_status",
  "image",
  "memory_search",
]);

// ---------------------------------------------------------------------------
// Pre-compiled regexes for default dangerous patterns
// ---------------------------------------------------------------------------

const DANGEROUS_REGEXES: RegExp[] = DEFAULT_DANGEROUS_PATTERNS.map(globToRegex);

// ---------------------------------------------------------------------------
// Core check
// ---------------------------------------------------------------------------

/** Cache for compiled ACL glob patterns — config doesn't change at runtime. */
const aclPatternCache = new Map<string, RegExp>();

function matchesPattern(toolName: string, pattern: string): boolean {
  let re = aclPatternCache.get(pattern);
  if (!re) {
    re = globToRegex(pattern);
    aclPatternCache.set(pattern, re);
  }
  return re.test(toolName);
}

function isDangerous(toolName: string): boolean {
  return DANGEROUS_REGEXES.some((re) => re.test(toolName));
}

/**
 * Check whether `toolName` is allowed for `senderTier` under the given config.
 *
 * Rules (evaluated in order):
 * 1. OWNER or SYSTEM → always `true` (hardcoded bypass).
 *    SYSTEM tier = isTrustedInternal (cron, heartbeat, CLI) — the runtime
 *    must not be locked out of its own tools.
 * 2. Normalize tool name.
 * 3. Custom `toolACL` — first matching glob wins; allow if tier is listed.
 * 4. Defaults:
 *    a. Matches a dangerous pattern → deny.
 *    b. MEMBER + tool in MEMBER safe list → allow.
 *    c. GUEST + "read-only" policy + tool in read-only list → allow.
 *    d. Otherwise → deny.
 *
 * @example Extend SYSTEM tier baseline
 * ```typescript
 * // In heimdall config:
 * toolACL: [
 *   {
 *     pattern: "message",  // Allow notifications
 *     allowedTiers: ["system", "member", "owner"],
 *   },
 * ]
 * ```
 */
export function isToolAllowed(
  toolName: string,
  senderTier: SenderTier,
  config: Pick<HeimdallConfig, "defaultGuestPolicy" | "toolACL">,
): boolean {
  // 1. OWNER / SYSTEM bypass — SYSTEM tier comes from isTrustedInternal
  // (cron, heartbeat, CLI) and has already been authenticated at the code-path
  // level.  Restricting the runtime from its own tools is counterproductive.
  if (senderTier === SenderTierEnum.OWNER || senderTier === SenderTierEnum.SYSTEM) {
    return true;
  }

  // 2. Normalize
  const normalized = normalizeToolName(toolName);

  // 3. Custom ACL — first matching entry wins
  if (config.toolACL && config.toolACL.length > 0) {
    for (const entry of config.toolACL) {
      if (matchesPattern(normalized, entry.pattern)) {
        return entry.allowedTiers.includes(senderTier);
      }
    }
  }

  // 4a. Dangerous patterns → deny non-OWNER/SYSTEM
  if (isDangerous(normalized)) {
    return false;
  }

  // 4b. MEMBER safe list
  if (senderTier === SenderTierEnum.MEMBER && DEFAULT_MEMBER_SAFE.has(normalized)) {
    return true;
  }

  // 4d. GUEST read-only policy
  if (
    senderTier === SenderTierEnum.GUEST &&
    config.defaultGuestPolicy === "read-only" &&
    GUEST_READ_ONLY.has(normalized)
  ) {
    return true;
  }

  // 4e. Default deny
  return false;
}
