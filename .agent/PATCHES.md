# Fork Patch Registry

**Fork:** `github.com/thebtf/openclaw` → upstream: `github.com/openclaw/openclaw`

All fork-specific patches live on named `feat/*` or `fix/*` branches rebased onto `upstream/main`.
Each has a corresponding `patch/<name>` git tag pointing to the branch tip.

## Active Patches (16)

| Branch                                 | Commits | Tag                                      | Description                                                                                                  |
| -------------------------------------- | ------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| feat/full-sticker-support              | 1       | patch/full-sticker-support               | Sticker thumbnails, cache, vision, set indexing (delivery.resolve-media needs re-apply on new transport API)  |
| feat/telegram-hook-pipeline            | 1       | patch/telegram-hook-pipeline             | Consolidated: message:received hook + event.cancelled + group prefilter                                      |
| feat/compaction-timeout-model-override | 1       | patch/compaction-timeout-model-override  | Compaction timeout + model override + diagnostic logging                                                     |
| feat/telegram-local-bot-api            | 1       | patch/telegram-local-bot-api             | Local Bot API server support: apiRoot + mediaApiBase + normalizeLocalFilePath                                 |
| feat/announce-voice-conversion         | 1       | patch/announce-voice-conversion          | Route subagent completion via LLM voice conversion instead of raw send                                       |
| feat/google-payload-log                | 1       | patch/google-payload-log                 | Add Google payload logger (mirrors Anthropic logger)                                                         |
| feat/idle-watchdog-timeout             | 2       | patch/idle-watchdog-timeout              | Replace wall-clock abort with idle watchdog + hard cap timeout                                               |
| fix/stop-kills-exec-processes          | 1       | patch/stop-kills-exec-processes          | /stop kills orphaned exec processes                                                                          |
| fix/gemini-invalid-argument-recovery   | 1       | patch/gemini-invalid-argument-recovery   | Auto-recover from Gemini INVALID_ARGUMENT errors                                                             |
| fix/transcript-repair-no-retry         | 1       | patch/transcript-repair-no-retry         | Don't retry lost tool results                                                                                |
| fix/pairing-privacy                    | 1       | patch/pairing-privacy                    | Redact model names from error messages                                                                       |
| fix/minimax-tool-result-pairing        | 1       | patch/minimax-tool-result-pairing        | Enable tool_use/result pairing repair for MiniMax                                                            |
| fix/suppress-reset-banner-in-groups    | 1       | patch/suppress-reset-banner-in-groups    | Suppress session-reset banner in group chats                                                                 |
| fix/telegram-reply-to-incoming         | 1       | patch/telegram-reply-to-incoming         | Reply to incoming user message instead of reply-chain target                                                  |
| fix/telegram-bot-api-reset-detection   | 1       | patch/telegram-bot-api-reset-detection   | Auto-heal stale update offset after Bot API server restart (probe on startup)                                |
| fix/delivery-message-guard             | 1       | patch/delivery-message-guard             | Treat oversized messages as permanent error + cap subagent findings                                          |

## Dropped Patches (merged upstream or obsolete)

| Branch                                 | Reason                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------- |
| fix/telegram-inbound-original-filename | Merged upstream                                                        |
| fix/pi-ai-gemini-thinking-patch        | pnpm patch obsolete — upstream fixed Gemini 3.1+ thinking detection    |
| fix/telegram-upstream-prs              | All PRs (#26229/#26264/#25988/#25390/#18072) merged upstream            |
| feat/heimdall-security                 | Disabled 2026-03-14: fundamental design flaw — gates tools by sender tier, breaks group chats (allowFrom never passed). Upstream applyOwnerOnlyToolPolicy + tool-policy-pipeline cover all use cases. 16 commits, largest fork divergence. |
| feat/heimdall-status-privacy           | Dropped with Heimdall — depended on Heimdall tier system for model/key redaction |
| feat/proxy-model-cooldown              | Upstream #2143/#2534 skip cooldowned providers — same functionality. Config: if edge cases appear, use `agents.defaults.failover` settings |
| feat/reasoning-default-config          | Upstream #22513 + #31227 — reasoning defaults + thinkingDefault adaptive. Config: `agents.defaults.thinkingDefault` if needed |
| fix/failover-invalid-argument          | Upstream #11972 RESOURCE_EXHAUSTED failover + #38301 overloaded failover — covers our early-abort + INVALID_ARGUMENT classification |
| fix/model-reasoning-false-override     | Upstream preserves user reasoning override when merging with built-in catalog — exact same fix |
| feat/compaction-guard-unresolved-tool-calls | Diff empty after upstream merge — upstream compaction changes likely subsume this guard |

## Spot-Check Commands

Run after upstream merge to verify all patches are present on `main`:

```bash
grep -n 'killProcessTree' src/auto-reply/reply/commands-session.ts             # stop-kills-exec
grep -n 'redactModelIdentifiers' src/agents/pi-embedded-helpers/errors.ts      # pairing-privacy
grep -n 'isGeminiInvalidArgument' src/auto-reply/reply/agent-runner-execution.ts  # gemini-recovery
grep -n 'model_cooldown' src/agents/pi-embedded-helpers/errors.ts              # model-cooldown
grep -rn 'message:received' src/telegram/bot-message.ts                        # message-received-hook
grep -n 'compactWithSafetyTimeout' src/agents/pi-embedded-runner/compact.ts    # compaction-timeout
ls src/telegram/sticker-cache.ts                                               # sticker-support
grep -n 'isCancelledEvent' src/telegram/bot-message.ts                         # hook-cancellation
grep -n 'getTelegramApiBase\|apiRoot' src/telegram/api-base.ts                 # telegram-local-bot-api
grep -n 'mediaApiBase' src/config/types.telegram.ts                            # telegram-local-bot-api
grep -n 'Bot API server reset detected' src/telegram/monitor.ts                # telegram-bot-api-reset-detection
grep -n 'completion direct announce' src/agents/subagent-announce.ts           # announce-voice-conversion
ls src/agents/google-payload-log.ts                                            # google-payload-log
grep -n 'OVERSIZED_MESSAGE_PERMANENT' src/infra/outbound/delivery-queue.ts     # delivery-message-guard
grep -n 'idleWatchdog\|hardCap' src/agents/pi-embedded-runner/run.ts           # idle-watchdog-timeout
```

## Tag Update Loop

Run after rebasing PR branches (Phase 5.5 of upstream update):

```bash
for branch in \
  feat/full-sticker-support \
  feat/telegram-hook-pipeline feat/compaction-timeout-model-override \
  feat/telegram-local-bot-api \
  feat/announce-voice-conversion feat/google-payload-log \
  feat/idle-watchdog-timeout \
  fix/stop-kills-exec-processes fix/minimax-tool-result-pairing \
  fix/transcript-repair-no-retry fix/pairing-privacy \
  fix/suppress-reset-banner-in-groups fix/telegram-reply-to-incoming \
  fix/gemini-invalid-argument-recovery \
  fix/telegram-bot-api-reset-detection \
  fix/delivery-message-guard; do
  tag="patch/${branch#*/}"
  git tag -f "$tag" "$branch"
  echo "Tagged $branch → $tag"
done
git push origin --tags --force
```

## Notes

- Update this file when patches are added or removed
- SKILL.md references this file for the canonical patch list
- Branches target `upstream/main` (for PRs); our `main` = upstream + all patches merged
- Known gap: `delivery.resolve-media.ts` missing animated/video sticker thumbnail fallback (6 tests failing)
