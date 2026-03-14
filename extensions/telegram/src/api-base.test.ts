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

  it("preserves token-prefixed relative paths (local API without --local)", () => {
    // Local Bot API without --local returns "<TOKEN>/photos/file_8.jpg".
    // The token directory is part of the on-disk layout; nginx alias maps it.
    const path = `${TOKEN}/photos/file_8.jpg`;
    expect(normalizeLocalFilePath(path, TOKEN)).toBe(path);
  });

  it("preserves token-prefixed voice paths (local API without --local)", () => {
    const path = `${TOKEN}/voice/file_42.oga`;
    expect(normalizeLocalFilePath(path, TOKEN)).toBe(path);
  });

  it("strips data-dir prefix but keeps token dir from absolute paths (--local mode)", () => {
    // --local mode returns "/var/lib/telegram-bot-api/<TOKEN>/photos/file_3.jpg".
    // We strip the data-dir prefix but keep "<TOKEN>/photos/..." so the download
    // URL becomes /file/bot<TOKEN>/<TOKEN>/photos/file_3.jpg — nginx alias maps
    // $1 = "<TOKEN>/photos/file_3.jpg" to /var/lib/telegram-bot-api/<TOKEN>/photos/file_3.jpg.
    const absPath = `/var/lib/telegram-bot-api/${TOKEN}/photos/file_3.jpg`;
    expect(normalizeLocalFilePath(absPath, TOKEN)).toBe(`${TOKEN}/photos/file_3.jpg`);
  });

  it("works with a custom data directory (--local mode)", () => {
    const absPath = `/data/tg-bot-api/${TOKEN}/voice/file_42.oga`;
    expect(normalizeLocalFilePath(absPath, TOKEN)).toBe(`${TOKEN}/voice/file_42.oga`);
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
    const absPath = `/var/lib/telegram-bot-api/${TOKEN}/`;
    expect(normalizeLocalFilePath(absPath, TOKEN)).toBe(`${TOKEN}/`);
  });

  it("handles deeply nested paths after token directory", () => {
    const absPath = `/mnt/data/${TOKEN}/documents/2024/01/report.pdf`;
    expect(normalizeLocalFilePath(absPath, TOKEN)).toBe(`${TOKEN}/documents/2024/01/report.pdf`);
  });
});
