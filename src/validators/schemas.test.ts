import {
  createReportSchema,
  updateReportSchema,
  weeklyActivityQuerySchema,
} from "./schemas.js";

describe("validators/schemas", () => {
  it("validates report payloads", () => {
    const report = createReportSchema.parse({
      type: "post",
      title: "Spam content",
      description: "This post is obvious spam and links to scam pages.",
      reportedItemId: "ckz9y6u5b0000xj4n3x7x3n2a",
    });

    expect(report.type).toBe("post");
    expect(report.priority).toBeUndefined();
  });

  it("validates update report status and weekly query defaults", () => {
    const status = updateReportSchema.parse({ status: "resolved" });
    const weekly = weeklyActivityQuerySchema.parse({});

    expect(status.status).toBe("resolved");
    expect(weekly.days).toBe(7);
  });
});
