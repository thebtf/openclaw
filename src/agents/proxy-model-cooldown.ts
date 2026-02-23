/**
 * Per-model cooldown tracking for proxy/aggregator providers.
 *
 * When a provider is marked as `isProxy: true` in `auth.providerOptions`,
 * rate-limit and model-specific failures are tracked per (provider, model)
 * pair instead of at the auth-profile level.  This prevents a single
 * rate-limited model from blocking all other models served by the same proxy.
 *
 * Non-proxy providers are unaffected: all existing auth-profile cooldown
 * logic continues to apply unchanged.
 */

import type { OpenClawConfig } from "../config/config.js";
import { calculateAuthProfileCooldownMs } from "./auth-profiles/usage.js";
import { normalizeProviderId } from "./model-selection.js";

type ModelCooldownEntry = {
  cooldownUntil: number;
  errorCount: number;
};

/** In-memory store; intentionally not persisted — model cooldowns are transient. */
const modelCooldownStore = new Map<string, ModelCooldownEntry>();

function makeModelCooldownKey(provider: string, model: string): string {
  return `${normalizeProviderId(provider)}::${model}`;
}

/**
 * Returns true if the given model is currently in cooldown.
 * Expired entries are cleaned up on read to prevent unbounded Map growth.
 */
export function isModelInCooldown(provider: string, model: string): boolean {
  const key = makeModelCooldownKey(provider, model);
  const entry = modelCooldownStore.get(key);
  if (!entry) {
    return false;
  }
  if (Date.now() >= entry.cooldownUntil) {
    modelCooldownStore.delete(key);
    return false;
  }
  return true;
}

/**
 * Maximum cooldown for proxy-model-level rate limits.
 *
 * Proxy/aggregator rate limits are transient — a model typically recovers
 * within a minute or two.  The auth-profile formula (1 min → 5 min → 25 min
 * → 1 hr) was designed for billing/credential failures and is too aggressive
 * here.  We keep the exponential base but cap at 5 minutes so a model never
 * sits out longer than necessary.
 */
const PROXY_MODEL_COOLDOWN_CAP_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Marks a model in cooldown with exponential backoff capped at 5 minutes.
 * Schedule: 1 min → 5 min → 5 min (cap).
 */
export function markModelCooldown(provider: string, model: string): void {
  const key = makeModelCooldownKey(provider, model);
  const existing = modelCooldownStore.get(key) ?? { cooldownUntil: 0, errorCount: 0 };
  const nextErrorCount = existing.errorCount + 1;
  const cooldownMs = Math.min(
    calculateAuthProfileCooldownMs(nextErrorCount),
    PROXY_MODEL_COOLDOWN_CAP_MS,
  );
  modelCooldownStore.set(key, {
    cooldownUntil: Date.now() + cooldownMs,
    errorCount: nextErrorCount,
  });
}

/**
 * Clears the cooldown for a specific model (e.g. after a successful probe).
 */
export function clearModelCooldown(provider: string, model: string): void {
  modelCooldownStore.delete(makeModelCooldownKey(provider, model));
}

/**
 * Returns true if the provider is configured as a proxy/aggregator in
 * `auth.providerOptions[provider].isProxy`.  Provider IDs are normalized
 * before comparison (same logic as `billingBackoffHoursByProvider`).
 */
export function isProviderProxy(cfg: OpenClawConfig | undefined, provider: string): boolean {
  const options = cfg?.auth?.providerOptions;
  if (!options) {
    return false;
  }
  const normalized = normalizeProviderId(provider);
  for (const [key, value] of Object.entries(options)) {
    if (normalizeProviderId(key) === normalized) {
      return value.isProxy === true;
    }
  }
  return false;
}

/**
 * Failure reasons that are model-specific on a proxy provider.
 * These are routed to per-model cooldown instead of auth-profile cooldown.
 *
 * - rate_limit:      model or route is throttled; other models remain OK
 * - timeout:         model hangs (Antigravity pattern); other models unaffected
 * - model_not_found: model unavailable on proxy; profile itself is healthy
 */
const PROXY_MODEL_SPECIFIC_REASONS = new Set<string>(["rate_limit", "timeout", "model_not_found"]);

export function isModelSpecificReason(reason: string): boolean {
  return PROXY_MODEL_SPECIFIC_REASONS.has(reason);
}
