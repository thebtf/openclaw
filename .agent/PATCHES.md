# Fork Patch Registry

**Fork:** `github.com/thebtf/openclaw` → upstream: `github.com/openclaw/openclaw`

Patches are maintained as atomic commits on `main`, NOT as separate branches.
Previous approach (squashed branches + diff-apply) failed when upstream changed import paths.
Each patch is a single commit with `Fork patch:` in the message for traceability.

## Active Patches — On Main (committed, in build)

| Patch | Commit msg search | What it does | Status |
|-------|-------------------|-------------|--------|
| telegram-hook-pipeline | `feat(telegram): add message:received hook` | Adds `message:received` hook with `cancelled`/`cancelReason` to InternalHookEvent. Group-secretary depends on this. | ✅ Re-implemented |
| telegram-reply-to-incoming | `fix(telegram): reply to incoming user message` | Bot reply targets user's incoming message via `incomingMessageId` fallback. | ✅ Re-implemented |
| transcript-repair-no-retry | `fix(agents): instruct agent not to retry` | "DO NOT retry" text in synthetic error for lost tool results. | ✅ Re-implemented |
| suppress-reset-banner | `fix(auto-reply): suppress session-reset banner` | Suppress `✅ New session started` in group chats. | ✅ Re-implemented |
| google-payload-log | `src/agents/google-payload-log.ts` | Google provider payload logger (mirrors Anthropic). Standalone file. | ✅ Survived merge |

## Patches Needing Re-Implementation

| Patch | What it does | Why not done yet |
|-------|-------------|------------------|
| idle-watchdog-timeout | Replace wall-clock abort with idle watchdog (resets on activity) + hard cap timer. | Multi-file (9 files), needs study of new `run/attempt.ts` structure |
| gemini-invalid-argument-recovery | Auto-recover from Gemini INVALID_ARGUMENT errors, retry with cleaned params. | Needs study of new error handling in `pi-embedded-helpers/errors.ts` |
| pairing-privacy | Redact `provider/model` from user-facing error messages. | Needs new `redactModelIdentifiers()` function + integration points |
| minimax-tool-result-pairing | Enable tool_use/result pairing repair for MiniMax provider. | Needs study of `transcript-policy.ts` changes |
| bot-api-reset-detection | Auto-heal stale Telegram update offset after Bot API server restart. | Needs study of new `extensions/telegram/src/monitor.ts` |
| delivery-message-guard | Oversized messages → permanent error, caps subagent findings. | `delivery-queue.ts` restructured, need new integration point |

## Dropped Patches (upstream covers)

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
| fix/stop-kills-exec-processes | Code absorbed upstream, fork-only test removed |
| feat/announce-voice-conversion | Code already in upstream subagent-announce.ts |

## Dead Code Removed (2026-03-31)

9564 lines removed:
- `src/security/heimdall/` (28 files)
- `src/agents/proxy-model-cooldown.ts`
- `src/auto-reply/reply/commands-mesh.ts`, `commands-ptt.ts`
- `src/gateway/server-methods/mesh.ts`, `mesh.test.ts`
- `docs/heimdall/`
- `compact.txt`
- Various fork-only test files

## Lessons Learned

1. **Squashed branches + diff-apply breaks** when upstream changes import paths (e.g. `../../src/` → `openclaw/plugin-sdk/`). Diffs don't match.
2. **Atomic commits on main are more resilient** — they survive merges because git's 3-way merge handles them.
3. **Always verify patch content** after recreate — check diff lines ≠ pnpm-lock-only.
4. **Tag old approach deprecated** — `patch/*` tags are stale, branch approach abandoned.
