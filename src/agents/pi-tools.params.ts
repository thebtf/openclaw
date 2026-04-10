import type { AnyAgentTool } from "./pi-tools.types.js";

export type RequiredParamGroup = {
  keys: readonly string[];
  allowEmpty?: boolean;
  label?: string;
  validator?: (record: Record<string, unknown>) => boolean;
};

const RETRY_GUIDANCE_SUFFIX = " Supply correct parameters before retrying.";

function parameterValidationError(message: string): Error {
  return new Error(`${message}.${RETRY_GUIDANCE_SUFFIX}`);
}

function describeReceivedParamValue(value: unknown, allowEmpty = false): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    if (allowEmpty || value.trim().length > 0) {
      return undefined;
    }
    return "<empty-string>";
  }
  if (Array.isArray(value)) {
    return "<array>";
  }
  return `<${typeof value}>`;
}

function formatReceivedParamHint(
  record: Record<string, unknown>,
  groups: readonly RequiredParamGroup[],
): string {
  const allowEmptyKeys = new Set(
    groups.filter((group) => group.allowEmpty).flatMap((group) => group.keys),
  );
  const received = Object.keys(record).flatMap((key) => {
    const detail = describeReceivedParamValue(record[key], allowEmptyKeys.has(key));
    if (record[key] === undefined || record[key] === null) {
      return [];
    }
    return [detail ? `${key}=${detail}` : key];
  });
  return received.length > 0 ? ` (received: ${received.join(", ")})` : "";
}

type EditReplacement = {
  oldText: string;
  newText: string;
};

function isValidEditReplacement(value: unknown): value is EditReplacement {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.oldText === "string" &&
    record.oldText.trim().length > 0 &&
    typeof record.newText === "string"
  );
}

function hasValidEditReplacements(record: Record<string, unknown>): boolean {
  const edits = record.edits;
  return (
    Array.isArray(edits) &&
    edits.length > 0 &&
    edits.every((entry) => isValidEditReplacement(entry))
  );
}

export const REQUIRED_PARAM_GROUPS = {
  read: [{ keys: ["path"], label: "path" }],
  write: [
    { keys: ["path"], label: "path" },
    { keys: ["content"], label: "content" },
  ],
  edit: [
    { keys: ["path"], label: "path" },
    { keys: ["edits"], label: "edits", validator: hasValidEditReplacements },
  ],
} as const;

// ========== FORK PATCH: Claude Code param compatibility ==========
// 3rd party models (GPT-5, Qwen via litellm/unleashed) are trained on Claude Code conventions
// and emit flat { file_path, old_string, new_string } instead of pi-coding-agent's
// nested { path, edits: [{ oldText, newText }] }. We normalize before validation so both
// schemas work without retraining the models.

type ClaudeParamAlias = {
  original: string;
  alias: string;
};

const CLAUDE_PARAM_ALIASES: ClaudeParamAlias[] = [
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

function extractStructuredText(value: unknown, depth = 0): string | undefined {
  if (depth > 6) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => extractStructuredText(entry, depth + 1))
      .filter((entry): entry is string => typeof entry === "string");
    return parts.length > 0 ? parts.join("") : undefined;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") {
    return record.text;
  }
  if (typeof record.content === "string") {
    return record.content;
  }
  if (Array.isArray(record.content)) {
    return extractStructuredText(record.content, depth + 1);
  }
  if (Array.isArray(record.parts)) {
    return extractStructuredText(record.parts, depth + 1);
  }
  if (typeof record.value === "string" && record.value.length > 0) {
    const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
    const kind = typeof record.kind === "string" ? record.kind.toLowerCase() : "";
    if (type.includes("text") || kind === "text") {
      return record.value;
    }
  }
  return undefined;
}

function normalizeTextLikeParam(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value === "string") {
    return;
  }
  const extracted = extractStructuredText(value);
  if (typeof extracted === "string") {
    record[key] = extracted;
  }
}

function normalizeClaudeParamAliases(record: Record<string, unknown>) {
  for (const { original, alias } of CLAUDE_PARAM_ALIASES) {
    if (alias in record && !(original in record)) {
      record[original] = record[alias];
    }
    delete record[alias];
  }
}

function addClaudeParamAliasesToSchema(params: {
  properties: Record<string, unknown>;
  required: string[];
}): boolean {
  let changed = false;
  for (const { original, alias } of CLAUDE_PARAM_ALIASES) {
    if (!(original in params.properties)) {
      continue;
    }
    if (!(alias in params.properties)) {
      params.properties[alias] = params.properties[original];
      changed = true;
    }
    const idx = params.required.indexOf(original);
    if (idx !== -1) {
      params.required.splice(idx, 1);
      changed = true;
    }
  }
  return changed;
}

/**
 * Normalize tool parameters from Claude Code conventions to pi-coding-agent conventions.
 * Claude Code uses file_path/old_string/new_string while pi-coding-agent uses path/oldText/newText.
 * Also wraps flat edit params into the nested edits[] array structure.
 */
