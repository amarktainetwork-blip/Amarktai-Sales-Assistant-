import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";

export const RESET_CONFIRM_PREFIX = "DELETE_LOCAL_CLIENT_ONBOARDING";
const DEFAULT_EVIDENCE_ROOT = "/app/data/connector-evidence/onboarding-reset-backups";

type Args = {
  organisationId?: number;
  expectedCompany?: string;
  expectedDomain?: string;
  confirm?: string;
  apply: boolean;
};

type OrganisationRow = RowDataPacket & {
  id: number;
  name: string;
  slug: string;
  ownerUserId: number;
  createdAt: Date | string;
};

type CompanyProfileRow = RowDataPacket & {
  id: number;
  companyName: string;
  websiteUrl: string | null;
  discoveryStatus: string;
};

type ConnectedSystemRow = RowDataPacket & {
  id: number;
  provider: string;
  displayName: string;
  connectionMethod: string;
  status: string;
};

type OrgColumnRow = RowDataPacket & {
  tableName: string;
};

type OrgForeignKeyRow = RowDataPacket & {
  tableName: string;
  deleteRule: string;
};

type CountRow = RowDataPacket & { count: number };

function clean(value: string | undefined) {
  return value?.trim();
}

export function normalizeExpectedDomain(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) throw new Error("RESET_EXPECTED_DOMAIN_REQUIRED");
  const url = trimmed.includes("://")
    ? new URL(trimmed)
    : new URL(`https://${trimmed}`);
  return url.hostname.replace(/^www\./, "");
}

export function websiteMatchesDomain(
  websiteUrl: string | null | undefined,
  expectedDomain: string
) {
  if (!websiteUrl) return false;
  try {
    return normalizeExpectedDomain(websiteUrl) === normalizeExpectedDomain(expectedDomain);
  } catch {
    return false;
  }
}

export function confirmationToken(input: {
  organisationId: number;
  slug: string;
}) {
  return `${RESET_CONFIRM_PREFIX}:${input.organisationId}:${input.slug}`;
}

export function parseResetArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  let apply = false;
  for (const arg of argv) {
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) values.set(match[1], match[2]);
  }
  const rawId = clean(values.get("organisation-id"));
  const organisationId = rawId ? Number(rawId) : undefined;
  if (
    organisationId !== undefined &&
    (!Number.isInteger(organisationId) || organisationId <= 0)
  )
    throw new Error("RESET_ORGANISATION_ID_INVALID");
  return {
    organisationId,
    expectedCompany: clean(values.get("expected-company")),
    expectedDomain: clean(values.get("expected-domain")),
    confirm: clean(values.get("confirm")),
    apply,
  };
}

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z0-9_]+$/.test(identifier))
    throw new Error("RESET_UNSAFE_DATABASE_IDENTIFIER");
  return `\`${identifier}\``;
}

async function organisationColumns(connection: Connection) {
  const [rows] = await connection.query<OrgColumnRow[]>(
    `SELECT TABLE_NAME AS tableName
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND COLUMN_NAME = 'organisationId'
      ORDER BY TABLE_NAME`
  );
  return rows.map(row => row.tableName).filter(name => name !== "organisations");
}

async function organisationForeignKeys(connection: Connection) {
  const [rows] = await connection.query<OrgForeignKeyRow[]>(
    `SELECT k.TABLE_NAME AS tableName, rc.DELETE_RULE AS deleteRule
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
       JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
         ON rc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
        AND rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        AND rc.TABLE_NAME = k.TABLE_NAME
      WHERE k.CONSTRAINT_SCHEMA = DATABASE()
        AND k.COLUMN_NAME = 'organisationId'
        AND k.REFERENCED_TABLE_NAME = 'organisations'
      ORDER BY k.TABLE_NAME`
  );
  return rows;
}

async function scopedCounts(
  connection: Connection,
  organisationId: number,
  tables: string[]
) {
  const result: Record<string, number> = {};
  for (const table of tables) {
    const [rows] = await connection.query<CountRow[]>(
      `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)} WHERE organisationId = ?`,
      [organisationId]
    );
    result[table] = Number(rows[0]?.count || 0);
  }
  return result;
}

async function writeEvidence(input: {
  organisation: OrganisationRow;
  profiles: CompanyProfileRow[];
  systems: ConnectedSystemRow[];
  counts: Record<string, number>;
  foreignKeys: OrgForeignKeyRow[];
  apply: boolean;
}) {
  const root = process.env.ONBOARDING_RESET_EVIDENCE_DIR || DEFAULT_EVIDENCE_ROOT;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(
    root,
    `${stamp}-org-${input.organisation.id}-${input.apply ? "applied" : "dry-run"}.json`
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        purpose: "client_onboarding_reset",
        destructiveScope: "amarktai_local_organisation_only",
        externalCrmMutations: 0,
        externalMailboxMutations: 0,
        organisation: {
          id: input.organisation.id,
          name: input.organisation.name,
          slug: input.organisation.slug,
          ownerUserId: input.organisation.ownerUserId,
          createdAt: input.organisation.createdAt,
        },
        companyProfiles: input.profiles.map(profile => ({
          id: profile.id,
          companyName: profile.companyName,
          websiteUrl: profile.websiteUrl,
          discoveryStatus: profile.discoveryStatus,
        })),
        connectedSystems: input.systems.map(system => ({
          id: system.id,
          provider: system.provider,
          displayName: system.displayName,
          connectionMethod: system.connectionMethod,
          status: system.status,
        })),
        rowCounts: input.counts,
        organisationForeignKeys: input.foreignKeys,
      },
      null,
      2
    ),
    { encoding: "utf8", mode: 0o600 }
  );
  return path;
}

