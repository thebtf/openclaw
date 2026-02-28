import { describe, expect, it } from "vitest";
import { globToRegex, isToolAllowed } from "./tool-acl.js";
import { SenderTier } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const deny = { defaultGuestPolicy: "deny" as const };
const readOnly = { defaultGuestPolicy: "read-only" as const };
const noACL = { ...deny, toolACL: [] };

// ---------------------------------------------------------------------------
// OWNER bypass
// ---------------------------------------------------------------------------

describe("OWNER bypass", () => {
  it("allows any arbitrary tool for OWNER", () => {
    expect(isToolAllowed("exec", SenderTier.OWNER, deny)).toBe(true);
    expect(isToolAllowed("write", SenderTier.OWNER, deny)).toBe(true);
    expect(isToolAllowed("totally_unknown_tool", SenderTier.OWNER, deny)).toBe(true);
    expect(isToolAllowed("mcp__server__execute_command", SenderTier.OWNER, deny)).toBe(true);
  });

  it("OWNER bypass cannot be restricted by custom ACL", () => {
    const config = {
      ...deny,
      toolACL: [{ pattern: "exec", allowedTiers: [SenderTier.GUEST] }],
    };
    // Even though the ACL only lists GUEST, OWNER still gets through
    expect(isToolAllowed("exec", SenderTier.OWNER, config)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Blocklist model: non-dangerous tools allowed for all non-GUEST-deny tiers
// ---------------------------------------------------------------------------

describe("blocklist: non-dangerous tools allowed by default", () => {
  const nonDangerous = [
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
    "message",
    "sessions_send",
    "kg_query",
    "custom_anything",
  ];

  it.each(nonDangerous)("allows MEMBER to use %s", (tool) => {
    expect(isToolAllowed(tool, SenderTier.MEMBER, noACL)).toBe(true);
  });

  it.each(nonDangerous)("allows SYSTEM to use %s", (tool) => {
    expect(isToolAllowed(tool, SenderTier.SYSTEM, noACL)).toBe(true);
  });

  it.each(nonDangerous)("allows GUEST (read-only) to use %s", (tool) => {
    expect(isToolAllowed(tool, SenderTier.GUEST, readOnly)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dangerous tools denied for non-OWNER
// ---------------------------------------------------------------------------

describe("dangerous tools denied for non-OWNER", () => {
  const dangerous = ["exec", "process", "write", "edit", "apply_patch"];

  it.each(dangerous)("denies MEMBER from using %s", (tool) => {
    expect(isToolAllowed(tool, SenderTier.MEMBER, noACL)).toBe(false);
  });

  it.each(dangerous)("denies SYSTEM from using %s", (tool) => {
    expect(isToolAllowed(tool, SenderTier.SYSTEM, noACL)).toBe(false);
  });

  it.each(dangerous)("denies GUEST (read-only) from using %s", (tool) => {
    expect(isToolAllowed(tool, SenderTier.GUEST, readOnly)).toBe(false);
  });

  it("denies sandboxed variants for non-OWNER", () => {
    expect(isToolAllowed("sandboxed_write", SenderTier.MEMBER, noACL)).toBe(false);
    expect(isToolAllowed("sandboxed_edit", SenderTier.MEMBER, noACL)).toBe(false);
    expect(isToolAllowed("sandboxed_write", SenderTier.SYSTEM, noACL)).toBe(false);
    expect(isToolAllowed("sandboxed_edit", SenderTier.SYSTEM, noACL)).toBe(false);
  });

  it("denies MCP dangerous patterns for non-OWNER", () => {
    expect(isToolAllowed("mcp__github__execute_command", SenderTier.MEMBER, noACL)).toBe(false);
    expect(isToolAllowed("mcp__server__write_file", SenderTier.MEMBER, noACL)).toBe(false);
    expect(isToolAllowed("mcp__fs__delete_entry", SenderTier.MEMBER, noACL)).toBe(false);
    expect(isToolAllowed("mcp__server__execute_command", SenderTier.SYSTEM, noACL)).toBe(false);
    expect(isToolAllowed("mcp__server__execute_command", SenderTier.GUEST, readOnly)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GUEST — deny policy blocks everything
// ---------------------------------------------------------------------------

describe("GUEST with deny policy", () => {
  it("denies ALL tools for GUEST when defaultGuestPolicy is deny", () => {
    expect(isToolAllowed("search", SenderTier.GUEST, deny)).toBe(false);
    expect(isToolAllowed("read", SenderTier.GUEST, deny)).toBe(false);
    expect(isToolAllowed("exec", SenderTier.GUEST, deny)).toBe(false);
    expect(isToolAllowed("memory_search", SenderTier.GUEST, deny)).toBe(false);
    expect(isToolAllowed("agents_list", SenderTier.GUEST, deny)).toBe(false);
  });

  it("denies MCP tools for GUEST with deny policy", () => {
    expect(isToolAllowed("mcp__nia__search", SenderTier.GUEST, deny)).toBe(false);
    expect(isToolAllowed("mcp__redmine__list_issues", SenderTier.GUEST, deny)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GUEST — read-only policy: same as MEMBER (allow non-dangerous)
// ---------------------------------------------------------------------------

describe("GUEST with read-only policy", () => {
  it("allows non-dangerous tools for GUEST in read-only mode", () => {
    const tools = [
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
      "message",
      "kg_query",
    ];
    tools.forEach((tool) => {
      expect(isToolAllowed(tool, SenderTier.GUEST, readOnly)).toBe(true);
    });
  });

  it("still denies GUEST from dangerous tools in read-only mode", () => {
    expect(isToolAllowed("exec", SenderTier.GUEST, readOnly)).toBe(false);
    expect(isToolAllowed("write", SenderTier.GUEST, readOnly)).toBe(false);
    expect(isToolAllowed("edit", SenderTier.GUEST, readOnly)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Glob matching
// ---------------------------------------------------------------------------

describe("globToRegex", () => {
  it("mcp__* matches mcp__github__list_repos", () => {
    const re = globToRegex("mcp__*");
    expect(re.test("mcp__github__list_repos")).toBe(true);
  });

  it("mcp__*__execute_* matches mcp__server__execute_command", () => {
    const re = globToRegex("mcp__*__execute_*");
    expect(re.test("mcp__server__execute_command")).toBe(true);
  });

  it("browser_* matches browser_navigate", () => {
    const re = globToRegex("browser_*");
    expect(re.test("browser_navigate")).toBe(true);
  });

  it("does not match unrelated strings", () => {
    const re = globToRegex("mcp__*");
    expect(re.test("search")).toBe(false);
    expect(re.test("xmcp__foo")).toBe(false);
  });

  it("exact pattern matches exactly", () => {
    const re = globToRegex("exec");
    expect(re.test("exec")).toBe(true);
    expect(re.test("execute")).toBe(false);
    expect(re.test("xexec")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Custom ACL overrides defaults
// ---------------------------------------------------------------------------

describe("custom ACL overrides", () => {
  it("allows MEMBER to use exec when custom ACL permits it", () => {
    const config = {
      ...deny,
      toolACL: [{ pattern: "exec", allowedTiers: [SenderTier.MEMBER] }],
    };
    expect(isToolAllowed("exec", SenderTier.MEMBER, config)).toBe(true);
  });

  it("denies MEMBER when custom ACL does not include their tier", () => {
    const config = {
      ...deny,
      toolACL: [{ pattern: "search", allowedTiers: [SenderTier.GUEST] }],
    };
    // Custom ACL explicitly excludes MEMBER for "search"
    expect(isToolAllowed("search", SenderTier.MEMBER, config)).toBe(false);
  });

  it("custom ACL can restrict normally-allowed tools", () => {
    const config = {
      ...deny,
      toolACL: [{ pattern: "message", allowedTiers: [SenderTier.OWNER] }],
    };
    // "message" is non-dangerous (would be allowed by default), but custom ACL restricts it
    expect(isToolAllowed("message", SenderTier.MEMBER, config)).toBe(false);
    expect(isToolAllowed("message", SenderTier.OWNER, config)).toBe(true);
  });

  it("custom ACL with glob overrides dangerous defaults", () => {
    const config = {
      ...deny,
      toolACL: [{ pattern: "mcp__*__execute_*", allowedTiers: [SenderTier.MEMBER] }],
    };
    expect(isToolAllowed("mcp__server__execute_command", SenderTier.MEMBER, config)).toBe(true);
  });

  it("first matching ACL entry wins", () => {
    const config = {
      ...deny,
      toolACL: [
        { pattern: "exec", allowedTiers: [SenderTier.MEMBER] },
        { pattern: "exec", allowedTiers: [] as SenderTier[] },
      ],
    };
    // First entry matches and allows MEMBER
    expect(isToolAllowed("exec", SenderTier.MEMBER, config)).toBe(true);
  });

  it("falls through to defaults when no custom ACL entry matches", () => {
    const config = {
      ...deny,
      toolACL: [{ pattern: "browser_*", allowedTiers: [SenderTier.MEMBER] }],
    };
    // "search" does not match "browser_*", falls through to default-allow
    expect(isToolAllowed("search", SenderTier.MEMBER, config)).toBe(true);
    // "exec" does not match "browser_*", falls through to dangerous-deny
    expect(isToolAllowed("exec", SenderTier.MEMBER, config)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unknown tools — allowed in blocklist model (default ALLOW)
// ---------------------------------------------------------------------------

describe("unknown tools (blocklist model)", () => {
  it("allows unknown tool for MEMBER (default-allow)", () => {
    expect(isToolAllowed("totally_made_up_tool", SenderTier.MEMBER, noACL)).toBe(true);
  });

  it("allows unknown tool for SYSTEM (default-allow)", () => {
    expect(isToolAllowed("totally_made_up_tool", SenderTier.SYSTEM, noACL)).toBe(true);
  });

  it("allows unknown tool for GUEST in read-only mode (default-allow)", () => {
    expect(isToolAllowed("totally_made_up_tool", SenderTier.GUEST, readOnly)).toBe(true);
  });

  it("denies unknown tool for GUEST with deny policy", () => {
    expect(isToolAllowed("totally_made_up_tool", SenderTier.GUEST, deny)).toBe(false);
  });

  it("allows unknown tool for OWNER", () => {
    expect(isToolAllowed("totally_made_up_tool", SenderTier.OWNER, noACL)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge cases: glob escaping and config resilience
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("escapes regex special characters in glob patterns", () => {
    const re = globToRegex("tool.name+special");
    expect(re.test("tool.name+special")).toBe(true);
    expect(re.test("toolXname+special")).toBe(false);
    expect(re.test("tool.name+specialXXX")).toBe(false);
  });

  it("handles undefined toolACL (falls through to defaults)", () => {
    const config = { ...deny, toolACL: undefined };
    // MEMBER: non-dangerous allowed, dangerous denied
    expect(isToolAllowed("search", SenderTier.MEMBER, config)).toBe(true);
    expect(isToolAllowed("exec", SenderTier.MEMBER, config)).toBe(false);
  });

  it("handles undefined defaultGuestPolicy (fail-safe: deny for GUEST)", () => {
    const config = { defaultGuestPolicy: undefined as unknown as "deny", toolACL: [] };
    // undefined !== "read-only" → GUEST denied (fail-safe)
    expect(isToolAllowed("search", SenderTier.GUEST, config)).toBe(false);
  });

  it("GUEST can be granted access to dangerous tools via custom ACL", () => {
    const config = {
      ...deny,
      toolACL: [{ pattern: "exec", allowedTiers: [SenderTier.GUEST] }],
    };
    // Custom ACL overrides both GUEST-deny and dangerous-deny
    expect(isToolAllowed("exec", SenderTier.GUEST, config)).toBe(true);
  });

  it("GUEST can be granted access to non-dangerous tools via custom ACL even with deny policy", () => {
    const config = {
      ...deny,
      toolACL: [{ pattern: "custom_tool", allowedTiers: [SenderTier.GUEST] }],
    };
    expect(isToolAllowed("custom_tool", SenderTier.GUEST, config)).toBe(true);
  });

  it("empty pattern in ACL matches empty tool name only", () => {
    const re = globToRegex("");
    expect(re.test("")).toBe(true);
    expect(re.test("anything")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tool name normalization
// ---------------------------------------------------------------------------

describe("tool name normalization", () => {
  it('normalizes "Bash" to "exec" and applies dangerous rule', () => {
    expect(isToolAllowed("Bash", SenderTier.MEMBER, noACL)).toBe(false);
    expect(isToolAllowed("Bash", SenderTier.OWNER, noACL)).toBe(true);
  });

  it('normalizes "BASH" to "exec" (case insensitive)', () => {
    expect(isToolAllowed("BASH", SenderTier.MEMBER, noACL)).toBe(false);
  });

  it("handles empty string tool name (non-dangerous, default-allow)", () => {
    // Empty string normalizes to empty, not in dangerous list → allowed
    expect(isToolAllowed("", SenderTier.MEMBER, noACL)).toBe(true);
    expect(isToolAllowed("", SenderTier.OWNER, noACL)).toBe(true);
  });

  it('normalizes "apply-patch" to "apply_patch"', () => {
    expect(isToolAllowed("apply-patch", SenderTier.MEMBER, noACL)).toBe(false);
    expect(isToolAllowed("apply-patch", SenderTier.OWNER, noACL)).toBe(true);
  });

  it("trims whitespace in tool names", () => {
    expect(isToolAllowed("  read  ", SenderTier.MEMBER, noACL)).toBe(true);
    expect(isToolAllowed("  exec  ", SenderTier.MEMBER, noACL)).toBe(false);
  });

  it("normalization works with custom ACL", () => {
    const config = {
      ...deny,
      toolACL: [{ pattern: "exec", allowedTiers: [SenderTier.MEMBER] }],
    };
    // "Bash" normalizes to "exec", which matches the custom ACL entry
    expect(isToolAllowed("Bash", SenderTier.MEMBER, config)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MCP tools — allowed by default (non-dangerous ones)
// ---------------------------------------------------------------------------

describe("MCP tools default allow", () => {
  it("allows non-dangerous MCP tools for SYSTEM and MEMBER", () => {
    const mcpTools = [
      "mcp__redmine__redmine_list_issues",
      "mcp__redmine__redmine_create_issue",
      "mcp__google-docs__readgoogledoc",
      "mcp__google-docs__writespreadsheet",
      "mcp__nia__search",
    ];
    for (const tool of mcpTools) {
      expect(isToolAllowed(tool, SenderTier.SYSTEM, noACL)).toBe(true);
      expect(isToolAllowed(tool, SenderTier.MEMBER, noACL)).toBe(true);
      expect(isToolAllowed(tool, SenderTier.GUEST, readOnly)).toBe(true);
    }
  });

  it("denies all MCP tools for GUEST with deny policy", () => {
    expect(isToolAllowed("mcp__nia__search", SenderTier.GUEST, deny)).toBe(false);
    expect(isToolAllowed("mcp__redmine__list_issues", SenderTier.GUEST, deny)).toBe(false);
  });

  it("still denies dangerous MCP patterns for non-OWNER", () => {
    expect(isToolAllowed("mcp__server__execute_command", SenderTier.MEMBER, noACL)).toBe(false);
    expect(isToolAllowed("mcp__fs__write_file", SenderTier.MEMBER, noACL)).toBe(false);
    expect(isToolAllowed("mcp__db__delete_record", SenderTier.MEMBER, noACL)).toBe(false);
    expect(isToolAllowed("mcp__server__execute_command", SenderTier.GUEST, readOnly)).toBe(false);
  });

  it("custom ACL can deny specific MCP tools", () => {
    const config = {
      ...deny,
      toolACL: [{ pattern: "mcp__redmine__*", allowedTiers: [SenderTier.OWNER] }],
    };
    // Custom ACL restricts redmine to OWNER only
    expect(isToolAllowed("mcp__redmine__redmine_list_issues", SenderTier.MEMBER, config)).toBe(
      false,
    );
    // Other MCP tools still allowed by default
    expect(isToolAllowed("mcp__nia__search", SenderTier.MEMBER, config)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SYSTEM tier — trusted internal runtime calls
// ---------------------------------------------------------------------------

describe("SYSTEM tier ACL", () => {
  it("allows SYSTEM to use any non-dangerous tool (blocklist model)", () => {
    const tools = [
      "search",
      "read",
      "sessions_list",
      "memory_search",
      "web_search",
      "message",
      "sessions_send",
      "kg_query",
      "domain_resolve",
      "any_unknown_tool",
    ];
    tools.forEach((tool) => {
      expect(isToolAllowed(tool, SenderTier.SYSTEM, noACL)).toBe(true);
    });
  });

  it("denies SYSTEM dangerous tools by default (no OWNER bypass)", () => {
    const dangerous = ["exec", "write", "edit", "apply_patch", "process"];
    dangerous.forEach((tool) => {
      expect(isToolAllowed(tool, SenderTier.SYSTEM, noACL)).toBe(false);
    });
  });

  it("denies SYSTEM MCP execute/write/delete patterns", () => {
    expect(isToolAllowed("mcp__server__execute_command", SenderTier.SYSTEM, noACL)).toBe(false);
    expect(isToolAllowed("mcp__fs__write_file", SenderTier.SYSTEM, noACL)).toBe(false);
    expect(isToolAllowed("mcp__db__delete_record", SenderTier.SYSTEM, noACL)).toBe(false);
  });

  it("respects custom ACL for SYSTEM tier", () => {
    const config = {
      ...deny,
      toolACL: [
        { pattern: "kg_query", allowedTiers: [SenderTier.SYSTEM, SenderTier.MEMBER] },
        { pattern: "telegram_send*", allowedTiers: [SenderTier.SYSTEM] },
      ],
    };
    expect(isToolAllowed("kg_query", SenderTier.SYSTEM, config)).toBe(true);
    expect(isToolAllowed("telegram_send_message", SenderTier.SYSTEM, config)).toBe(true);
    expect(isToolAllowed("exec", SenderTier.SYSTEM, config)).toBe(false);
  });

  it("SYSTEM tier can be granted dangerous tools via custom ACL", () => {
    const config = {
      ...deny,
      toolACL: [{ pattern: "exec", allowedTiers: [SenderTier.SYSTEM] }],
    };
    expect(isToolAllowed("exec", SenderTier.SYSTEM, config)).toBe(true);
    expect(isToolAllowed("exec", SenderTier.MEMBER, config)).toBe(false);
  });
});
