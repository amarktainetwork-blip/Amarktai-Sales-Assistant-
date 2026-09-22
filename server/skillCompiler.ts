import { and, desc, eq } from "drizzle-orm";
import { approvalTemplates } from "../drizzle/schema";
import {
  SKILL_STEP_ACTIONS,
  normalizeSkillDefinition,
  simulateSkillDefinition,
  type SkillDefinition,
} from "../shared/skillBuilder";
import { getDb } from "./db";
import { runGenxAgent } from "./genx";

function parseJsonObject(value: string) {
  const cleaned = value
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start)
    throw new Error("SKILL_COMPILER_INVALID_JSON: no JSON object was returned.");
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}

function safeKey(value: unknown) {
  return typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 140)
    : "";
}
export function buildSkillCompilerInstruction(input: {
  sop: string;
  approvedTemplates: Array<{ templateKey: string; title: string }>;
}) {
  const templates = input.approvedTemplates.length
    ? input.approvedTemplates
        .map(item => "- " + item.templateKey + ": " + item.title)
        .join("\n")
    : "- No approved templates are mapped yet. Use semantic template-purpose keys and list them in requiredMappings.";

  return [
    "Convert the supplied company sales SOP into one safe declarative AmarktAI organisation skill.",
    "Return STRICT JSON only. Never return markdown, commentary, JavaScript, shell, selectors, credentials, cookies, customer values, or executable source.",
    "Do not invent missing company rules. Put unresolved exact fields, stages, task names or template mappings in requiredMappings.",
    "Every outbound communication step must use prepare_email, prepare_sms or prepare_whatsapp and include a templateKey. If the exact template is unknown, use a clear semantic mapping key rather than inventing message copy.",
    "Use set_internal_priority only for AmarktAI's own queue ordering. It is not a CRM write.",
    "Classify definition.kind as workflow for a process, priority for internal queue ordering, or guard for a rule that must be checked whenever another governed action is prepared.",
    "Compile deterministic matching conditions into definition.match. Allowed condition sources are customer, task, opportunity, history and time. Allowed operators are equals, not_equals, contains, not_contains, one_of, exists, not_exists, before and after. Fields are bounded semantic paths such as title, status, stage, tags, courseInterest, recentInbound or dueAt. If the SOP cannot be expressed safely with these conditions, list the missing capability/mapping instead of inventing logic.",
    "External mutations remain prepare/review actions only. Never imply that a CRM write or message was executed.",
    "Separate read and write requirements. Standard read capabilities include contacts.read, companies.read, opportunities.read, tasks.read, activities.read, notes.read, owners.read and pipelines.read.",
    "Standard write capabilities include contacts.write, companies.write, opportunities.write, tasks.write, activities.write, notes.write, owners.write, stage.write, email.send, sms.send, whatsapp.send, sequences.apply, dialler.launch, appointments.write, quotes.write and workflows.execute.",
    "If the SOP needs a Genie/browser function outside the standard capability list, add a semantic operation key in requiredOperations using custom.read.<name> or custom.write.<name>. Do not invent implementation selectors or code.",
    "Write capability requirements are requests only. The user must explicitly approve them before commissioning, and commissioning still requires deterministic proof before production use.",
    "Allowed step actions: " + SKILL_STEP_ACTIONS.join(", "),
    "",
    "Return this shape:",
    JSON.stringify({
      title: "Short skill name",
      playbookKey: "stable-kebab-case-key",
      definition: {
        kind: "workflow",
        summary: "What the skill achieves",
        trigger: "Exact business event that starts it",
        match: {
          all: [
            {
              source: "task",
              field: "title",
              operator: "equals",
              value: "Exact task title when known",
            },
          ],
          any: [],
          stopIf: [],
        },
        eligibility: ["human-readable rule"],
        stopConditions: ["rule"],
        decisionRules: ["if/then rule"],
        requiredReadCapabilities: ["contacts.read"],
        requiredWriteCapabilities: ["tasks.write"],
        requiredOperations: ["custom.read.templates"],
        requiredMappings: ["exact mapping still needed"],
        steps: [
          {
            id: "stable-step-id",
            action: "read_customer",
            label: "Human readable step",
            templateKey: "only when required",
            timingRule: "only when required",
            inputs: { stage: "exact known tenant value" },
            requiresInput: ["runtime fact required from the real customer interaction"],
            requiredEvidence: ["only for consequential completion"],
          },
        ],
        assertions: ["deterministic testable invariant"],
        parameters: { key: "tenant-specific value" },
      },
    }),
    "",
    "Approved organisation templates currently known:",
    templates,
    "",
    "COMPANY SOP:",
    input.sop,
  ].join("\n");
}
export async function compileOrganisationSkill(input: {
  userId: number;
  organisationId: number;
  sop: string;
}) {
  const sop = input.sop.trim().slice(0, 30_000);
  if (sop.length < 40)
    throw new Error(
      "SKILL_SOP_REQUIRED: describe the trigger, rules and expected outcome in more detail."
    );

  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");

  const templates = await db
    .select({
      templateKey: approvalTemplates.templateKey,
      title: approvalTemplates.title,
      version: approvalTemplates.version,
    })
    .from(approvalTemplates)
    .where(
      and(
        eq(approvalTemplates.organisationId, input.organisationId),
        eq(approvalTemplates.status, "published")
      )
    )
    .orderBy(desc(approvalTemplates.updatedAt), desc(approvalTemplates.version))
    .limit(300);
  const uniqueTemplates = Array.from(
    new Map(
      templates.map(item => [
        item.templateKey,
        { templateKey: item.templateKey, title: item.title },
      ])
    ).values()
  );

  const response = await runGenxAgent({
    agentKey: "workflow_guardian",
    messages: [
      {
        role: "user",
        content: buildSkillCompilerInstruction({
          sop,
          approvedTemplates: uniqueTemplates,
        }),
      },
    ],
    workingContext:
      "This is manager-authorised organisation skill compilation. Produce configuration only. Do not execute external actions.",
    billing: {
      userId: input.userId,
      organisationId: input.organisationId,
      feature: "skill_builder_compile",
      reference: "organisation-skill-draft",
    },
    maxContextChars: 42_000,
    maxOutputTokens: 2_400,
  });

  const parsed = parseJsonObject(response.content);
  const title =
    typeof parsed.title === "string" ? parsed.title.trim().slice(0, 220) : "";
  const playbookKey = safeKey(parsed.playbookKey || title);
  if (!title || !playbookKey)
    throw new Error(
      "SKILL_COMPILER_INVALID_OUTPUT: the proposed skill needs a name and stable key."
    );
  const rawDefinition =
    parsed.definition &&
    typeof parsed.definition === "object" &&
    !Array.isArray(parsed.definition)
      ? (parsed.definition as Record<string, unknown>)
      : {};

  const definition: SkillDefinition = normalizeSkillDefinition({
    ...rawDefinition,
    source: "natural_language",
    sourcePrompt: sop,
    demoReserved: false,
  });
  const simulation = simulateSkillDefinition(definition);
  if (!definition.steps.length)
    throw new Error(
      "SKILL_COMPILER_EMPTY: no supported deterministic steps could be compiled from that SOP."
    );

  return {
    title,
    playbookKey,
    definition,
    simulation,
    provider: response.provider,
    creditsCharged: response.creditsCharged,
  };
}
