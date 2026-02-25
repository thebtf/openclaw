import { describe, expect, it } from "vitest";
import { getTelegramApiBase } from "./api-base.js";

describe("getTelegramApiBase", () => {
  it("returns the default Telegram API root when called with no arguments", () => {
    expect(getTelegramApiBase()).toBe("https://api.telegram.org");
  });

  it("returns the default when apiRoot is undefined", () => {
    expect(getTelegramApiBase(undefined)).toBe("https://api.telegram.org");
  });

  it("returns the default when apiRoot is empty string", () => {
    expect(getTelegramApiBase("")).toBe("https://api.telegram.org");
  });

  it("returns the default when apiRoot is only whitespace", () => {
    expect(getTelegramApiBase("   ")).toBe("https://api.telegram.org");
  });

  it("returns a clean URL when apiRoot has no trailing slash", () => {
    expect(getTelegramApiBase("http://localhost:8081")).toBe("http://localhost:8081");
  });

  it("strips a single trailing slash from apiRoot", () => {
    expect(getTelegramApiBase("http://localhost:8081/")).toBe("http://localhost:8081");
  });

  it("strips multiple trailing slashes from apiRoot", () => {
    expect(getTelegramApiBase("http://localhost:8081///")).toBe("http://localhost:8081");
  });

  it("trims surrounding whitespace from apiRoot", () => {
    expect(getTelegramApiBase("  http://localhost:8081  ")).toBe("http://localhost:8081");
  });

  it("trims whitespace and strips trailing slash together", () => {
    expect(getTelegramApiBase("  http://unleashed.lan:8081/  ")).toBe("http://unleashed.lan:8081");
  });

  it("preserves a path segment that is not a trailing slash", () => {
    expect(getTelegramApiBase("http://localhost:8081/telegram")).toBe(
      "http://localhost:8081/telegram",
    );
  });
});
