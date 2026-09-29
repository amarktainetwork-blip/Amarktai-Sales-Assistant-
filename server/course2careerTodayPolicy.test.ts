import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  normalizeClientActionConfiguration,
  validateClientActionConfigurationForCommissioning,
} from "./clientActionConfiguration";

describe("Course2Career Today client-pack policy", () => {
  it("keeps Amelia's task groups tenant-specific and commissionable", () => {
    const pack = JSON.parse(
      readFileSync("config/client-packs/course2career.json", "utf8")
    );
    const configuration = normalizeClientActionConfiguration({
      todayWorkPolicy: pack.todayWorkPolicy,
    });
    expect(configuration.todayWorkPolicy?.categories.map(category => category.key))
      .toEqual([
        "renewals-debt",
        "new-leads",
        "first-call",
        "replies-callbacks",
        "last-try",
        "call-2",
        "call-3",
      ]);
    expect(configuration.todayWorkPolicy?.callTimeRotation).toMatchObject({
      enabled: true,
      categoryKeys: ["call-2", "call-3", "last-try"],
      minimumVariationMinutes: 120,
      expectedConsecutiveDays: 4,
    });
    expect(
      validateClientActionConfigurationForCommissioning(configuration).valid
    ).toBe(true);
  });

  it("does not turn the Course2Career policy into a product-wide default", () => {
    const configuration = normalizeClientActionConfiguration({});
    expect(configuration.todayWorkPolicy).toBeUndefined();
  });
});
