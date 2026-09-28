import { describe, expect, it } from "vitest";
import type { ResolvedAssistantCustomerContext } from "./assistantCustomerContext";
import {
  compileLearnedSkillRuntime,
  skillMatchesContext,
} from "./skillRuntime";
import {
  COURSE2CAREER_LIVE_DEMO_RESERVATION,
  COURSE2CAREER_SKILL_PACK,
} from "./skillPacks/course2career";

function customer(
  overrides: Partial<ResolvedAssistantCustomerContext> = {}
): ResolvedAssistantCustomerContext {
  return {
    source: "manual_resolved",
    connectedSystemId: 7,
    provider: "genie",
    contactExternalId: "contact-123",
    contactName: "Test Candidate",
    firstName: "Test",
    lastName: "Candidate",
    email: "candidate@example.com",
    phone: "+441234567890",
    contactStatus: "New Lead – Uncontacted",
    courseInterest: "IT Support",
    courseInterestValues: ["IT Support"],
    customerTags: [],
    reasons: [],
    targetVerification: {
      verified: true,
      source: "assistant_customer_selector",
      connectedSystemId: 7,
      contactExternalId: "contact-123",
    },
    operationalRecordState: {
      openTasks: [
        {
          externalId: "task-1",
          title: "First Call",
          status: "OPEN",
          dueAt: "2026-09-22T09:00:00.000Z",
        },
      ],
      currentActiveTaskExternalId: "task-1",
      openOpportunities: [
        {
          externalId: "opp-1",
          name: "Current opportunity",
          stage: "New Lead – Uncontacted",
        },
      ],
      currentActiveOpportunityExternalId: "opp-1",
      historicalCompletedTaskCount: 0,
      historicalClosedOpportunityCount: 0,
    },
    ...overrides,
  };
}