async function loadTarget(connection: Connection, organisationId: number) {
  const [organisations] = await connection.query<OrganisationRow[]>(
    `SELECT id, name, slug, ownerUserId, createdAt
       FROM organisations
      WHERE id = ?
      LIMIT 1`,
    [organisationId]
  );
  const organisation = organisations[0];
  if (!organisation) throw new Error("RESET_ORGANISATION_NOT_FOUND");
  const [profiles] = await connection.query<CompanyProfileRow[]>(
    `SELECT id, companyName, websiteUrl, discoveryStatus
       FROM companyProfiles
      WHERE organisationId = ?
      ORDER BY id`,
    [organisationId]
  );
  const [systems] = await connection.query<ConnectedSystemRow[]>(
    `SELECT id, provider, displayName, connectionMethod, status
       FROM connectedSystems
      WHERE organisationId = ?
      ORDER BY id`,
    [organisationId]
  );
  return { organisation, profiles, systems };
}

export async function resetClientOnboarding(args: Args) {
  if (!args.organisationId) throw new Error("RESET_ORGANISATION_ID_REQUIRED");
  if (!args.expectedCompany) throw new Error("RESET_EXPECTED_COMPANY_REQUIRED");
  if (!args.expectedDomain) throw new Error("RESET_EXPECTED_DOMAIN_REQUIRED");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");

  const connection = await mysql.createConnection(databaseUrl);
  try {
    const { organisation, profiles, systems } = await loadTarget(
      connection,
      args.organisationId
    );
    const matchingProfile = profiles.find(
      profile =>
        profile.companyName.trim().toLowerCase() ===
          args.expectedCompany!.trim().toLowerCase() &&
        websiteMatchesDomain(profile.websiteUrl, args.expectedDomain!)
    );
    if (!matchingProfile)
      throw new Error(
        "RESET_TARGET_IDENTITY_MISMATCH: the organisation does not contain the exact expected company/domain profile."
      );

    const tables = await organisationColumns(connection);
    const foreignKeys = await organisationForeignKeys(connection);
    const counts = await scopedCounts(connection, args.organisationId, tables);
    const expectedConfirm = confirmationToken({
      organisationId: organisation.id,
      slug: organisation.slug,
    });
    const evidencePath = await writeEvidence({
      organisation,
      profiles,
      systems,
      counts,
      foreignKeys,
      apply: args.apply,
    });

    console.log(`RESET_MODE=${args.apply ? "APPLY" : "DRY_RUN"}`);
    console.log(`ORGANISATION_ID=${organisation.id}`);
    console.log(`ORGANISATION_NAME=${organisation.name}`);
    console.log(`ORGANISATION_SLUG=${organisation.slug}`);
    console.log(`EXPECTED_COMPANY_MATCH=PASS`);
    console.log(`EXPECTED_DOMAIN_MATCH=PASS`);
    console.log(`EXTERNAL_CRM_MUTATIONS=0`);
    console.log(`EXTERNAL_MAILBOX_MUTATIONS=0`);
    console.log(`EVIDENCE_PATH=${evidencePath}`);
    console.log(`REQUIRED_CONFIRM=${expectedConfirm}`);
    console.log(`SCOPED_ROW_COUNTS=${JSON.stringify(counts)}`);

    if (!args.apply) {
      console.log("RESET_RESULT=DRY_RUN_PASS");
      return { applied: false, evidencePath, expectedConfirm, counts };
    }
    if (args.confirm !== expectedConfirm)
      throw new Error(
        `RESET_CONFIRMATION_MISMATCH: rerun with --confirm=${expectedConfirm}`
      );

    await connection.beginTransaction();
    try {
      // Tables whose organisation FK intentionally survives with SET NULL must
      // be removed first, otherwise customer-labelled records would remain.
      const setNullTables = foreignKeys
        .filter(row => row.deleteRule.toUpperCase() === "SET NULL")
        .map(row => row.tableName);
      for (const table of setNullTables)
        await connection.query(
          `DELETE FROM ${quoteIdentifier(table)} WHERE organisationId = ?`,
          [organisation.id]
        );

      // The organisation is the destructive root. CASCADE constraints remove
      // connector secrets, CRM cache, commissioning, learned operations,
      // knowledge jobs and every other organisation-owned child.
      const [deleted] = await connection.execute<mysql.ResultSetHeader>(
        `DELETE FROM organisations WHERE id = ?`,
        [organisation.id]
      );
      if (deleted.affectedRows !== 1)
        throw new Error("RESET_ROOT_DELETE_FAILED");

      // Detect any organisationId-bearing table that was not correctly wired
      // to the tenant lifecycle. Never commit a partial client reset.
      const survivors = await scopedCounts(connection, organisation.id, tables);
      const nonZero = Object.entries(survivors).filter(([, count]) => count > 0);
      if (nonZero.length)
        throw new Error(
          `RESET_ORPHANED_ROWS_DETECTED:${JSON.stringify(Object.fromEntries(nonZero))}`
        );

      await connection.commit();
      console.log("LOCAL_CLIENT_DATA_DELETED=PASS");
      console.log("USER_ACCOUNT_DELETED=NO");
      console.log("FRESH_SIGN_IN_REQUIRED=YES");
      console.log("RESET_RESULT=PASS");
      return { applied: true, evidencePath, expectedConfirm, counts };
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } finally {
    await connection.end();
  }
}

async function main() {
  const args = parseResetArgs(process.argv.slice(2));
  await resetClientOnboarding(args);
}

const invokedAsScript = process.argv[1]?.endsWith("resetClientOnboarding.js") ||
  process.argv[1]?.endsWith("resetClientOnboarding.ts");
if (invokedAsScript)
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
