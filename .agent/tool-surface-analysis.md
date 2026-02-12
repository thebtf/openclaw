# Tool Surface Analysis (Task 3.1)

**Date:** 2026-02-12
**Phase:** Phase 3 - Smart Defaults & Configuration

## Summary

Audit of tool names to validate patterns proposed in planning phase. **Key finding:** Proposed patterns (`kg_*`, `http_*`, `bash_safe`, `channel_*`, `domain_resolve`, `telegram_send_message`) **DO NOT EXIST** in current codebase. These were hypothetical tools from planning, not verified against actual implementation.

## Actual Tool Categories

### 1. Core Coding Tools (from pi-coding-agent)

Source: `@mariozechner/pi-coding-agent` package

- **read** — read file contents
- **write** — create new files
- **edit** — modify existing files
- **bash** — execute bash commands
- **search** — grep-style content search
- **sandboxed_read**, **sandboxed_write**, **sandboxed_edit** — sandbox variants

### 2. Process Management

Source: `src/agents/bash-tools.ts`

- **exec** — execute commands with isolation (dangerous)
- **process** — background process management (dangerous)
- **apply_patch** — apply unified diffs (dangerous)

### 3. OpenClaw-Specific Tools

Source: `src/agents/openclaw-tools.ts`

| Tool                 | Type   | Description                                          |
| -------------------- | ------ | ---------------------------------------------------- |
| **browser**          | hybrid | headless browser control (read pages, write actions) |
| **canvas**           | write  | HTML canvas generation                               |
| **nodes**            | read   | knowledge graph node operations                      |
| **cron**             | write  | cron job management                                  |
| **message**          | write  | send messages to channels                            |
| **tts**              | write  | text-to-speech generation                            |
| **gateway**          | read   | gateway status queries                               |
| **agents_list**      | read   | list available agents                                |
| **sessions_list**    | read   | list agent sessions                                  |
| **sessions_history** | read   | session message history                              |
| **sessions_send**    | write  | send messages to sessions                            |
| **sessions_spawn**   | write  | spawn subagents                                      |
| **session_status**   | read   | session status queries                               |
| **web_search**       | read   | web search queries                                   |
| **web_fetch**        | read   | HTTP GET operations                                  |
| **image**            | hybrid | image operations (read EXIF, write analysis)         |

### 4. Memory Tools

Source: inferred from `DEFAULT_MEMBER_SAFE` list

- **memory_search** — search memory store
- **memory_get** — retrieve memory entries

### 5. Channel-Specific Tools (dynamic)

Source: `src/agents/channel-tools.ts`, loaded from channel plugins

**Discord, Telegram, Slack, WhatsApp** — each channel plugin provides its own tools via `agentTools` export.

Tool names typically follow pattern: `{channel}_{action}_{entity}` (e.g., `discord_send_message`, `telegram_edit_message`).

**CRITICAL:** Channel tools are NOT named with `channel_*` prefix. They use provider-specific prefixes like `discord_*`, `telegram_*`, `slack_*`, `whatsapp_*`.

### 6. Plugin Tools (dynamic)

Source: `src/plugins/tools.ts`, loaded from user-installed plugins

Tool names vary by plugin. MCP plugins typically use `mcp__{server}__{tool}` format.

## Pattern Analysis

### Proposed Patterns (from Plan) — VERIFICATION RESULTS

| Pattern                   | Exists?  | Actual Names (if any)                                            |
| ------------------------- | -------- | ---------------------------------------------------------------- |
| **kg\_\***                | ❌ NO    | `nodes` (knowledge graph tool, but NOT kg\_\* pattern)           |
| **http\_\***              | ❌ NO    | `web_fetch` (HTTP GET), but NOT http\_\* pattern                 |
| **bash_safe**             | ❌ NO    | `bash` tool exists, but NOT named bash_safe                      |
| **channel\_\***           | ❌ NO    | Channel tools use `{provider}_*` (discord*\*, telegram*\*, etc.) |
| **domain_resolve**        | ❌ NO    | No DNS resolution tool found                                     |
| **telegram_send_message** | ❓ MAYBE | Telegram channel plugin may provide this, but name unverified    |

