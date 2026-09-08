import { describe, expect, it } from "vitest";
import { GENIE_PROVIDER_PACK_VERSION } from "../crm/providerPacks";
import { effectiveLatestBrowserOperation } from "./learnedOperations";

describe("canonical Genie provider-pack refresh", () => {
  const operation = (input: {
    status?: "TEST_READY" | "LIVE_PROVEN" | "BLOCKED";
    providerPack?: string;
    providerPackVersion?: string;
  }) => ({
    id: 1,
    version: 7,
    status: input.status || "LIVE_PROVEN",
    prerequisites: {
      ...(input.providerPack ? { providerPack: input.providerPack } : {}),
      ...(input.providerPackVersion
        ? { providerPackVersion: input.providerPackVersion }
        : {}),
    },
  });

  it("treats an older canonical Genie pack version as NOT_LEARNED while preserving its version", () => {
    const latest = effectiveLatestBrowserOperation(
      operation({
        providerPack: "genie",
        providerPackVersion: "genie-older-pack",
      })
    );
    expect(latest).toMatchObject({ version: 7, status: "NOT_LEARNED" });
  });

  it("keeps the current canonical Genie pack status unchanged", () => {
    const latest = effectiveLatestBrowserOperation(
      operation({
        status: "LIVE_PROVEN",
        providerPack: "genie",
        providerPackVersion: GENIE_PROVIDER_PACK_VERSION,
      })
    );
    expect(latest?.status).toBe("LIVE_PROVEN");
  });

  it("does not overwrite tenant or custom learned operations during a provider-pack refresh", () => {
    const tenant = effectiveLatestBrowserOperation(
      operation({
        status: "BLOCKED",
        providerPackVersion: "tenant-v1",
      })
    );
    expect(tenant?.status).toBe("BLOCKED");
  });
});
