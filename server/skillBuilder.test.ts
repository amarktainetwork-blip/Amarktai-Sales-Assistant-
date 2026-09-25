import { describe, expect, it } from "vitest";
import {
  normalizeSkillDefinition,
  simulateSkillDefinition,
} from "../shared/skillBuilder";
import {
  COURSE2CAREER_LIVE_DEMO_RESERVATION,
  COURSE2CAREER_SKILL_PACK,
} from "./skillPacks/course2career";

describe("organisation skill builder contract", () => {
  it("normalizes a declarative workflow without executable source", () => {
    const definition = normalizeSkillDefinition({
      schemaVersion: 99,
      summary: "Follow up an unanswered call",
      trigger: "A due follow-up task is selected",
      eligibility: ["one exact current contact"],
      stopConditions: ["customer replied"],
      steps: [
        {
          id: "read",
          action: "read_customer",
          label: "Read the current contact",
        },
        {
          id: "draft",
          action: "prepare_email",
          label: "Prepare the approved email",
          templateKey: "consultant-contact-failed",
        },
      ],
      assertions: ["No communication was sent"],
      sourceCode: "process.exit(1)",
    });

    expect(definition.schemaVersion).toBe(1);
    expect(definition.steps).toHaveLength(2);
    expect(JSON.stringify(definition)).not.toContain("sourceCode");
  });

  it("passes a bounded review-first skill simulation", () => {
    const result = simulateSkillDefinition({
      summary: "Prepare a reviewed follow-up",
      trigger: "A due task has no inbound response",
      eligibility: ["customer and task were freshly read"],
      stopConditions: ["response exists"],
      steps: [
        {
          id: "read-contact",
          action: "read_customer",
          label: "Read the exact customer",
        },
        {
          id: "prepare-email",
          action: "prepare_email",
          label: "Prepare the approved email",
          templateKey: "permission-to-close",
        },
        {
          id: "prepare-task",
          action: "prepare_task",
          label: "Prepare the next due task",
        },
      ],
      assertions: ["No duplicate open task"],
    });

    expect(result.valid).toBe(true);
    expect(result.trace).toContain(
      "2. Prepare the approved email [prepare_email] using permission-to-close"
    );
  });

  it("fails closed when communication has no approved template", () => {
    const result = simulateSkillDefinition({
      trigger: "A lead arrives",
      steps: [
        {
          id: "invent-message",
          action: "prepare_sms",
          label: "Write any message",
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(
      result.checks.find(check => check.key === "approved_templates")
    ).toMatchObject({ passed: false });
  });

  it("ships the supplied tenant skills without preinstalling ELCAS/PPC", () => {
    expect(COURSE2CAREER_SKILL_PACK.map(skill => skill.key)).toEqual([
      "four-day-new-lead-contact",
      "last-try-no-response-closure",
      "renewal-sequence",
      "invalid-contact-complete",
      "answered-first-call-consultation",
      "same-day-evening-first-call-reattempt",
      "opportunity-ownership-guard",
      "it-support-failed-contact-communications",
      "it-support-whatsapp-template",
      "post-consultation-follow-up",
      "due-call-task-awareness",
    ]);
    expect(
      COURSE2CAREER_SKILL_PACK.every(skill =>
        simulateSkillDefinition(skill.definition).valid
      )
    ).toBe(true);
    expect(JSON.stringify(COURSE2CAREER_SKILL_PACK)).not.toMatch(/elcas|ppc/i);
  });

  it("keeps invalid-contact handling limited to the confirmed Stage 1 rule", () => {
    const skill = COURSE2CAREER_SKILL_PACK.find(
      item => item.key === "invalid-contact-complete"
    )!;
    const actions = skill.definition.steps.map(step => step.action);
    expect(skill.title).toBe("Invalid contact details — Stage 1");
    expect(skill.definition.parameters).toMatchObject({
      ruleCompletionStatus: "NEEDS_RULE_COMPLETION",
    });
    expect(skill.definition.requiredMappings).toEqual([
      "Consultant Contact Emails / Invalid Phone Number",
    ]);
    expect(skill.definition.requiredWriteCapabilities).toEqual(
      expect.arrayContaining(["email.send", "notes.write"])
    );
    expect(skill.definition.requiredWriteCapabilities).not.toEqual(
      expect.arrayContaining([
        "sms.send",
        "whatsapp.send",
        "tasks.write",
        "opportunities.write",
        "contacts.write",
      ])
    );
    expect(actions).toContain("prepare_email");
    expect(actions).toContain("prepare_note");
    expect(actions).not.toContain("prepare_sms");
    expect(actions).not.toContain("prepare_whatsapp");
    expect(actions).not.toContain("prepare_task");
    expect(actions).not.toContain("complete_task_after_review");
    expect(actions).not.toContain("prepare_opportunity_update");
    expect(actions).not.toContain("prepare_contact_update");
    expect(skill.definition.parameters).not.toHaveProperty(
      "specialSmsDestinationOverride"
    );
    expect(skill.definition.parameters).not.toHaveProperty("lostStage");
    expect(skill.definition.parameters).not.toHaveProperty("lostStatus");
  });

  it("captures Amy's same-day reattempt as a learned task-reschedule capability", () => {
    const skill = COURSE2CAREER_SKILL_PACK.find(
      item => item.key === "same-day-evening-first-call-reattempt"
    )!;
    expect(skill.definition.requiredOperations).toContain(
      "custom.write.task_reschedule"
    );
    expect(skill.definition.parameters).toMatchObject({
      timezone: "Europe/London",
      eveningWindowStart: "17:00",
      eveningWindowEnd: "18:00",
    });
    expect(skill.definition.writeApproval.status).toBe("approval_required");
  });

  it("models opportunity ownership as a guard rather than an isolated workflow", () => {
    const skill = COURSE2CAREER_SKILL_PACK.find(
      item => item.key === "opportunity-ownership-guard"
    )!;
    expect(skill.definition.kind).toBe("guard");
    expect(skill.definition.requiredWriteCapabilities).toEqual(
      expect.arrayContaining(["opportunities.write", "owners.write"])
    );
    expect(skill.definition.parameters).toMatchObject({
      requiredOwnerDisplayName: "Amelia",
      followersAreNotOwners: "true",
    });
  });

  it("models IT Support failed-contact template tailoring without free-form sends", () => {
    const skill = COURSE2CAREER_SKILL_PACK.find(
      item => item.key === "it-support-failed-contact-communications"
    )!;
    const email = skill.definition.steps.find(
      step => step.id === "prepare-it-failed-contact-email"
    )!;
    expect(email.templateKey).toBe("Failed Contact General");
    expect(email.inputs).toMatchObject({
      requiredPhrase: "IT Support inquiry",
      forbiddenProgrammeReferences:
        "Cyber Security|Project Management|Data Analytics",
    });
    expect(skill.definition.requiredMappings).toContain(
      "Exact current Genie general failed-contact text template to use for IT Support"
    );
  });

  it("models the IT Support WhatsApp rule against the approved Missed Call template", () => {
    const skill = COURSE2CAREER_SKILL_PACK.find(
      item => item.key === "it-support-whatsapp-template"
    )!;
    const message = skill.definition.steps.find(
      step => step.action === "prepare_whatsapp"
    )!;
    expect(message.templateKey).toBe("Missed Call WhatsApp");
    expect(message.inputs).toMatchObject({
      requiredPhrase: "IT Support inquiry",
    });
    expect(skill.definition.writeApproval.status).toBe("approval_required");
  });

  it("keeps a live-demo skill ineligible for publication", () => {
    const result = simulateSkillDefinition({
      ...COURSE2CAREER_LIVE_DEMO_RESERVATION.definition,
      trigger: "ELCAS or PPC lead is selected",
      steps: [
        {
          id: "read",
          action: "read_customer",
          label: "Read the current lead",
        },
      ],
      assertions: ["No write occurred"],
      demoReserved: true,
    });

    expect(result.valid).toBe(false);
    expect(
      result.checks.find(check => check.key === "demo_reservation")
    ).toMatchObject({ passed: false });
  });
});
