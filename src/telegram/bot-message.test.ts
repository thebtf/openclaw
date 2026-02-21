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
});
