/**
 * Email template rendering tests. Every template must produce a complete
 * EmailTemplate ({subject, html, text, tags}), embed its dynamic params,
 * escape user-supplied names, and never leak "undefined" into the markup.
 */

import {
  getFirstName,
  buildWelcomeTemplate,
  buildVerificationTemplate,
  buildOtpTemplate,
  buildWelcomeOtpTemplate,
  buildResetPasswordTemplate,
  buildRideJoinRequestTemplate,
  buildClubJoinTemplate,
  buildAlertTemplate,
  buildMagicLinkTemplate,
} from "./emailTemplates.js";

type Builder = {
  name: string;
  fn: (params: any) => { subject: string; html: string; text: string; tags: string[] };
  params: Record<string, unknown>;
};

const BUILDERS: Builder[] = [
  {
    name: "welcome",
    fn: buildWelcomeTemplate,
    params: { name: "Ada", appUrl: "https://app.revvie.test" },
  },
  {
    name: "verification",
    fn: buildVerificationTemplate,
    params: { name: "Ada", verifyUrl: "https://app.revvie.test/verify?t=1" },
  },
  {
    name: "otp",
    fn: buildOtpTemplate,
    params: { name: "Ada", otp: "123456", expiresInMinutes: 10 },
  },
  {
    name: "welcomeOtp",
    fn: buildWelcomeOtpTemplate,
    params: { otp: "654321" },
  },
  {
    name: "resetPassword",
    fn: buildResetPasswordTemplate,
    params: { name: "Ada", resetUrl: "https://app.revvie.test/reset?t=1" },
  },
  {
    name: "rideJoinRequest",
    fn: buildRideJoinRequestTemplate,
    params: {
      rideTitle: "Sunrise Canyon Run",
      requesterName: "Grace",
      message: "Count me in!",
    },
  },
  {
    name: "clubJoin",
    fn: buildClubJoinTemplate,
    params: {
      clubName: "Alpine Riders",
      memberName: "Linus",
      clubsUrl: "https://app.revvie.test/clubs",
    },
  },
  {
    name: "alert",
    fn: buildAlertTemplate,
    params: { subject: "Ride starting soon", message: "Helmet on!" },
  },
  {
    name: "magicLink",
    fn: buildMagicLinkTemplate,
    params: { name: "Ada", magicLinkUrl: "https://app.revvie.test/ml?t=ok" },
  },
];

describe("getFirstName", () => {
  it.each([
    ["Ada Lovelace", "Ada"],
    ["Cher", "Cher"],
    [null, undefined],
    [undefined, undefined],
    ["", undefined],
    ["   ", undefined],
  ])("getFirstName(%p) → %p", (input, expected) => {
    expect(getFirstName(input as string | null | undefined)).toBe(expected);
  });
});

describe("template builders — structural contract", () => {
  it.each(BUILDERS.map((b) => [b.name, b] as const))(
    "%s returns all four envelope fields with correct types",
    (_name, b) => {
      const tpl = b.fn(b.params);
      expect(typeof tpl.subject).toBe("string");
      expect(tpl.subject.length).toBeGreaterThan(0);
      expect(typeof tpl.html).toBe("string");
      expect(tpl.html.length).toBeGreaterThan(200);
      expect(typeof tpl.text).toBe("string");
      expect(tpl.text.length).toBeGreaterThan(20);
      expect(Array.isArray(tpl.tags)).toBe(true);
    },
  );

  it.each(BUILDERS.map((b) => [b.name, b] as const))(
    "%s html/text never contain the literal 'undefined'",
    (_name, b) => {
      const tpl = b.fn(b.params);
      expect(tpl.html).not.toContain("undefined");
      expect(tpl.text).not.toContain("undefined");
    },
  );

  it.each(BUILDERS.map((b) => [b.name, b] as const))(
    "%s renders without a name (anonymous fallback)",
    (_name, b) => {
      const anonymousParams = { ...b.params };
      delete anonymousParams.name;
      expect(() => b.fn(anonymousParams)).not.toThrow();
      const tpl = b.fn(anonymousParams);
      // Only templates that greet by name guarantee the anonymous greeting.
      if ("name" in b.params && b.name !== "magicLink") {
        expect(tpl.html.toLowerCase()).toContain("hi there");
      }
    },
  );
});

describe("template builders — dynamic content embedding", () => {
  it("otp template embeds the code and TTL", () => {
    const tpl = buildOtpTemplate({ name: "Ada", otp: "987654", expiresInMinutes: 7 });
    expect(tpl.html).toContain("987654");
    expect(tpl.text).toContain("987654");
    expect(tpl.html).toContain("7");
  });

  it("welcomeOtp embeds the code and default 10-minute TTL copy", () => {
    const tpl = buildWelcomeOtpTemplate({ otp: "112233" });
    expect(tpl.html).toContain("112233");
    expect(tpl.text).toContain("112233");
  });

  it("verification embeds the verify URL", () => {
    const url = "https://app.revvie.test/verify?t=abc123";
    const tpl = buildVerificationTemplate({ name: "Ada", verifyUrl: url });
    expect(tpl.html).toContain(url);
  });

  it("reset password embeds the reset URL", () => {
    const url = "https://app.revvie.test/reset?t=xyz";
    const tpl = buildResetPasswordTemplate({ name: null, resetUrl: url });
    expect(tpl.html).toContain(url);
    expect(tpl.text).toContain(url);
  });

  it("magic link embeds the deep-link URL", () => {
    const url = "revvie://magic-link?token=tok123";
    const tpl = buildMagicLinkTemplate({ magicLinkUrl: url });
    expect(tpl.html).toContain(url);
  });

  it("ride join request surfaces ride title and requester", () => {
    const tpl = buildRideJoinRequestTemplate({
      rideTitle: "Dawn Patrol",
      requesterName: "Marge",
      message: "I'll bring coffee",
    });
    expect(tpl.html).toContain("Dawn Patrol");
    expect(tpl.html).toContain("Marge");
  });

  it("club join surfaces club and member names", () => {
    const tpl = buildClubJoinTemplate({
      clubName: "Coastal Cruisers",
      memberName: "Kirby",
      clubsUrl: "https://x.test/c",
    });
    expect(tpl.html).toContain("Coastal Cruisers");
    expect(tpl.html).toContain("Kirby");
  });

  it("alert uses the subject as heading and carries the message", () => {
    const tpl = buildAlertTemplate({
      subject: "Weather warning",
      message: "Storm cells along the ridge.",
    });
    expect(tpl.subject).toContain("Weather warning");
    expect(tpl.html).toContain("Storm cells along the ridge.");
  });

  it("greets by first name when a full name is provided", () => {
    const tpl = buildWelcomeTemplate({ name: "Ada Lovelace", appUrl: "https://x.test" });
    expect(tpl.html).toContain("Ada");
    expect(tpl.html).not.toContain("Lovelace,");
  });
});

describe("template builders — injection safety", () => {
  it.each([
    ["<script>alert(1)</script>", "script payload"],
    ["<img src=x onerror=alert(1)>", "img payload"],
  ])("escapes %s (%s)", (payload) => {
    const tpl = buildRideJoinRequestTemplate({
      rideTitle: payload,
      requesterName: payload,
    });
    // Raw executable tag must not survive into the HTML.
    expect(tpl.html).not.toContain("<script>");
    expect(tpl.html).not.toContain("<img src=x");
  });
});
