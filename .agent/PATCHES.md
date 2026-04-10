# Fork Patch Registry

**Fork:** `github.com/thebtf/openclaw` → upstream: `github.com/openclaw/openclaw`

Patches are maintained as atomic commits on `main`, NOT as separate branches.
Each patch is a single commit with `Fork patch:` in the message for traceability.

## Active Patches — On Main (1 total)

| Patch | What it does (problem it solves) | Why upstream doesn't solve it |
|-------|----------------------------------|-------------------------------|
| **edit-tool-flat-param-compat** | Normalize flat Claude Code edit params `{file_path, old_string, new_string}` to pi-coding-agent's nested `{path, edits: [{oldText, newText}]}`. Also relaxes the tool schema so AJV validation in pi-agent-core doesn't reject flat params before normalization. | Upstream expects models to read tool schemas correctly. Real Anthropic Claude does. 3rd party models (GPT-5 via unleashed, Qwen via litellm) memorized Claude Code flat conventions and ignore the schema. Only alternative is switching to real Anthropic API. |

## Configuration Changes (alternatives to dropped patches)

| Config key | Value | Replaces patch |
|------------|-------|----------------|
| `tools.loopDetection.enabled` | `true` | transcript-repair-no-retry — upstream's loop detector is stricter and model-independent |

## Patches Dropped in 2026-04-10 Review

Deep review against upstream 2026.4.10 — each patch evaluated by what problem it solves, not code diff.

| Patch | What it did | Why dropped |
|-------|-------------|-------------|
| google-payload-log | Debug logger for Gemini request/usage payloads | **Dead code** — 185 LOC never integrated into attempt.ts. Upstream added anthropic-payload-log analog but not google. |
| telegram-hook-pipeline | `message:received` hook with cancellation for group-secretary | User has new design ideas for group-secretary — current patch obsolete |
| telegram-reply-to-incoming | Telegram bot replies to user's incoming message | **Upstream handles better** via `applyReplyThreading` + `implicitReplyToId` in `reply-payloads-base.ts` — channel-agnostic, works for all channels |
| transcript-repair-no-retry | "DO NOT retry" text in synthetic error for lost tool results | **Upstream has proper solution**: `tool-loop-detection.ts` with generic_repeat, global_circuit_breaker (30 calls), ping_pong. Enabling `tools.loopDetection.enabled=true` is the right fix. |
| gemini-invalid-argument | Classify all Gemini INVALID_ARGUMENT as retryable timeout | **Upstream is more correct**: narrowly handles INVALID_ARGUMENT + "maximum number of tokens" (context overflow) as retryable. Other INVALID_ARGUMENT = genuine validation bugs, fail-fast is correct. Our patch would hide real bugs. Not fired in 14+ days. |
| pairing-privacy | Redact `unleashed-*/gpt-5.4` from user-facing errors | Low UX value, over-redaction risk (regex ловит любой текст с "gpt"/"claude"). Narrow application (only rate limit errors). Upstream's `redactSensitiveText` handles real secrets. |
| delivery-message-guard | Add oversize patterns to permanent-error list | **Upstream solves via chunking**: `markdownToTelegramHtmlChunks` splits text at 4096 chars before delivery queue. Not fired in 30+ days. |
| suppress-reset-banner | Suppress `✅ New session started` banner in group chats | **Upstream removed banner entirely** (2026-04-10 merge) |

## Historically Dropped Patches (earlier reviews)

| Patch | Reason |
|-------|--------|
| feat/heimdall-security (16 commits) | Disabled — upstream applyOwnerOnlyToolPolicy + tool-policy-pipeline |
| feat/heimdall-status-privacy | Depended on Heimdall |
| feat/proxy-model-cooldown | Upstream #2143/#2534 |
| feat/reasoning-default-config | Upstream #22513/#31227 |
| fix/failover-invalid-argument | Upstream #11972/#38301 |
| fix/model-reasoning-false-override | Upstream preserves reasoning override |
| feat/compaction-guard-unresolved-tool-calls | Diff empty after merge |
| feat/full-sticker-support | Upstream has describeStickerImage + cacheSticker |
| feat/compaction-timeout-model-override | Upstream has compactWithSafetyTimeout + overrideModel |
| feat/telegram-local-bot-api | Upstream #48842 added apiRoot + resolveTelegramApiBase |
| fix/stop-kills-exec-processes | Code absorbed upstream |
| feat/announce-voice-conversion | Code already in upstream subagent-announce.ts |
| feat/idle-watchdog-timeout | Upstream has idleTimeoutSeconds + runTimeoutSeconds |
| fix/minimax-tool-result-pairing | Upstream repairToolUseResultPairing=true for ALL providers |
| fix/telegram-bot-api-reset-detection | Upstream confirmPersistedOffset() probes on startup |

## Review Methodology

Each patch evaluated by:
1. **What problem does it solve?** (not code diff)
2. **Does upstream solve the same problem?** (possibly differently)
3. **Is upstream's solution better/worse/equivalent?**
4. **Has our patch fired in production recently?** (log evidence)

Drop when: upstream solves better, patch is dead code, or problem no longer exists.
