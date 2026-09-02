import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClientActionConfiguration: vi.fn(),
}));

vi.mock("./clientActionConfiguration", async () => {
  const actual = await vi.importActual<typeof import("./clientActionConfiguration")>(
    "./clientActionConfiguration"
  );
  return {
    ...actual,
    getClientActionConfiguration: mocks.getClientActionConfiguration,
  };
});

import { buildConfiguredWorkflowPlan } from "./configuredWorkflow";
import type { ResolvedAssistantCustomerContext } from "./assistantCustomerContext";

function customer(input?: {
  taskTitle?: string;
  taskExternalId?: string;
  stage?: string;
}): ResolvedAssistantCustomerContext {
  const taskTitle = input?.taskTitle ?? "Attempt 1";
  const taskExternalId = input?.taskExternalId ?? "task-1";
  return {
    source: "manual_resolved",
    connectedSystemId: 10,
    provider: "genie",
    contactExternalId: "contact-1",
    contactName: "Test Customer",
    email: "customer@example.test",
    phone: "+447700900123",
    opportunityExternalId: "opp-1",
    opportunityName: "Current opportunity",
    stage: input?.stage ?? "New",
    reasons: [],
    targetVerification: {
      verified: true,
      source: "assistant_customer_selector",
      connectedSystemId: 10,
      contactExternalId: "contact-1",
    },
    operationalRecordState: {
      openTasks: [
        {
          externalId: taskExternalId,
          title: taskTitle,
          status: "open",
        },
      ],
      currentActiveTaskExternalId: taskExternalId,
      openOpportunities: [
        {
          externalId: "opp-1",
          name: "Current opportunity",
          stage: input?.stage ?? "New",
        },
      ],
      currentActiveOpportunityExternalId: "opp-1",
      historicalCompletedTaskCount: 3,
      historicalClosedOpportunityCount: 2,
    },
  } as ResolvedAssistantCustomerContext;
}

function firstContactConfiguration() {
  return {
    workflows: {
      first_contact: {
        taskAliases: {
          attempt_1: "Attempt 1",
          attempt_2: "Attempt 2",
          attempt_3: "Attempt 3",
          attempt_4: "Attempt 4",
        },
        taskSequence: ["attempt_1", "attempt_2", "attempt_3", "attempt_4"],
        sequence: [
          "verify_contact_context:current_customer",
          "send_sms_template:first_contact",
          "schedule_callback:follow_up",
        ],
        eligibilityStatuses: ["New"],
        stopStatuses: ["Contacted", "Closed"],
        opportunityMappings: {},
        statusMappings: {},
        templates: { first_contact: "first-sms" },
        timingRules: {
          attempt_2: "P1D",
          attempt_3: "P1D",
          attempt_4: "P1D",
          follow_up: "P1D",
        },
        duplicateRules: ["no_equivalent_open_task"],
        requiredPostconditions: ["task_readback"],
      },
    },
    templates: {
      "first-sms": {
        key: "first-sms",
        channel: "sms",
        source: "client_configuration",
        templateName: "First outreach",
        body: "Approved first-contact message.",
        senderIdentity: "+447700900999",
      },
    },
    approvedSenders: { sms: ["+447700900999"], whatsapp: ["+447700900999"] },
    duplicateRules: ["external_read_before_write"],
    closureMapping: {},
    requiredPostconditions: {},
    currentRecordRules: [],
    officeHours: {
      timezone: "Europe/London",
      days: [1, 2, 3, 4, 5],
      start: "09:00",
      end: "18:00",
    },
  };
}

beforeEach(() => {
  mocks.getClientActionConfiguration.mockReset();
});

