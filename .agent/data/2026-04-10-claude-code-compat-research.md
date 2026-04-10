# Claude Code Edit Tool Compat — Research

**Date:** 2026-04-10
**Context:** Investigation of how to support 3rd party models (GPT-5, Qwen, etc.) that emit Claude Code flat edit params `{file_path, old_string, new_string}` instead of pi-coding-agent's `{path, edits: [{oldText, newText}]}`.

## Problem Statement

OpenClaw advertises multi-provider support (Anthropic, OpenAI, Google, Ollama, local, etc.). The `edit` tool (from `@mariozechner/pi-coding-agent`) defines its schema as:

```typescript
{
  path: string;
  edits: Array<{ oldText: string; newText: string }>;
}
```

Real Anthropic Claude models read the schema correctly and emit matching args. However, 3rd party models trained on Claude Code conventions (GPT-5 via OpenAI-compat endpoints, Qwen distilled from Claude) memorize the Claude Code CLI flat format and **ignore the actual tool schema**:

```typescript
{
  file_path: string;
  old_string: string;
  new_string: string;
}
```

Result: AJV validation in pi-agent-core rejects the args before they reach `tool.execute()`, the agent loops trying the same broken call, and users experience tools that "don't work" with their models.

## Verified Against Current Upstream (2026.4.10)

### Upstream Architecture

pi-agent-core's `agent-loop.js` runs this sequence for each tool call:

```javascript
const preparedToolCall = prepareToolCallArguments(tool, toolCall);
const validatedArgs = validateToolArguments(tool, preparedToolCall);
if (config.beforeToolCall) {
  const beforeResult = await config.beforeToolCall({ args: validatedArgs, ... });
}
// ... eventually tool.execute(validatedArgs)
```

Key findings:

