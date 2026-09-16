import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { companyProfiles } from "../drizzle/schema";
import { getDb, upsertCompanyProfile } from "./db";
import { saveOrganisationWorkspaceConfiguration } from "./organisationWorkspace";
import {
  getClientActionConfiguration,
  saveClientActionConfiguration,
} from "./clientActionConfiguration";
import { getConnectedSystemForUser } from "./connectedSystems";
/** Explicit administrator operation: updates internal client facts only; never enables capabilities. */
export async function applyClientConfiguration(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
  packPath: string;
}) {
  const pack = JSON.parse(await readFile(input.packPath, "utf8"));
  const system = await getConnectedSystemForUser(
    input.userId,
    input.organisationId,
    input.connectedSystemId
  );
  if (system.allowedWriteCapabilities.length)
    throw Error("READ_ONLY_COMMISSIONING_REQUIRED");
  const workspace = await saveOrganisationWorkspaceConfiguration({
    ...pack,
    userId: input.userId,
    organisationId: input.organisationId,
  });
  const db = await getDb();
  if (!db) throw Error("Database connection is unavailable.");
  const [profile] = await db
    .select()
    .from(companyProfiles)
    .where(eq(companyProfiles.organisationId, input.organisationId))
    .limit(1);
  await upsertCompanyProfile({
    ...profile,
    ...pack.profile,
    userId: input.userId,
    organisationId: input.organisationId,
  });
  const configuration = await getClientActionConfiguration(input);
  if (pack.officeHours)
    await saveClientActionConfiguration({
      userId: input.userId,
      organisationId: input.organisationId,
      configuration: { ...configuration, officeHours: pack.officeHours },
    });
  const after = await getConnectedSystemForUser(
    input.userId,
    input.organisationId,
    input.connectedSystemId
  );
  if (after.allowedWriteCapabilities.length)
    throw Error("WRITE_CAPABILITIES_CHANGED");
  return {
    organisation: workspace.organisation,
    customerModel: workspace.customerModel,
    allowedWriteCapabilities: after.allowedWriteCapabilities,
  };
}