describe("configured workflow materialization", () => {
  it("sends the initial message only on attempt one and schedules the exact next configured attempt", async () => {
    mocks.getClientActionConfiguration.mockResolvedValue(firstContactConfiguration());

    const attemptOne = await buildConfiguredWorkflowPlan({
      organisationId: 1,
      request: { workflowKey: "first_contact", leadLabel: "Test Customer" },
      customer: customer({ taskTitle: "Attempt 1", taskExternalId: "task-1" }),
    });

    expect(attemptOne.actions.map(action => action.actionType)).toContain(
      "send_sms_template"
    );
    expect(
      attemptOne.actions.find(action => action.actionType === "schedule_callback")
        ?.payload
    ).toMatchObject({
      taskPurpose: "attempt_2",
      taskTitle: "Attempt 2",
      workflowAttempt: {
        current: 1,
        maximum: 4,
        finalAttempt: false,
      },
    });

    const attemptTwo = await buildConfiguredWorkflowPlan({
      organisationId: 1,
      request: { workflowKey: "first_contact", leadLabel: "Test Customer" },
      customer: customer({ taskTitle: "Attempt 2", taskExternalId: "task-2" }),
    });

    expect(attemptTwo.actions.map(action => action.actionType)).not.toContain(
      "send_sms_template"
    );
    expect(
      attemptTwo.actions.find(action => action.actionType === "schedule_callback")
        ?.payload
    ).toMatchObject({ taskPurpose: "attempt_3", taskTitle: "Attempt 3" });
  });

  it("never creates a fifth attempt after the configured final attempt", async () => {
    mocks.getClientActionConfiguration.mockResolvedValue(firstContactConfiguration());

    const finalAttempt = await buildConfiguredWorkflowPlan({
      organisationId: 1,
      request: { workflowKey: "first_contact", leadLabel: "Test Customer" },
      customer: customer({ taskTitle: "Attempt 4", taskExternalId: "task-4" }),
    });

    expect(finalAttempt.actions.map(action => action.actionType)).not.toContain(
      "send_sms_template"
    );
    expect(finalAttempt.actions.map(action => action.actionType)).not.toContain(
      "schedule_callback"
    );
    expect(finalAttempt.actions[0]?.payload.workflowAttempt).toMatchObject({
      current: 4,
      maximum: 4,
      finalAttempt: true,
    });
  });

  it("uses outcome-specific post-consultation configuration so answered calls cannot inherit failed-contact messages", async () => {
    const base = firstContactConfiguration();
    mocks.getClientActionConfiguration.mockResolvedValue({
      ...base,
      workflows: {
        "post_consultation_follow_up:answered": {
          taskAliases: { post_follow_up: "Current Follow-up" },
          taskSequence: [],
          sequence: [
            "verify_contact_context:current_customer",
            "complete_active_task:post_follow_up",
            "append_contact_note:answered_notes",
            "update_current_opportunity:post_consultation",
          ],
          eligibilityStatuses: [],
          stopStatuses: ["Closed"],
          opportunityMappings: { post_consultation: "Considering" },
          statusMappings: {},
          templates: {},
          timingRules: {},
          duplicateRules: ["external_read_before_write"],
          requiredPostconditions: ["crm_readback"],
        },
        "post_consultation_follow_up:no_answer": {
          taskAliases: {
            post_follow_up: "Current Follow-up",
            follow_up: "Final Follow-up",
          },
          taskSequence: [],
          sequence: [
            "verify_contact_context:current_customer",
            "complete_active_task:post_follow_up",
            "append_contact_note:no_answer_notes",
            "update_current_opportunity:post_consultation",
            "send_email_template:follow_up_email",
            "send_sms_template:follow_up_sms",
            "send_whatsapp_template:follow_up_whatsapp",
            "schedule_callback:follow_up",
          ],
          eligibilityStatuses: [],
          stopStatuses: ["Closed"],
          opportunityMappings: { post_consultation: "Considering" },
          statusMappings: {},
          templates: {
            follow_up_email: "follow-email",
            follow_up_sms: "follow-sms",
            follow_up_whatsapp: "follow-wa",
          },
          timingRules: { follow_up: "P1D" },
          duplicateRules: ["external_read_before_write"],
          requiredPostconditions: ["crm_readback"],
        },
      },
      templates: {
        "follow-email": {
          key: "follow-email",
          channel: "email",
          source: "client_configuration",
          templateName: "Follow-up email",
          body: "Approved email body.",
          requiredSubject: "Approved subject",
        },
        "follow-sms": {
          key: "follow-sms",
          channel: "sms",
          source: "client_configuration",
          templateName: "Follow-up SMS",
          body: "Approved SMS body.",
          senderIdentity: "+447700900999",
        },
        "follow-wa": {
          key: "follow-wa",
          channel: "whatsapp",
          source: "client_configuration",
          templateName: "Follow-up WhatsApp",
          body: "Approved WhatsApp body.",
          senderIdentity: "+447700900999",
        },
      },
    });

    const answered = await buildConfiguredWorkflowPlan({
      organisationId: 1,
      request: {
        workflowKey: "post_consultation_follow_up",
        leadLabel: "Test Customer",
        callOutcome: "answered",
        conversationNotes: "Customer confirmed the factual next step.",
      },
      customer: customer({ taskTitle: "Current Follow-up" }),
    });
    expect(
      answered.actions.some(action => /^send_/.test(action.actionType))
    ).toBe(false);
    expect(
      answered.actions.some(action => action.actionType === "schedule_callback")
    ).toBe(false);

    const noAnswer = await buildConfiguredWorkflowPlan({
      organisationId: 1,
      request: {
        workflowKey: "post_consultation_follow_up",
        leadLabel: "Test Customer",
        callOutcome: "no_answer",
      },
      customer: customer({ taskTitle: "Current Follow-up" }),
    });
    expect(noAnswer.actions.map(action => action.actionType)).toEqual(
      expect.arrayContaining([
        "send_email_template",
        "send_sms_template",
        "send_whatsapp_template",
        "schedule_callback",
      ])
    );
  });
});
