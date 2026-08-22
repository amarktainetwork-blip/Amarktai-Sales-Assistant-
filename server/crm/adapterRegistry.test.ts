import { describe, expect, it } from "vitest";
import { getCrmAdapter, listInstalledCrmAdapters } from "./adapterRegistry";

describe("CRM adapter registry", () => {
  it("installs the supported launch and calibrated-browser adapters", () => {
    expect(listInstalledCrmAdapters().sort()).toEqual(["custom_browser", "genie", "hubspot", "pipedrive", "salesforce", "zoho"].sort());
  });
  it("returns provider-specific adapters and fails closed for uninstalled placeholders", () => {
    expect(getCrmAdapter("hubspot").provider).toBe("hubspot");
    expect(getCrmAdapter("salesforce").provider).toBe("salesforce");
    expect(() => getCrmAdapter("custom_api")).toThrow(/not installed/i);
  });
});
