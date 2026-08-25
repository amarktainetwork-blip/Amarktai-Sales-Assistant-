import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimPersistentGenieProfile,
  getPersistentGenieContext,
  releasePersistentGenieProfile,
} from "./geniePersistentProfile";
import type { AdapterConnection } from "../crm/types";

function connection(id: number, organisationId = 11): AdapterConnection {
  return {
    id,
    organisationId,
    provider: "genie",
    displayName: "Genie",
    baseUrl: "https://genie.example.test/",
    connectionMethod: "browser",
    allowedReadCapabilities: [],
    allowedWriteCapabilities: [],
    verifiedCapabilities: [],
    scopes: [],
    configuration: {},
  };
}

afterEach(() => {
  delete process.env.GENIE_PERSISTENT_PROFILE_BINDING_PATH;
});

describe("persistent Genie browser profile ownership", () => {
  it("binds the profile to one connected system and allows that owner to reuse it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amarktai-genie-profile-"));
    const path = join(directory, "owner.json");
    process.env.GENIE_PERSISTENT_PROFILE_BINDING_PATH = path;

    await expect(claimPersistentGenieProfile(connection(7))).resolves.toMatchObject({
      organisationId: 11,
      connectedSystemId: 7,
    });
    await expect(claimPersistentGenieProfile(connection(7))).resolves.toMatchObject({
      organisationId: 11,
      connectedSystemId: 7,
    });

    const persisted = JSON.parse(await readFile(path, "utf8"));
    expect(persisted).toEqual({
      version: 1,
      organisationId: 11,
      connectedSystemId: 7,
    });
  });

  it("fails closed if another connected system tries to reuse the trusted profile", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amarktai-genie-profile-"));
    process.env.GENIE_PERSISTENT_PROFILE_BINDING_PATH = join(directory, "owner.json");

    await claimPersistentGenieProfile(connection(7));
    await expect(claimPersistentGenieProfile(connection(8))).rejects.toThrow(
      "GENIE_PERSISTENT_PROFILE_IN_USE"
    );
  });

  it("releases only the exact owner so a fresh Genie connection can claim the profile", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amarktai-genie-profile-"));
    process.env.GENIE_PERSISTENT_PROFILE_BINDING_PATH = join(directory, "owner.json");

    await claimPersistentGenieProfile(connection(7));
    await expect(releasePersistentGenieProfile(connection(8))).rejects.toThrow(
      "GENIE_PERSISTENT_PROFILE_RELEASE_BLOCKED"
    );
    await expect(releasePersistentGenieProfile(connection(7))).resolves.toBe(true);
    await expect(claimPersistentGenieProfile(connection(8))).resolves.toMatchObject({
      connectedSystemId: 8,
    });
  });

  it("uses the single default CDP context instead of creating an incognito context", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amarktai-genie-profile-"));
    process.env.GENIE_PERSISTENT_PROFILE_BINDING_PATH = join(directory, "owner.json");
    const persistentContext = { newPage: vi.fn() };
    const browser = {
      contexts: vi.fn().mockReturnValue([persistentContext]),
      newContext: vi.fn(),
    };

    const result = await getPersistentGenieContext({
      browser: browser as never,
      connection: connection(7),
    });

    expect(result).toBe(persistentContext);
    expect(browser.newContext).not.toHaveBeenCalled();
  });
});
