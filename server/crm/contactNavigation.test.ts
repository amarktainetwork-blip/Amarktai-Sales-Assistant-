import { describe, it, expect, vi } from "vitest";
import {
  bindGenieContactNavigation,
  GENIE_PROVIDER_PACK,
} from "./providerPacks";
import { executeSavedBrowserScript } from "../browserConnectors/scriptEngine";
import type { Page } from "playwright-core";

describe("Genie contact reads from another CRM area", () => {
  const href = "https://crm.example/v2/location/test/contacts/smart_list/All";
  const snapshot = { controls: [{ selector: "#sb_contacts", href }] };
  it("enters the observed Contacts page when the current page has no Contacts sidebar", async () => {
    let current = "https://crm.example/settings";
    const page = {
      url: () => current,
      goto: vi.fn(async (url: string) => {
        current = url;
      }),
      waitForURL: vi.fn(async (target: string) => {
        if (!target.includes("contacts/smart_list") || current !== href)
          throw Error("Wrong CRM URL");
      }),
      waitForTimeout: vi.fn(async () => {}),
      locator: vi.fn((selector: string) => {
        if (selector === "#sb_contacts")
          throw Error("Settings has no Contacts sidebar");
        return {
          first: () => ({
            waitFor: async () => {
              if (current !== href) throw Error("Wrong CRM area");
            },
          }),
          waitFor: vi.fn(async () => {
            if (current !== href) throw Error("Wrong CRM area");
          }),
          count: vi.fn(async () => 0),
        };
      }),
    } as unknown as Page;
    const script = bindGenieContactNavigation(
      GENIE_PROVIDER_PACK.scripts.genie_contact_sync,
      snapshot
    );
    const authorizeNavigation = vi.fn(async () => {});
    const result = await executeSavedBrowserScript({
      page,
      script,
      inputs: {},
      artifactDirectory: "unused",
      artifactPrefix: "entry",
      authorizeNavigation,
    });
    expect(result.success, result.detail).toBe(true);
    expect(page.goto).toHaveBeenCalledWith(href, expect.anything());
    expect(authorizeNavigation).toHaveBeenCalledWith(href);
  });
  it("refuses missing or ambiguous tenant navigation instead of guessing a location", () => {
    const script = GENIE_PROVIDER_PACK.scripts.genie_contact_sync;
    expect(() => bindGenieContactNavigation(script, {})).toThrow(
      "NOT_CAPTURED"
    );
    expect(() =>
      bindGenieContactNavigation(script, {
        controls: [
          ...snapshot.controls,
          { selector: "#sb_contacts", href: href.replace("/test/", "/other/") },
        ],
      })
    ).toThrow("NOT_CAPTURED");
    expect(() =>
      bindGenieContactNavigation(script, {
        controls: [
          { selector: "#sb_contacts", href: "https://crm.example/logout" },
        ],
      })
    ).toThrow("INVALID");
  });
  it("leaves direct contact reads and unrelated custom scripts intact", () => {
    const script = GENIE_PROVIDER_PACK.scripts.genie_contact_read;
    expect(bindGenieContactNavigation(script, {})).toBe(script);
  });
});
