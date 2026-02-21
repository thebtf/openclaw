import { beforeEach, describe, expect, it, vi } from "vitest";

const buildTelegramMessageContext = vi.hoisted(() => vi.fn());
const dispatchTelegramMessage = vi.hoisted(() => vi.fn());
const triggerInternalHook = vi.hoisted(() => vi.fn());
const createInternalHookEvent = vi.hoisted(() => vi.fn());
const isCancelledEvent = vi.hoisted(() => vi.fn());

vi.mock("./bot-message-context.js", () => ({
  buildTelegramMessageContext,
}));

vi.mock("./bot-message-dispatch.js", () => ({
  dispatchTelegramMessage,
}));

vi.mock("../hooks/internal-hooks.js", () => ({
  triggerInternalHook,
  createInternalHookEvent,
  isCancelledEvent,
}));

import { createTelegramMessageProcessor } from "./bot-message.js";

const mockMsg = { chat: { id: 123 }, message_id: 456, date: 1700000000 };
const mockContext = {
  ctxPayload: {
    SessionKey: "agent:main:main",
    MessageSid: "456",
    From: "telegram:123",
    To: "telegram:123",
  },
  chatId: 123,
  isGroup: false,
  msg: mockMsg,
};

describe("telegram bot message processor", () => {
  beforeEach(() => {
    buildTelegramMessageContext.mockReset();
    dispatchTelegramMessage.mockReset();
    triggerInternalHook.mockReset();
    createInternalHookEvent.mockReset();
    isCancelledEvent.mockReset();
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
    logger: { info: vi.fn() },
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
      { message: mockMsg } as unknown as Parameters<typeof processMessage>[0],
      [],
      [],
      {},
    );
  }

  it("dispatches when context is available", async () => {
    buildTelegramMessageContext.mockResolvedValue(mockContext);

    const processMessage = createTelegramMessageProcessor(baseDeps);
    await processSampleMessage(processMessage);

    expect(dispatchTelegramMessage).toHaveBeenCalledTimes(1);
  });

  it("dispatches even when hook throws", async () => {
    buildTelegramMessageContext.mockResolvedValue(mockContext);
    triggerInternalHook.mockRejectedValue(new Error("hook exploded"));

    const processMessage = createTelegramMessageProcessor(baseDeps);
    await processMessage(
      { message: mockMsg } as unknown as Parameters<typeof processMessage>[0],
      [],
      [],
      {},
    );

    expect(triggerInternalHook).toHaveBeenCalledTimes(1);
    expect(dispatchTelegramMessage).toHaveBeenCalledTimes(1);
    expect(baseDeps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      "message:received hook failed, continuing dispatch",
    );
  });

  it("skips dispatch when hook sets cancelled", async () => {
    buildTelegramMessageContext.mockResolvedValue(mockContext);
    triggerInternalHook.mockResolvedValue(undefined);
    isCancelledEvent.mockReturnValue(true);
    createInternalHookEvent.mockReturnValue({
      type: "message",
      action: "received",
      sessionKey: "agent:main:main",
      context: {},
      timestamp: new Date(),
      messages: [],
      cancelled: true,
      cancelReason: "test-cancel",
    });

    const processMessage = createTelegramMessageProcessor(baseDeps);
    await processMessage(
      { message: mockMsg } as unknown as Parameters<typeof processMessage>[0],
      [],
      [],
      {},
    );

    expect(triggerInternalHook).toHaveBeenCalledTimes(1);
    expect(dispatchTelegramMessage).not.toHaveBeenCalled();
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
