/**
 * Ride taxonomy normalizer tests. Mobile sends lowercase labels, the DB and
 * discovery filters speak legacy Title-case — these functions are the bridge,
 * so every documented mapping is pinned here.
 */

import {
  normalizeExperienceLevel,
  normalizePace,
} from "./rideEnums.js";

describe("normalizeExperienceLevel — documented mappings", () => {
  it.each([
    ["beginner", "Beginner"],
    ["novice", "Beginner"],
    ["intermediate", "Intermediate"],
    ["advanced", "Expert"],
    ["expert", "Expert"],
    ["pro", "Expert"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeExperienceLevel(input)).toBe(expected);
  });

  it("is case-insensitive", () => {
    for (const casing of [
      "BEGINNER",
      "Beginner",
      "bEgInNeR",
      "ADVANCED",
      "Advanced",
    ]) {
      const out = normalizeExperienceLevel(casing);
      expect(["Beginner", "Expert"]).toContain(out);
    }
  });

  it("trims surrounding whitespace before mapping", () => {
    expect(normalizeExperienceLevel("  expert ")).toBe("Expert");
    expect(normalizeExperienceLevel("\tnovice\n")).toBe("Beginner");
  });

  it("passes through unknown non-empty strings verbatim (never blocks writes)", () => {
    expect(normalizeExperienceLevel("Trail Rider")).toBe("Trail Rider");
    expect(normalizeExperienceLevel("enduro")).toBe("enduro");
  });
});

describe("normalizePace — documented mappings", () => {
  it.each([
    ["relaxed", "Leisurely"],
    ["leisurely", "Leisurely"],
    ["scenic", "Leisurely"],
    ["moderate", "Moderate"],
    ["steady", "Moderate"],
    ["fast", "Fast"],
    ["spirited", "Fast"],
    ["aggressive", "Fast"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePace(input)).toBe(expected);
  });

  it("is case-insensitive", () => {
    for (const casing of ["FAST", "Fast", "fAsT", "SPIRITED"]) {
      expect(normalizePace(casing)).toBe("Fast");
    }
  });

  it("trims surrounding whitespace before mapping", () => {
    expect(normalizePace(" relaxed ")).toBe("Leisurely");
  });

  it("passes through unknown non-empty strings verbatim", () => {
    expect(normalizePace("Cruise")).toBe("Cruise");
  });
});

describe("normalizers — hostile inputs", () => {
  it.each([undefined, null, 42, true, {}, [], ["fast"], Number.NaN])(
    "%p → undefined",
    (input) => {
      expect(normalizeExperienceLevel(input)).toBeUndefined();
      expect(normalizePace(input)).toBeUndefined();
    },
  );

  it.each(["", "   ", "\n\t"])(
    "blank string %p → undefined",
    (input) => {
      expect(normalizeExperienceLevel(input)).toBeUndefined();
      expect(normalizePace(input)).toBeUndefined();
    },
  );
});

describe("mapping tables stay in sync with the DB enum buckets", () => {
  const EXPERIENCE_BUCKETS = ["Beginner", "Intermediate", "Expert"];
  const PACE_BUCKETS = ["Leisurely", "Moderate", "Fast"];

  it.each(EXPERIENCE_BUCKETS)("experience output %s is a legal enum value", (bucket) => {
    const mapped = ["beginner", "novice", "intermediate", "advanced", "expert", "pro"]
      .map((v) => normalizeExperienceLevel(v));
    for (const m of mapped) expect(EXPERIENCE_BUCKETS).toContain(m);
  });

  it.each(PACE_BUCKETS)("pace output %s is a legal enum value", (bucket) => {
    const mapped = ["relaxed", "leisurely", "scenic", "moderate", "steady", "fast", "spirited", "aggressive"]
      .map((v) => normalizePace(v));
    for (const m of mapped) expect(PACE_BUCKETS).toContain(m);
  });
});
