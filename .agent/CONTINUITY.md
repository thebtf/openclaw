# Continuity State

**Last Updated:** 2026-04-10
**Session:** Upstream update 2026.4.10 (5674 commits) + edit tool rewrite

## Done

- **Upstream update (2026-04-10):** 5674 commits merged from upstream/main, 3 conflicts resolved
- **edit-tool-flat-param-compat rewritten:** upstream refactored pi-tools.params.ts completely (new `REQUIRED_PARAM_GROUPS` + `hasValidEditReplacements` + `wrapToolParamValidation`). Our normalization re-integrated into new structure so flat Claude Code params (file_path/old_string/new_string) still work for 3rd party models (GPT-5, Qwen).
- **gemini-invalid-argument relocated:** upstream moved failover classification to `classifyFailoverClassificationFromMessage` — our isGeminiInvalidArgumentError check now lives there.
- **suppress-reset-banner DROPPED:** upstream removed reset banner entirely — our patch now obsolete.
- **pairing-privacy preserved:** redactProviderModelNames survived merge intact.
- **Config migration:** `channels.telegram.streaming` shape changed from `{mode: "block"}` to enum `"block"` — manually migrated.
- **pnpm exclusions:** added `discord-api-types` and `@types/node` to minimumReleaseAgeExclude.
- **Build OK + deployed + pushed** to origin/main.
- **Previous (2026-04-01):** Disk cleanup 96→54%, 9564 LOC dead code removed, 8 patches atomic commits.

## Active Fork Patches (8 total, on main)

1. telegram-hook-pipeline — message:received hook with cancellation
2. telegram-reply-to-incoming — incomingMessageId fallback
3. transcript-repair-no-retry — "DO NOT retry" in synthetic errors
4. google-payload-log — Google provider payload logger
5. gemini-invalid-argument — INVALID_ARGUMENT as retryable (relocated after upstream refactor)
6. pairing-privacy — redactProviderModelNames in errors
7. delivery-message-guard — oversized as permanent error
8. edit-tool-flat-param-compat — flat→edits[] normalization + schema relaxation

## Dropped (upstream now covers)

- suppress-reset-banner-in-groups — upstream removed reset banner completely (2026-04-10)

## Now

Gateway running PID 2551165 (2026-04-10 12:05). Telegram ok for both bots. Config version 2026.4.10. Agents: main (default), neuromancer, jeeves.

## Lessons Learned

- Upstream refactors (pi-tools.params.ts whole-file rewrite) require restructuring patches, not just conflict resolution. Merge conflicts only highlight 2-3 lines — you must read the whole file to understand the new architecture.
- Upstream config schema can change shape (e.g. `streaming: {mode: "block"}` → `"block"`). Doctor/health errors on startup reveal these; check openclaw.json validation before first deploy.
- pnpm minimumReleaseAge blocks fresh upstream deps — add to exclusion list pragmatically.
- `systemctl --user restart openclaw-gateway` is the reliable way to restart (not `openclaw gateway restart`).

## Next

- [ ] Verify edit tool works with GPT-5.4 (write something to Котуранский, check for no "Missing required" errors)
- [ ] Monitor Дживс heartbeat cycles — should respond with actual data or HEARTBEAT_OK now that edit tool works
- [ ] Consider upstream PR: `wrapToolParamValidation` should accept flat Claude Code params out of the box (not just pi-coding-agent format)

## Blockers
None.
