import { describe, expect, it } from "vitest";
import {
  coerceToFailoverError,
  describeFailoverError,
  isTimeoutError,
  resolveFailoverReasonFromError,
} from "./failover-error.js";

describe("failover-error", () => {
  it("infers failover reason from HTTP status", () => {
    expect(resolveFailoverReasonFromError({ status: 402 })).toBe("billing");
    expect(resolveFailoverReasonFromError({ statusCode: "429" })).toBe("rate_limit");
    expect(resolveFailoverReasonFromError({ status: 403 })).toBe("auth");
    expect(resolveFailoverReasonFromError({ status: 408 })).toBe("timeout");
    expect(resolveFailoverReasonFromError({ status: 400 })).toBe("format");
    // Transient server errors (502/503/504) should trigger failover as timeout.
    expect(resolveFailoverReasonFromError({ status: 502 })).toBe("timeout");
    expect(resolveFailoverReasonFromError({ status: 503 })).toBe("timeout");
    expect(resolveFailoverReasonFromError({ status: 504 })).toBe("timeout");
  });

  it("infers format errors from error messages", () => {
    expect(
      resolveFailoverReasonFromError({
        message: "invalid request format: messages.1.content.1.tool_use.id",
      }),
    ).toBe("format");
  });

  it("infers timeout from common node error codes", () => {
    expect(resolveFailoverReasonFromError({ code: "ETIMEDOUT" })).toBe("timeout");
    expect(resolveFailoverReasonFromError({ code: "ECONNRESET" })).toBe("timeout");
  });

  it("infers timeout from abort stop-reason messages", () => {
    expect(resolveFailoverReasonFromError({ message: "Unhandled stop reason: abort" })).toBe(
      "timeout",
    );
    expect(resolveFailoverReasonFromError({ message: "stop reason: abort" })).toBe("timeout");
    expect(resolveFailoverReasonFromError({ message: "reason: abort" })).toBe("timeout");
  });

  it("treats AbortError reason=abort as timeout", () => {
    const err = Object.assign(new Error("aborted"), {
      name: "AbortError",
      reason: "reason: abort",
    });
    expect(isTimeoutError(err)).toBe(true);
  });

  it("coerces failover-worthy errors into FailoverError with metadata", () => {
    const err = coerceToFailoverError("credit balance too low", {
      provider: "anthropic",
      model: "claude-opus-4-5",
    });
    expect(err?.name).toBe("FailoverError");
    expect(err?.reason).toBe("billing");
    expect(err?.status).toBe(402);
    expect(err?.provider).toBe("anthropic");
    expect(err?.model).toBe("claude-opus-4-5");
  });

  it("coerces format errors with a 400 status", () => {
    const err = coerceToFailoverError("invalid request format", {
      provider: "google",
      model: "cloud-code-assist",
    });
    expect(err?.reason).toBe("format");
    expect(err?.status).toBe(400);
  });

  it("describes non-Error values consistently", () => {
    const described = describeFailoverError(123);
    expect(described.message).toBe("123");
    expect(described.reason).toBeUndefined();
  });

  it("infers timeout from expanded network error codes", () => {
    expect(resolveFailoverReasonFromError({ code: "ENOTFOUND" })).toBe("timeout");
    expect(resolveFailoverReasonFromError({ code: "ECONNREFUSED" })).toBe("timeout");
    expect(resolveFailoverReasonFromError({ code: "EPIPE" })).toBe("timeout");
    expect(resolveFailoverReasonFromError({ code: "UND_ERR_CONNECT_TIMEOUT" })).toBe("timeout");
    expect(resolveFailoverReasonFromError({ code: "UND_ERR_HEADERS_TIMEOUT" })).toBe("timeout");
  });

  it("walks cause chain to find network error codes", () => {
    const inner = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const outer = new TypeError("fetch failed", { cause: inner });
    expect(resolveFailoverReasonFromError(outer)).toBe("timeout");
  });

  it("classifies fetch failed message via text patterns", () => {
    expect(resolveFailoverReasonFromError({ message: "fetch failed" })).toBe("timeout");
    expect(resolveFailoverReasonFromError({ message: "auth_unavailable: no auth" })).toBe("auth");
  });

  it("infers timeout from 5xx HTTP status codes", () => {
    expect(resolveFailoverReasonFromError({ status: 500 })).toBe("timeout");
    expect(resolveFailoverReasonFromError({ status: 502 })).toBe("timeout");
    expect(resolveFailoverReasonFromError({ status: 503 })).toBe("timeout");
    expect(resolveFailoverReasonFromError({ status: 521 })).toBe("timeout");
    expect(resolveFailoverReasonFromError({ status: 529 })).toBe("timeout");
  });

  it("classifies JSON with string error code via message text", () => {
    // Gemini EOF error via CLIProxyAPI: code is "internal_server_error", not numeric
    const geminiEof = JSON.stringify({
      error: {
        message:
          'Post "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent": EOF',
        type: "server_error",
        code: "internal_server_error",
      },
    });
    expect(resolveFailoverReasonFromError({ message: geminiEof })).toBe("timeout");
  });
});