describe("learned organisation skill runtime", () => {
  it("matches the reserved ELCAS/PPC priority rule without creating CRM actions", () => {
    const result = compileLearnedSkillRuntime({
      skillKey: COURSE2CAREER_LIVE_DEMO_RESERVATION.key,
      definition: COURSE2CAREER_LIVE_DEMO_RESERVATION.definition,
      customer: customer({ customerTags: ["PPC"] }),
      runtimeInputs: { taskDueState: "due" },
    });

    expect(result.matches).toBe(true);
    expect(result.actions).toEqual([]);
    expect(result.internalEffects).toEqual([
      expect.objectContaining({ type: "priority", value: "very_high" }),
    ]);
  });

  it("does not match the reserved priority rule for an unrelated tag", () => {
    expect(
      skillMatchesContext({
        definition: COURSE2CAREER_LIVE_DEMO_RESERVATION.definition,
        customer: customer({ customerTags: ["Organic"] }),
        runtimeInputs: { taskDueState: "due" },
      })
    ).toBe(false);
  });

  it("compiles same-day reattempt into a learned custom task-reschedule action", () => {
    const skill = COURSE2CAREER_SKILL_PACK.find(
      item => item.key === "same-day-evening-first-call-reattempt"
    )!;
    const result = compileLearnedSkillRuntime({
      skillKey: skill.key,
      definition: skill.definition,
      customer: customer(),
      runtimeInputs: {
        lastCallOutcome: "no_answer",
        customerResponded: false,
        morningCallOutcome: "No answer",
        fundingReady: true,
      },
    });

    expect(result.matches).toBe(true);
    expect(result.internalEffects).toEqual([
      expect.objectContaining({ type: "priority", value: "very_high" }),
    ]);
    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "custom_crm_action",
          payload: expect.objectContaining({
            actionName: "custom.write.task_reschedule",
            taskExternalId: "task-1",
          }),
        }),
      ])
    );
  });

  it("compiles a first-class custom CRM write against the exact requested target", () => {
    const result = compileLearnedSkillRuntime({
      skillKey: "custom-stage-helper",
      definition: {
        trigger: "The current opportunity needs a custom CRM marker",
        requiredOperations: ["custom.write.mark_reviewed"],
        requiredWriteCapabilities: ["custom.write.mark_reviewed"],
        steps: [
          {
            id: "mark-reviewed",
            action: "prepare_crm_operation",
            label: "Prepare reviewed marker",
            inputs: {
              operationKey: "custom.write.mark_reviewed",
              targetKind: "opportunity",
              marker: "reviewed",
            },
          },
        ],
        assertions: ["The action remains review-only"],
      },
      customer: customer(),
    });
    expect(result.actions).toEqual([
      expect.objectContaining({
        actionType: "custom_crm_action",
        payload: expect.objectContaining({
          actionName: "custom.write.mark_reviewed",
          externalId: "opp-1",
          opportunityExternalId: "opp-1",
          contactExternalId: "contact-123",
          reviewRequired: true,
        }),
      }),
    ]);
  });

  it("compiles a commissioned appointment operation through the generic learned CRM action", () => {
    const result = compileLearnedSkillRuntime({
      skillKey: "appointment-helper",
      definition: {
        trigger: "The salesperson confirms an appointment should be prepared",
        requiredWriteCapabilities: ["appointments.write"],
        requiredOperations: ["appointment.book"],
        steps: [
          {
            id: "book-appointment",
            action: "prepare_crm_operation",
            label: "Prepare appointment",
            inputs: {
              operationKey: "appointment.book",
              targetKind: "contact",
            },
          },
        ],
        assertions: ["Review is required"],
      },
      customer: customer(),
    });
    expect(result.actions[0]).toMatchObject({
      actionType: "custom_crm_action",
      payload: {
        actionName: "appointment.book",
        externalId: "contact-123",
        contactExternalId: "contact-123",
        reviewRequired: true,
      },
    });
  });

  it("prepares the IT Support WhatsApp rule as review-only until exact template content is materialised", () => {
    const skill = COURSE2CAREER_SKILL_PACK.find(
      item => item.key === "it-support-whatsapp-template"
    )!;
    const result = compileLearnedSkillRuntime({
      skillKey: skill.key,
      definition: skill.definition,
      customer: customer(),
    });
    const message = result.actions.find(
      action => action.actionType === "send_whatsapp_template"
    );

    expect(result.matches).toBe(true);
    expect(message?.payload).toMatchObject({
      to: "+441234567890",
      templateName: "Missed Call WhatsApp",
      templateTransformation: expect.objectContaining({
        requiredPhrase: "IT Support inquiry",
      }),
    });
  });

  it("keeps missing runtime facts visible instead of inventing them", () => {
    const skill = COURSE2CAREER_SKILL_PACK.find(
      item => item.key === "answered-first-call-consultation"
    )!;
    const definition = {
      ...skill.definition,
      match: { all: [], any: [], stopIf: [] },
      steps: [
        {
          id: "notes",
          action: "prepare_note",
          label: "Prepare factual consultation notes",
          requiresInput: ["consultationNotes"],
        },
      ],
    };
    const result = compileLearnedSkillRuntime({
      skillKey: skill.key,
      definition,
      customer: customer(),
    });

    expect(result.actions[0]?.payload).toMatchObject({
      draftOnly: true,
      executionReady: false,
      missingRuntimeInputs: ["consultationNotes"],
    });
  });

  it("uses exact customer and opportunity identifiers in learned proposals", () => {
    const skill = COURSE2CAREER_SKILL_PACK.find(
      item => item.key === "opportunity-ownership-guard"
    )!;
    const result = compileLearnedSkillRuntime({
      skillKey: skill.key,
      definition: skill.definition,
      customer: customer(),
      runtimeInputs: { opportunityPendingWrite: true },
    });

    expect(result.matches).toBe(true);
    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "update_current_opportunity",
          payload: expect.objectContaining({
            contactExternalId: "contact-123",
            opportunityExternalId: "opp-1",
            preferredConnectedSystemId: 7,
          }),
        }),
      ])
    );
  });
});
