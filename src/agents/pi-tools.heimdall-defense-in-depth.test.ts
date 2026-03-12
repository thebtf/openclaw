import { describe, expect, it } from "vitest";
/**
 * Defense-in-depth tests for the GUEST+senderIsOwner→OWNER promotion
 * in pi-tools.ts Heimdall gate.
 *
 * These tests verify the promotion logic indirectly via resolveSenderTier
 * and the defense-in-depth conditional that wraps it.
 */
// The defense-in-depth logic is:
//   if (senderTier === "guest" && senderIsOwner) { senderTier = "owner"; }
// We test the conditions that trigger and don't trigger this promotion.
import { resolveSenderTier } from "../security/heimdall/sender-tier.js";
import { SenderTier } from "../security/heimdall/types.js";

describe("Heimdall defense-in-depth: GUEST + senderIsOwner promotion", () => {
  const heimdallCfg = {
    enabled: true,
    senderTiers: { owners: [281043] },
  };

  it("GUEST + senderIsOwner=true → should promote to OWNER", () => {
    // Simulate: senderId is "unknown" (not in owners list) but senderIsOwner is true
    const tier = resolveSenderTier("unknown", undefined, heimdallCfg);
    expect(tier).toBe(SenderTier.GUEST);

    // Defense-in-depth logic (mirrors pi-tools.ts):
    const senderIsOwner = true;
    let senderTier: string = tier;
    if (senderTier === "guest" && senderIsOwner) {
      senderTier = "owner";
    }
    expect(senderTier).toBe("owner");
  });

  it("SYSTEM + senderIsOwner=true → should NOT downgrade to OWNER", () => {
    const tier = resolveSenderTier("unknown", undefined, heimdallCfg, undefined, true);
    expect(tier).toBe(SenderTier.SYSTEM);

    const senderIsOwner = true;
    let senderTier: string = tier;
    if (senderTier === "guest" && senderIsOwner) {
      senderTier = "owner";
    }
    expect(senderTier).toBe("system");
  });

  it("GUEST + senderIsOwner=false → should remain GUEST", () => {
    const tier = resolveSenderTier("unknown", undefined, heimdallCfg);
    expect(tier).toBe(SenderTier.GUEST);

    const senderIsOwner = false;
    let senderTier: string = tier;
    if (senderTier === "guest" && senderIsOwner) {
      senderTier = "owner";
    }
    expect(senderTier).toBe("guest");
  });

  it("MEMBER + senderIsOwner=true → should remain MEMBER (no override for non-GUEST)", () => {
    const memberCfg = {
      enabled: true,
      senderTiers: { owners: [281043], members: [999] },
    };
    const tier = resolveSenderTier(999, undefined, memberCfg);
    expect(tier).toBe(SenderTier.MEMBER);

    const senderIsOwner = true;
    let senderTier: string = tier;
    if (senderTier === "guest" && senderIsOwner) {
      senderTier = "owner";
    }
    expect(senderTier).toBe("member");
  });

  it("OWNER (matched by senderId) + senderIsOwner=true → remains OWNER", () => {
    const tier = resolveSenderTier(281043, undefined, heimdallCfg);
    expect(tier).toBe(SenderTier.OWNER);

    const senderIsOwner = true;
    let senderTier: string = tier;
    if (senderTier === "guest" && senderIsOwner) {
      senderTier = "owner";
    }
    expect(senderTier).toBe("owner");
  });

  it("effectiveSenderId='cron' with senderIsOwner=true → GUEST promoted to OWNER", () => {
    // When senderId is missing but senderIsOwner is true, effectiveSenderId becomes "cron"
    // "cron" is not in owners list, so Heimdall resolves GUEST
    const tier = resolveSenderTier("cron", undefined, heimdallCfg);
    expect(tier).toBe(SenderTier.GUEST);

    const senderIsOwner = true;
    let senderTier: string = tier;
    if (senderTier === "guest" && senderIsOwner) {
      senderTier = "owner";
    }
    expect(senderTier).toBe("owner");
  });
});
