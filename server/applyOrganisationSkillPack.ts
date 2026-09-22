import "dotenv/config";
import { and, desc, eq } from "drizzle-orm";
import { playbookVersions } from "../drizzle/schema";
import {
  normalizeSkillDefinition,
  simulateSkillDefinition,
} from "../shared/skillBuilder";
import { getDb, recordAudit } from "./db";
import { COURSE2CAREER_SKILL_PACK } from "./skillPacks/course2career";

function integerFlag(name: string) {
  const prefix = `--${name}=`;
  const raw = process.argv.find(argument => argument.startsWith(prefix));
  const value = raw ? Number(raw.slice(prefix.length)) : NaN;
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`A positive --${name}= value is required.`);
  return value;
}

function textFlag(name: string) {
  const prefix = `--${name}=`;
  return (
    process.argv.find(argument => argument.startsWith(prefix))?.slice(
      prefix.length
    ) || ""
  );
}

export async function applyOrganisationSkillPack(input: {
  organisationId: number;
  actorUserId: number;
  pack: "course2career";
  publish?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const seeds =
    input.pack === "course2career" ? COURSE2CAREER_SKILL_PACK : [];
  let created = 0;
  let published = 0;
  let awaitingWriteApproval = 0;
  let unchanged = 0;

  for (const seed of seeds) {
    const definition = normalizeSkillDefinition(seed.definition);
    const simulation = simulateSkillDefinition(definition);
    if (!simulation.valid)
      throw new Error(
        `Skill '${seed.key}' failed its declarative simulation and was not installed.`
      );
    const latest = (
      await db
        .select()
        .from(playbookVersions)
        .where(
          and(
            eq(playbookVersions.organisationId, input.organisationId),
            eq(playbookVersions.playbookKey, seed.key)
          )
        )
        .orderBy(desc(playbookVersions.version))
        .limit(1)
    )[0];
    if (
      latest &&
      latest.title === seed.title &&
      JSON.stringify(normalizeSkillDefinition(latest.inputSchema)) ===
        JSON.stringify(definition)
    ) {
      unchanged += 1;
      continue;
    }
    const version = (latest?.version || 0) + 1;
    const requiresWrite =
      definition.requiredWriteCapabilities.length > 0 ||
      definition.requiredOperations.some(operation =>
        operation.startsWith("custom.write.")
      );
    const status =
      input.publish && !requiresWrite ? ("published" as const) : ("draft" as const);
    if (status === "published") {
      await db
        .update(playbookVersions)
        .set({ status: "archived" })
        .where(
          and(
            eq(playbookVersions.organisationId, input.organisationId),
            eq(playbookVersions.playbookKey, seed.key),
            eq(playbookVersions.status, "published")
          )
        );
    }
    const result = await db.insert(playbookVersions).values({
      organisationId: input.organisationId,
      playbookKey: seed.key,
      version,
      title: seed.title,
      instructions: definition.summary,
      inputSchema: definition,
      status,
      createdByUserId: input.actorUserId,
      publishedByUserId: status === "published" ? input.actorUserId : null,
      publishedAt: status === "published" ? new Date() : null,
    });
    await recordAudit({
      userId: input.actorUserId,
      eventType: "organisation_skill_pack_installed",
      entityType: "playbook_version",
      entityId: String(result[0].insertId),
      summary: `${seed.title} version ${version} installed as ${status}.`,
      metadata: {
        organisationId: input.organisationId,
        pack: input.pack,
        playbookKey: seed.key,
        version,
        status,
      },
    });
    created += 1;
    if (status === "published") published += 1;
    if (requiresWrite) awaitingWriteApproval += 1;
  }

  return {
    pack: input.pack,
    organisationId: input.organisationId,
    created,
    unchanged,
    published,
    awaitingWriteApproval,
    reservedDemoSkillInstalled: false,
  };
}

async function main() {
  const pack = textFlag("pack");
  if (pack !== "course2career")
    throw new Error("--pack=course2career is required.");
  const result = await applyOrganisationSkillPack({
    organisationId: integerFlag("organisation-id"),
    actorUserId: integerFlag("actor-user-id"),
    pack,
    publish: process.argv.includes("--publish"),
  });
  process.stdout.write(
    JSON.stringify(
      {
        ...result,
        note:
          "The ELCAS/PPC production skill remains reserved for the supervised live teaching demonstration.",
      },
      null,
      2
    ) + "\n"
  );
}

if (process.argv[1]?.endsWith("applyOrganisationSkillPack.js"))
  main().catch(error => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
