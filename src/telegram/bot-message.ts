import type { ReplyToMode } from "../config/config.js";
import type { TelegramAccountConfig } from "../config/types.telegram.js";
import {
  createInternalHookEvent,
  isCancelledEvent,
  triggerInternalHook,
} from "../hooks/internal-hooks.js";
import type { RuntimeEnv } from "../runtime.js";
import {
  buildTelegramMessageContext,
  type BuildTelegramMessageContextParams,
  type TelegramMediaRef,
} from "./bot-message-context.js";
import { dispatchTelegramMessage } from "./bot-message-dispatch.js";
import type { TelegramBotOptions } from "./bot.js";
import type { TelegramContext, TelegramStreamMode } from "./bot/types.js";

/** Dependencies injected once when creating the message processor. */
type TelegramMessageProcessorDeps = Omit<
  BuildTelegramMessageContextParams,
  "primaryCtx" | "allMedia" | "storeAllowFrom" | "options"
> & {
  telegramCfg: TelegramAccountConfig;
  runtime: RuntimeEnv;
  replyToMode: ReplyToMode;
  streamMode: TelegramStreamMode;
  textLimit: number;
  opts: Pick<TelegramBotOptions, "token">;
};

export const createTelegramMessageProcessor = (deps: TelegramMessageProcessorDeps) => {
  const {
    bot,
    cfg,
    account,
    telegramCfg,
    historyLimit,
    groupHistories,
    dmPolicy,
    allowFrom,
    groupAllowFrom,
    ackReactionScope,
    logger,
    resolveGroupActivation,
    resolveGroupRequireMention,
    resolveTelegramGroupConfig,
    runtime,
    replyToMode,
    streamMode,
    textLimit,
    opts,
  } = deps;

  return async (
    primaryCtx: TelegramContext,
    allMedia: TelegramMediaRef[],
    storeAllowFrom: string[],
    options?: { messageIdOverride?: string; forceWasMentioned?: boolean },
  ) => {
    const context = await buildTelegramMessageContext({
      primaryCtx,
      allMedia,
      storeAllowFrom,
      options,
      bot,
      cfg,
      account,
      historyLimit,
      groupHistories,
      dmPolicy,
      allowFrom,
      groupAllowFrom,
      ackReactionScope,
      logger,
      resolveGroupActivation,
      resolveGroupRequireMention,
      resolveTelegramGroupConfig,
    });
    if (!context) {
      return;
    }

    // Trigger message:received hook.
    // Handlers may set event.cancelled = true to suppress dispatch (e.g. message filters).
    // All handlers still run even after cancellation (error isolation preserved).
    // On hook error: fail-open — dispatch continues.
    const { ctxPayload, chatId, isGroup, msg } = context;
    const hookEvent = createInternalHookEvent("message", "received", ctxPayload.SessionKey ?? "", {
      ctxPayload,
      channel: "telegram",
      messageId: ctxPayload.MessageSid ?? String(msg.message_id),
      from: ctxPayload.From ?? "",
      to: ctxPayload.To ?? "",
      isGroup,
      chatId: String(chatId),
      senderId: ctxPayload.SenderId || undefined,
      hasMedia: Boolean(ctxPayload.MediaPath),
      mediaCount: ctxPayload.MediaPaths?.length ?? (ctxPayload.MediaPath ? 1 : 0),
      timestamp: msg.date ? msg.date * 1000 : undefined,
    });

    let hookCancelled = false;
    try {
      await triggerInternalHook(hookEvent);
      hookCancelled = isCancelledEvent(hookEvent);
    } catch (err) {
      logger.info({ error: err }, "message:received hook failed, continuing dispatch");
    }

    if (hookCancelled) {
      logger.info(
        { chatId, reason: hookEvent.cancelReason },
        "message:received hook cancelled dispatch",
      );
      return;
    }

    await dispatchTelegramMessage({
      context,
      bot,
      cfg,
      runtime,
      replyToMode,
      streamMode,
      textLimit,
      telegramCfg,
      opts,
    });
  };
};
