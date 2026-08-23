import { describe, expect, it } from "vitest";
import { sanitizeConnectedSystemForApi } from "./connectedSystems";

describe("connected-system public API serialization", () => {
  it("removes browser execution state, credentials, cookies and tokens recursively", () => {
    const publicValue = sanitizeConnectedSystemForApi({
      id: 4,
      configuration: {
        shadowMode: true,
        businessMapping: { stages: ["New"] },
        browserProfile: { storageState: { cookies: [{ value: "private" }] } },
        nested: { accessToken: "private", password: "private", safeLabel: "CRM" },
      },
    });
    expect(publicValue).toEqual({ id: 4, configuration: { shadowMode: true, businessMapping: { stages: ["New"] }, nested: { safeLabel: "CRM" } } });
    expect(JSON.stringify(publicValue)).not.toContain("private");
  });
});