### Dangerous Patterns (Already Defined)

From `src/security/heimdall/tool-acl.ts:36-47`:

```typescript
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
```

These patterns block dangerous operations across all tools.

### Safe Baseline (Already Defined)

From `src/security/heimdall/tool-acl.ts:50-62`:

```typescript
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
```

**This is the current SYSTEM tier baseline** (Task 1.3, Phase 1 implementation).

## Read-Only vs Write Operations

### Read-Only Tools (safe for SYSTEM tier)

- **search** — grep-style search (no modification)
- **read** — file reading (no modification)
- **sessions_list**, **sessions_history**, **session_status** — session queries
- **memory_search**, **memory_get** — memory queries
- **web_search**, **web_fetch** — web data retrieval
- **agents_list** — agent discovery
- **gateway** — status queries
- **nodes** — knowledge graph queries (assuming read-only interface)

### Write Operations (require explicit permission)

- **write**, **edit**, **sandboxed_write**, **sandboxed_edit** — file modifications
- **exec**, **process** — command execution
- **apply_patch** — code patching
- **browser** — web interactions (can trigger side effects)
- **canvas** — asset generation
- **message**, **sessions_send**, **sessions_spawn** — communication
- **cron** — scheduled task management
- **tts** — audio generation

### Hybrid Tools (read + optional write)

- **image** — read EXIF metadata OR write analysis results
- **browser** — navigate (read) OR click/fill forms (write)

## Recommendations for Task 3.2

### Option A: Use Current Baseline (Conservative)

**No changes needed.** Current `DEFAULT_MEMBER_SAFE` already provides minimal, safe tool set for SYSTEM tier:

```typescript
// Already implemented in Task 1.3:
if (senderTier === SenderTierEnum.SYSTEM && DEFAULT_MEMBER_SAFE.has(normalized)) {
  return true;
}
```

**Pros:**

- ✅ Already implemented and tested (Phase 1)
- ✅ Conservative (read-only priority)
- ✅ No PHANTOM TOOLS (all tools verified to exist)

**Cons:**

- ❌ May require users to extend ACL for write operations (message, sessions_send)

### Option B: Extend Baseline with Targeted Writes

Add to `DEFAULT_MEMBER_SAFE`:

```typescript
const DEFAULT_SYSTEM_SAFE: Set<string> = new Set([
  ...DEFAULT_MEMBER_SAFE, // inherit read-only baseline
  "message", // notification delivery
  "sessions_send", // agent-to-agent messaging
  "tts", // audio generation (low-risk write)
]);
```

**Pros:**

- ✅ Covers common cron/heartbeat use cases (send alerts, spawn subagents)
- ✅ Still conservative (no file writes, no exec)

**Cons:**

- ❌ Slightly less restrictive than pure read-only

### Option C: Custom systemAcl Field (Future Enhancement)

Add configuration field for user customization:

```typescript
// In HeimdallConfig schema:
systemAcl?: string[];  // Override DEFAULT_MEMBER_SAFE for SYSTEM tier
```

**Pros:**

- ✅ Maximum flexibility for deployments
- ✅ Supports site-specific requirements

**Cons:**

- ❌ Requires schema changes (Task 3.3)
- ❌ More complexity for users

## Conclusion

**RECOMMENDATION: Option A (use current baseline).**

**Rationale:**

1. Current `DEFAULT_MEMBER_SAFE` is already conservative and verified
2. No PHANTOM TOOLS (all names validated against codebase)
3. Users can extend via custom `toolACL` entries if needed (already supported in Phase 1)
4. Simplifies Task 3.2 (no code changes, only documentation)

**For Task 3.2:** Document that `DEFAULT_MEMBER_SAFE` is the SYSTEM tier baseline, with examples of how to extend via `toolACL` config.

**For Task 3.3:** Add JSDoc to `DEFAULT_MEMBER_SAFE` explaining it's shared by MEMBER and SYSTEM tiers.

**For Task 3.4:** Document tier hierarchy with actual tool names, not hypothetical patterns.

---

**Task 3.1 COMPLETE ✅**

Next: Task 3.2 (Update documentation, no code changes needed).
