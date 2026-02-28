/**
 * Heimdall Security Layer — Tool ACL
 *
 * Blocklist model: everything is allowed by default, only explicitly
 * dangerous operations are denied for non-OWNER tiers.
 *
 * Evaluation order:
 *   1. OWNER bypass (always allowed, cannot be restricted by config)
 *   2. Normalize tool name via normalizeToolName
 *   3. Custom toolACL entries (glob-matched, first match wins)
 *   4. GUEST with "deny" policy → deny all
 *   5. Dangerous patterns → deny for non-OWNER
 *   6. Default → ALLOW
 *
 * Rationale: OpenClaw is a general-purpose agent by design. Heimdall
 * cannot enumerate all tools that should be allowed. Instead, it acts
 * as a "dangerous operations officer" — blocking exec, write, edit,
 * and destructive MCP patterns while allowing everything else.
 */

import { normalizeToolName } from "../../agents/tool-policy.js";
import type { HeimdallConfig, SenderTier } from "./types.js";
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
// Dangerous patterns (blocklist)
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

// ---------------------------------------------------------------------------
// Pre-compiled regexes for dangerous patterns
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
 * Blocklist model — rules (evaluated in order):
 * 1. OWNER → always `true` (hardcoded bypass, config cannot restrict).
 * 2. Normalize tool name.
 * 3. Custom `toolACL` — first matching glob wins; allow if tier is listed.
 * 4. GUEST + "deny" policy → deny all.
 * 5. Matches a dangerous pattern → deny.
 * 6. Default → ALLOW.
 */
export function isToolAllowed(
  toolName: string,
  senderTier: SenderTier,
  config: Pick<HeimdallConfig, "defaultGuestPolicy" | "toolACL">,
): boolean {
  // 1. OWNER bypass
  if (senderTier === SenderTierEnum.OWNER) {
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

  // 4. GUEST without explicit "read-only" policy → deny everything.
  // Fail-safe: undefined/missing policy defaults to deny for GUEST tier.
  if (senderTier === SenderTierEnum.GUEST && config.defaultGuestPolicy !== "read-only") {
    return false;
  }

  // 5. Dangerous patterns → deny for non-OWNER
  if (isDangerous(normalized)) {
    return false;
  }

  // 6. Default → ALLOW
  return true;
}
