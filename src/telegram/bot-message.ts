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
  type MentionGateSkipped,
  type TelegramMediaRef,
  type TelegramMessageContext,
} from "./bot-message-context.js";
import { dispatchTelegramMessage } from "./bot-message-dispatch.js";
import type { TelegramBotOptions } from "./bot.js";
import type { TelegramContext, TelegramStreamMode } from "./bot/types.js";

/** Dependencies injected once when creating the message processor. */
type TelegramMessageProcessorDeps = Omit<
  BuildTelegramMessageContextParams,
  "primaryCtx" | "allMedia" | "storeAllowFrom" | "options" | "bypassMentionGate"
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
    sendChatActionHandler,
    runtime,
    replyToMode,
    streamMode,
    textLimit,
    opts,
  } = deps;

  const sharedBuildParams = {
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
    sendChatActionHandler,
  } as const;

  const dispatchContext = async (context: TelegramMessageContext) => {
    // Trigger message:received hook. Handlers may set event.cancelled = true to
    // suppress dispatch (e.g. message loggers, file processors).
    // On hook error: fail-open — dispatch continues.
    const hookEvent = createInternalHookEvent(
      "message",
      "received",
      context.ctxPayload.SessionKey ?? "",
      {
        ctxPayload: context.ctxPayload,
        channel: "telegram",
        messageId: context.ctxPayload.MessageSid ?? String(context.msg.message_id),
        from: context.ctxPayload.From ?? "",
        to: context.ctxPayload.To ?? "",
        isGroup: context.isGroup,
        chatId: String(context.chatId),
        senderId: context.ctxPayload.SenderId || undefined,
        hasMedia: Boolean(context.ctxPayload.MediaPath),
        mediaCount: context.ctxPayload.MediaPaths?.length ?? (context.ctxPayload.MediaPath ? 1 : 0),
        timestamp: context.msg.date ? context.msg.date * 1000 : undefined,
      },
    );

    let hookCancelled = false;
    try {
      await triggerInternalHook(hookEvent);
      hookCancelled = isCancelledEvent(hookEvent);
    } catch (err) {
      logger.info({ error: err }, "message:received hook failed, continuing dispatch");
    }
    if (hookCancelled) {
      logger.info(
        { chatId: context.chatId, reason: hookEvent.cancelReason },
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

  return async (
    primaryCtx: TelegramContext,
    allMedia: TelegramMediaRef[],
    storeAllowFrom: string[],
    options?: { messageIdOverride?: string; forceWasMentioned?: boolean },
    replyMedia?: TelegramMediaRef[],
  ) => {
    const buildResult = await buildTelegramMessageContext({
      primaryCtx,
      allMedia,
      replyMedia,
      storeAllowFrom,
      options,
      ...sharedBuildParams,
    });

    if (!buildResult) {
      return;
    }

    // Mention gate returned a prefilter signal — the message had no @mention and
    // no reply-to-bot, but a hook can override the drop decision.
    // Hooks cancel the event to DROP; leaving it unmodified means FORWARD.
    // On hook error: fail-open — message is forwarded.
    if ("mentionGateSkipped" in buildResult) {
      const { data } = buildResult as MentionGateSkipped;
      const sessionKey = `agent:${data.accountId}:${data.channel}:group:${data.chatId}`;
      const prefilterEvent = createInternalHookEvent("message", "prefilter", sessionKey, data);
      try {
        await triggerInternalHook(prefilterEvent);
      } catch (err) {
        logger.info({ error: err }, "message:prefilter hook failed, forwarding message");
      }
      if (isCancelledEvent(prefilterEvent)) {
        logger.info(
          { chatId: data.chatId, reason: prefilterEvent.cancelReason },
          "message:prefilter hook dropped message",
        );
        return;
      }
      // Prefilter approved — rebuild context bypassing the mention gate.
      const bypassResult = await buildTelegramMessageContext({
        primaryCtx,
        allMedia,
        replyMedia,
        storeAllowFrom,
        options,
        ...sharedBuildParams,
        bypassMentionGate: true,
      });
      if (!bypassResult || "mentionGateSkipped" in bypassResult) {
        return;
      }
      await dispatchContext(bypassResult);
      return;
    }

    await dispatchContext(buildResult);
  };
};
