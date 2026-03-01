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

  // Always try queue first so the parent session LLM can voice-convert the
  // result.  Direct announce is a fallback when the queue cannot accept (no
  // active session, no queue mode configured, etc.).
  const primaryQueue = mapQueueOutcomeToDeliveryResult(await params.queue());
  appendPhase("queue-primary", primaryQueue);
  if (primaryQueue.delivered) {
    return withPhases(primaryQueue);
  }

  if (params.signal?.aborted) {
    return withPhases({
      delivered: false,
      path: "none",
    });
  }

  const primaryDirect = await params.direct();
  appendPhase("direct-primary", primaryDirect);
  return withPhases(primaryDirect);
}
