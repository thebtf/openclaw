import { describe, expect, it } from "vitest";
import { getTelegramApiBase, normalizeLocalFilePath } from "./api-base.js";

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

describe("normalizeLocalFilePath", () => {
  const TOKEN = "123456789:ABCdefGHIjklMNOpqrsTUVwxyz";

  it("returns relative paths unchanged (cloud API)", () => {
    expect(normalizeLocalFilePath("photos/file_3.jpg", TOKEN)).toBe("photos/file_3.jpg");
  });

  it("strips data-dir + token prefix from absolute local paths", () => {
    const absPath = `/var/lib/telegram-bot-api/${TOKEN}/photos/file_3.jpg`;
    expect(normalizeLocalFilePath(absPath, TOKEN)).toBe("photos/file_3.jpg");
  });

  it("works with a custom data directory", () => {
    const absPath = `/data/tg-bot-api/${TOKEN}/voice/file_42.oga`;
    expect(normalizeLocalFilePath(absPath, TOKEN)).toBe("voice/file_42.oga");
  });

  it("falls back to stripping leading slashes when token is not in path", () => {
    expect(normalizeLocalFilePath("/some/other/path/file.jpg", TOKEN)).toBe(
      "some/other/path/file.jpg",
    );
  });

  it("returns empty string unchanged", () => {
    expect(normalizeLocalFilePath("", TOKEN)).toBe("");
  });

  it("handles path where token appears at the very end (no trailing content)", () => {
    // Edge case: path ends with /<token>/ — nothing after the marker
    const absPath = `/var/lib/telegram-bot-api/${TOKEN}/`;
    expect(normalizeLocalFilePath(absPath, TOKEN)).toBe("");
  });

  it("handles deeply nested paths after token directory", () => {
    const absPath = `/mnt/data/${TOKEN}/documents/2024/01/report.pdf`;
    expect(normalizeLocalFilePath(absPath, TOKEN)).toBe("documents/2024/01/report.pdf");
  });
});