export function normalizeToolParams(params: unknown): Record<string, unknown> | undefined {
  if (!params || typeof params !== "object") {
    return undefined;
  }
  const record = params as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...record };
  normalizeClaudeParamAliases(normalized);
  // Some providers/models emit text payloads as structured blocks instead of raw strings.
  normalizeTextLikeParam(normalized, "content");
  normalizeTextLikeParam(normalized, "oldText");
  normalizeTextLikeParam(normalized, "newText");

  // pi-coding-agent edit tool expects { path, edits: [{ oldText, newText }] }.
  // Models trained on Claude Code emit flat { path, oldText, newText } instead.
  // Wrap flat params into the edits array so validation passes.
  if (
    "oldText" in normalized &&
    typeof normalized.oldText === "string" &&
    !("edits" in normalized)
  ) {
    const newText = typeof normalized.newText === "string" ? normalized.newText : "";
    normalized.edits = [{ oldText: normalized.oldText, newText }];
    delete normalized.oldText;
    delete normalized.newText;
  }

  return normalized;
}

/**
 * Relax a tool's JSON schema to accept Claude Code alias properties at the root level.
 * Used to prevent AJV validation in pi-agent-core from rejecting flat edit params
 * before our normalizeToolParams wrapper can reshape the input.
 */
export function patchToolSchemaForClaudeCompatibility(tool: AnyAgentTool): AnyAgentTool {
  const schema =
    tool.parameters && typeof tool.parameters === "object"
      ? (tool.parameters as Record<string, unknown>)
      : undefined;

  if (!schema || !schema.properties || typeof schema.properties !== "object") {
    return tool;
  }

  const properties = { ...(schema.properties as Record<string, unknown>) };
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === "string")
    : [];
  const changed = addClaudeParamAliasesToSchema({ properties, required });

  // Edit tool special case: allow flat oldText/newText at root level, make edits optional.
  if (tool.name === "edit" && "edits" in properties) {
    if (!("oldText" in properties)) {
      properties.oldText = {
        type: "string",
        description: "Alias for edits[0].oldText (Claude Code compat)",
      };
    }
    if (!("newText" in properties)) {
      properties.newText = {
        type: "string",
        description: "Alias for edits[0].newText (Claude Code compat)",
      };
    }
    const editsIdx = required.indexOf("edits");
    if (editsIdx !== -1) {
      required.splice(editsIdx, 1);
    }
  }

  // Drop additionalProperties:false for edit tool so alias properties pass AJV.
  const dropAdditionalProps = tool.name === "edit" && schema.additionalProperties === false;

  if (!changed && !dropAdditionalProps) {
    return tool;
  }

  const patched: Record<string, unknown> = {
    ...schema,
    properties,
    required,
  };
  if (dropAdditionalProps) {
    delete patched.additionalProperties;
  }

  return {
    ...tool,
    parameters: patched,
  };
}

// ========== END FORK PATCH ==========

export function getToolParamsRecord(params: unknown): Record<string, unknown> | undefined {
  return params && typeof params === "object" ? (params as Record<string, unknown>) : undefined;
}

export function assertRequiredParams(
  record: Record<string, unknown> | undefined,
  groups: readonly RequiredParamGroup[],
  toolName: string,
): void {
  if (!record || typeof record !== "object") {
    throw parameterValidationError(`Missing parameters for ${toolName}`);
  }

  const missingLabels: string[] = [];
  for (const group of groups) {
    const satisfied =
      group.validator?.(record) ??
      group.keys.some((key) => {
        if (!(key in record)) {
          return false;
        }
        const value = record[key];
        if (typeof value !== "string") {
          return false;
        }
        if (group.allowEmpty) {
          return true;
        }
        return value.trim().length > 0;
      });

    if (!satisfied) {
      const label = group.label ?? group.keys.join(" or ");
      missingLabels.push(label);
    }
  }

  if (missingLabels.length > 0) {
    const joined = missingLabels.join(", ");
    const noun = missingLabels.length === 1 ? "parameter" : "parameters";
    const receivedHint = formatReceivedParamHint(record, groups);
    throw parameterValidationError(`Missing required ${noun}: ${joined}${receivedHint}`);
  }
}

export function wrapToolParamValidation(
  tool: AnyAgentTool,
  requiredParamGroups?: readonly RequiredParamGroup[],
): AnyAgentTool {
  // Fork patch: relax schema to accept Claude Code alias properties.
  const patched = patchToolSchemaForClaudeCompatibility(tool);
  return {
    ...patched,
    execute: async (toolCallId, params, signal, onUpdate) => {
      // Fork patch: normalize flat Claude Code params to pi-coding-agent shape before validation.
      const normalized = normalizeToolParams(params) ?? getToolParamsRecord(params);
      if (requiredParamGroups?.length) {
        assertRequiredParams(normalized, requiredParamGroups, tool.name);
      }
      return tool.execute(toolCallId, normalized ?? params, signal, onUpdate);
    },
  };
}
