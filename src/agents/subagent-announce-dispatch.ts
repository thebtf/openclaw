export type SubagentDeliveryPath = "queued" | "steered" | "direct" | "none";

export type SubagentAnnounceQueueOutcome = "steered" | "queued" | "none";

export type SubagentAnnounceDeliveryResult = {
  delivered: boolean;
  path: SubagentDeliveryPath;
  error?: string;
  phases?: SubagentAnnounceDispatchPhaseResult[];
};

export type SubagentAnnounceDispatchPhase = "queue-primary" | "direct-primary" | "queue-fallback";

export type SubagentAnnounceDispatchPhaseResult = {
  phase: SubagentAnnounceDispatchPhase;
  delivered: boolean;
  path: SubagentDeliveryPath;
  error?: string;
};

export function mapQueueOutcomeToDeliveryResult(
  outcome: SubagentAnnounceQueueOutcome,
): SubagentAnnounceDeliveryResult {
  if (outcome === "steered") {
    return {
      delivered: true,
      path: "steered",
    };
  }
  if (outcome === "queued") {
    return {
      delivered: true,
      path: "queued",
    };
  }
  return {
    delivered: false,
    path: "none",
  };
}

export async function runSubagentAnnounceDispatch(params: {
  expectsCompletionMessage: boolean;
  signal?: AbortSignal;
  queue: () => Promise<SubagentAnnounceQueueOutcome>;
  direct: () => Promise<SubagentAnnounceDeliveryResult>;
}): Promise<SubagentAnnounceDeliveryResult> {
  const phases: SubagentAnnounceDispatchPhaseResult[] = [];
  const appendPhase = (
    phase: SubagentAnnounceDispatchPhase,
    result: SubagentAnnounceDeliveryResult,
  ) => {
    phases.push({
      phase,
      delivered: result.delivered,
      path: result.path,
      error: result.error,
    });
  };
  const withPhases = (result: SubagentAnnounceDeliveryResult): SubagentAnnounceDeliveryResult => ({
    ...result,
    phases,
  });

  if (params.signal?.aborted) {
    return withPhases({
      delivered: false,
      path: "none",
    });
  }

  // Non-completion mode: queue first (inject into parent session for LLM processing).
  if (!params.expectsCompletionMessage) {
    const primaryQueue = mapQueueOutcomeToDeliveryResult(await params.queue());
    appendPhase("queue-primary", primaryQueue);
    if (primaryQueue.delivered) {
      return withPhases(primaryQueue);
    }

    const primaryDirect = await params.direct();
    appendPhase("direct-primary", primaryDirect);
    return withPhases(primaryDirect);
  }

  // Completion mode: direct first (separate agent run avoids mixing announce
  // with user messages in an active run — queue steer would concatenate them).
  // The direct path uses method: "agent" with triggerMessage for LLM voice
  // conversion instead of raw send with completionMessage.
  const primaryDirect = await params.direct();
  appendPhase("direct-primary", primaryDirect);
  if (primaryDirect.delivered) {
    return withPhases(primaryDirect);
  }

  if (params.signal?.aborted) {
    return withPhases({
      delivered: false,
      path: "none",
    });
  }

  const fallbackQueue = mapQueueOutcomeToDeliveryResult(await params.queue());
  appendPhase("queue-fallback", fallbackQueue);
  if (fallbackQueue.delivered) {
    return withPhases(fallbackQueue);
  }

  return withPhases(primaryDirect);
}
