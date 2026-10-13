import { describe, it, expect, beforeEach } from "vitest";
import { checkAndConsumeCredit, getRemainingCredits, resetUserCreditsForTesting } from "../credits.service.js";

describe("AI Daily Credits System", () => {
  beforeEach(async () => {
    await resetUserCreditsForTesting();
  });

  it("allows requests when credits are available and decrements count", async () => {
    const userId = "test-credit-user-1";
    const status1 = await checkAndConsumeCredit(userId);
    expect(status1.allowed).toBe(true);
    expect(status1.used).toBe(1);
    expect(status1.remaining).toBe(status1.limit - 1);

    const status2 = await getRemainingCredits(userId);
    expect(status2.used).toBe(1);
    expect(status2.remaining).toBe(status2.limit - 1);
  });

  it("blocks requests once daily credit limit is exceeded", async () => {
    const userId = "test-credit-user-limit";

    // Consume up to limit
    const initial = await getRemainingCredits(userId);
    for (let i = 0; i < initial.limit; i++) {
      const res = await checkAndConsumeCredit(userId);
      expect(res.allowed).toBe(true);
    }

    // Next attempt must be rejected
    const blocked = await checkAndConsumeCredit(userId);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.used).toBe(initial.limit);
  });
});
