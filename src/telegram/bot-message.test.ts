import { beforeEach, describe, expect, it, vi } from "vitest";

const buildTelegramMessageContext = vi.hoisted(() => vi.fn());
const dispatchTelegramMessage = vi.hoisted(() => vi.fn());

vi.mock("./bot-message-context.js", () => ({
  buildTelegramMessageContext,
}));

vi.mock("./bot-message-dispatch.js", () => ({
  dispatchTelegramMessage,
}));

import { createTelegramMessageProcessor } from "./bot-message.js";

describe("telegram bot message processor", () => {
  beforeEach(() => {
    buildTelegramMessageContext.mockClear();
    dispatchTelegramMessage.mockClear();
  });

  const baseDeps = {
    bot: {},
    cfg: {},
    account: {},
    telegramCfg: {},
    historyLimit: 0,
    groupHistories: {},
    dmPolicy: {},
    allowFrom: [],
    groupAllowFrom: [],
    ackReactionScope: "none",
    logger: { warn: vi.fn() },
    resolveGroupActivation: () => true,
    resolveGroupRequireMention: () => false,
    resolveTelegramGroupConfig: () => ({}),
    runtime: {},
    replyToMode: "auto",
    streamMode: "partial",
    textLimit: 4096,
    opts: {},
  } as unknown as Parameters<typeof createTelegramMessageProcessor>[0];

  async function processSampleMessage(
    processMessage: ReturnType<typeof createTelegramMessageProcessor>,
  ) {
    await processMessage(
      {
        message: {
          chat: { id: 123, type: "private", title: "chat" },
          message_id: 456,
        },
      } as unknown as Parameters<typeof processMessage>[0],
      [],
      [],
      {},
    );
  }

  it("dispatches when context is available", async () => {
    buildTelegramMessageContext.mockResolvedValue({ route: { sessionKey: "agent:main:main" } });

    const processMessage = createTelegramMessageProcessor(baseDeps);
    await processSampleMessage(processMessage);

    expect(dispatchTelegramMessage).toHaveBeenCalledTimes(1);
  });

  it("dispatches even when hook throws", async () => {
    const mockMsg = { chat: { id: 123 }, message_id: 456, date: 1700000000 };
    buildTelegramMessageContext.mockResolvedValue({
      route: { sessionKey: "agent:main:main" },
      ctxPayload: {
        SessionKey: "agent:main:main",
        MessageSid: "456",
        From: "telegram:123",
        To: "telegram:123",
      },
      chatId: 123,
      isGroup: false,
      msg: mockMsg,
    });
    triggerInternalHook.mockRejectedValue(new Error("hook exploded"));

    const processMessage = createTelegramMessageProcessor(baseDeps);
    await processMessage({ message: mockMsg }, [], [], {});

    expect(triggerInternalHook).toHaveBeenCalledTimes(1);
    expect(dispatchTelegramMessage).toHaveBeenCalledTimes(1);
    expect(baseDeps.logger.warn).toHaveBeenCalledWith(
      "message:received hook failed, continuing dispatch",
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it("skips dispatch when no context is produced", async () => {
    buildTelegramMessageContext.mockResolvedValue(null);
    const processMessage = createTelegramMessageProcessor(baseDeps);
    await processSampleMessage(processMessage);
    expect(dispatchTelegramMessage).not.toHaveBeenCalled();
  });

  it("sends user-visible fallback when dispatch throws", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const runtimeError = vi.fn();
    buildTelegramMessageContext.mockResolvedValue({
      chatId: 123,
      threadSpec: { id: 456 },
      route: { sessionKey: "agent:main:main" },
    });
    dispatchTelegramMessage.mockRejectedValue(new Error("dispatch exploded"));

    const processMessage = createTelegramMessageProcessor({
      ...baseDeps,
      bot: { api: { sendMessage } },
      runtime: { error: runtimeError },
    } as unknown as Parameters<typeof createTelegramMessageProcessor>[0]);
    await expect(processSampleMessage(processMessage)).resolves.toBeUndefined();

    expect(sendMessage).toHaveBeenCalledWith(
      123,
      "Something went wrong while processing your request. Please try again.",
      { message_thread_id: 456 },
    );
    expect(runtimeError).toHaveBeenCalledWith(expect.stringContaining("dispatch exploded"));
  });

  it("swallows fallback delivery failures after dispatch throws", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("blocked by user"));
    const runtimeError = vi.fn();
    buildTelegramMessageContext.mockResolvedValue({
      chatId: 123,
      route: { sessionKey: "agent:main:main" },
    });
    dispatchTelegramMessage.mockRejectedValue(new Error("dispatch exploded"));

    const processMessage = createTelegramMessageProcessor({
      ...baseDeps,
      bot: { api: { sendMessage } },
      runtime: { error: runtimeError },
    } as unknown as Parameters<typeof createTelegramMessageProcessor>[0]);
    await expect(processSampleMessage(processMessage)).resolves.toBeUndefined();

    expect(sendMessage).toHaveBeenCalledWith(
      123,
      "Something went wrong while processing your request. Please try again.",
      undefined,
    );
    expect(runtimeError).toHaveBeenCalledWith(expect.stringContaining("dispatch exploded"));
  });
});