1. **`tool.prepareArguments(args)` — NEW hook** (didn't exist in earlier versions). Runs BEFORE validation. Signature:
   ```typescript
   prepareArguments?: (args: unknown) => Static<TParameters>
   ```

2. **pi-coding-agent's edit tool already uses it** (`prepareEditArguments`):
   ```javascript
   function prepareEditArguments(input) {
     if (!input || typeof input !== "object") return input;
     const args = input;
     if (typeof args.oldText !== "string" || typeof args.newText !== "string") return input;
     const edits = Array.isArray(args.edits) ? [...args.edits] : [];
     edits.push({ oldText: args.oldText, newText: args.newText });
     const { oldText: _oldText, newText: _newText, ...rest } = args;
     return { ...rest, edits };
   }
   ```

   This handles flat `{oldText, newText}` → `{edits: [{oldText, newText}]}` **automatically**.

3. **Gap**: upstream's `prepareEditArguments` only checks `args.oldText`/`args.newText`. It does NOT handle Claude Code aliases (`args.old_string`, `args.new_string`, `args.file_path`). Models that emit the Claude Code format still fail validation.

### Alternative Extension Points Evaluated

| Hook | When | Can rewrite args? | Suitable? |
|------|------|-------------------|-----------|
| `tool.prepareArguments` (direct) | BEFORE validation | Yes | ✅ **Yes — cleanest** |
| `normalizeToolSchemas` (plugin, per-provider) | At tool registration for a specific provider | Yes (returns AnyAgentTool[]) | ⚠️ Per-provider — needs aliases for every non-Anthropic provider |
| `before_tool_call` (plugin hook) | AFTER validation | Yes (returns `{params}`) | ❌ Too late — AJV already rejected |
| `registerTool` (plugin API) | Adds new tools | Doesn't wrap existing | ❌ |

**Conclusion:** `tool.prepareArguments` is the correct extension point. It's:
- Provider-agnostic (not tied to specific provider name)
- Pre-validation (AJV won't reject)
- Already in use by upstream for similar transformation
- Chainable — a wrapper can call the upstream prepareArguments after its own logic

## Proposed Solution

Chain a Claude Code alias mapper into `tool.prepareArguments` BEFORE the upstream's own normalization runs.

### Implementation

**New function in `src/agents/pi-tools.params.ts`:**

```typescript
const CLAUDE_CODE_ALIASES: readonly { original: string; alias: string }[] = [
  { original: "path", alias: "file_path" },
  { original: "path", alias: "filePath" },
  { original: "path", alias: "file" },
  { original: "oldText", alias: "old_string" },
  { original: "oldText", alias: "old_text" },
  { original: "oldText", alias: "oldString" },
  { original: "newText", alias: "new_string" },
  { original: "newText", alias: "new_text" },
  { original: "newText", alias: "newString" },
];

function mapClaudeCodeAliases(args: unknown): unknown {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  const record = args as Record<string, unknown>;
  let changed = false;
  const result: Record<string, unknown> = { ...record };
  for (const { original, alias } of CLAUDE_CODE_ALIASES) {
    if (alias in result) {
      if (!(original in result)) {
        result[original] = result[alias];
      }
      delete result[alias];
      changed = true;
    }
  }
  return changed ? result : args;
}

export function wrapToolWithClaudeCodeAliases(tool: AnyAgentTool): AnyAgentTool {
  const upstreamPrepare = tool.prepareArguments;
  return {
    ...tool,
    prepareArguments: (args: unknown) => {
      const aliased = mapClaudeCodeAliases(args);
      return upstreamPrepare ? upstreamPrepare(aliased) : aliased;
    },
  } as AnyAgentTool;
}
```

**Integration in `src/agents/pi-tools.read.ts`** — 5 call sites for read/write/edit tool creation. Each adds a wrap step:

```typescript
return wrapToolParamValidation(
  wrapToolWithClaudeCodeAliases(withRecovery),
  REQUIRED_PARAM_GROUPS.edit,
);
```

### Behavior

- Models sending `{file_path: "x", old_string: "a", new_string: "b"}`:
  1. Our wrapper maps → `{path: "x", oldText: "a", newText: "b"}`
  2. Upstream's `prepareEditArguments` wraps → `{path: "x", edits: [{oldText: "a", newText: "b"}]}`
  3. AJV validates against schema → passes
  4. `execute()` receives properly nested args

- Models sending correct `{path, edits: [...]}`: no change (aliases not present, wrapper is no-op)

- Models sending `{path, oldText, newText}` (pi-coding-agent flat): upstream's prepareEditArguments handles it (pre-existing behavior)

### Why Not a Plugin

Evaluated plugin approach via `normalizeToolSchemas` hook:

1. **Provider-scoped** — `normalizeToolSchemas` is registered per provider (gemini, xai, openai, ...). No wildcard matching.
2. **Maintenance burden** — every new provider requires updating plugin's `hookAliases` list.
3. **Discovery overhead** — plugin load at startup, config entry, plugins.allow entry.
4. **Same LOC** — plugin impl is ~80 lines + manifest + package.json ≈ more code total.

The core wrapping approach is simpler because:
- Applied once at tool creation point (`pi-tools.read.ts`) — not per-provider
- No provider enumeration
- Uses the same public `prepareArguments` hook upstream designed
- Trivial to opt out (single config flag check)

## Upstream PR Plan

### Title
`feat(tools): support Claude Code flat edit params via prepareArguments hook`

### Description outline
1. Problem: 3rd party models emit `{file_path, old_string, new_string}` → tool validation fails
2. Solution: chain alias mapping into `tool.prepareArguments` (upstream hook point, already used by pi-coding-agent)
3. Backwards compat: no-op for models sending correct args; only applies when alias keys present
4. Scope: 5 tool factories in `pi-tools.read.ts` (read/write/edit host + sandbox variants)
5. Alternative considered: plugin approach (rejected — per-provider, more complex)
6. Opt-in option: behind `tools.claudeCodeAliases` config flag (default enabled for multi-provider compat)

### Risk assessment for maintainer
- **Low blast radius**: only affects tool.prepareArguments chain for 3 tools
- **No schema changes** (pi-coding-agent schemas unchanged)
- **No AJV bypass**
- **No new dependencies**
- **No performance impact** on Anthropic path (no-op when aliases absent)
- **Testable**: pure function with clear input/output

### Maintainer objections anticipated
1. "3rd party model compat is not openclaw's problem" → counter: openclaw explicitly supports `openai, google, ollama, local` providers in docs
2. "Should be per-provider plugin" → counter: alias format is model-trained, not provider-specific (GPT-5 via any OpenAI-compat endpoint emits same flat format)
3. "Why hardcode Claude Code format?" → counter: `claudeCodeAliases` naming is precise about what's being supported; could add other known formats in the future

## Current Fork State

**Our main branch** has this patch as commit `1d7c2556d0` (refactor from the original 210-LOC version to the 80-LOC prepareArguments approach).

**Files modified:**
- `src/agents/pi-tools.params.ts` — +60 LOC (aliases + wrapper)
- `src/agents/pi-tools.read.ts` — +25 LOC (5 integration points + import)

**Verification:**
- Build passes
- Gateway running 2026.4.10 with patch applied
- Telegram: ok for both bots

## Next Steps

1. Create feature branch `feat/claude-code-flat-edit-params` from `upstream/main`
2. Cherry-pick commit `1d7c2556d0` onto the feature branch
3. Push to `origin/feat/claude-code-flat-edit-params`
4. Open PR against `openclaw/openclaw:main`
5. Engage with maintainer feedback

## PR Status

**Upstream PR**: [openclaw/openclaw#64369](https://github.com/openclaw/openclaw/pull/64369)
**Branch**: `thebtf:feat/claude-code-flat-edit-params`
**Created**: 2026-04-10

Awaiting maintainer review. Next actions:
- Monitor PR discussion
- Respond to feedback
- If accepted: wait for merge, then drop fork patch in next upstream pull
- If rejected with "make it opt-in": adjust PR with config flag
- If rejected entirely: keep fork patch, document rationale in PATCHES.md
