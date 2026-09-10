import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClientActionConfiguration: vi.fn(),
  getOutboundSuppressionStatus: vi.fn(),
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

vi.mock("./communications", async () => {
  const actual = await vi.importActual<typeof import("./communications")>(
    "./communications"
  );
  return {
    ...actual,
    getOutboundSuppressionStatus: mocks.getOutboundSuppressionStatus,
  };
});

import { buildConfiguredWorkflowPlan } from "./configuredWorkflow";
import type { ResolvedAssistantCustomerContext } from "./assistantCustomerContext";

function customer(input?: {
  taskTitle?: string;
  taskExternalId?: string;
  stage?: string;
  contactStatus?: string;
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
    contactStatus: input?.contactStatus ?? "New",
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
  mocks.getOutboundSuppressionStatus.mockReset();
  mocks.getOutboundSuppressionStatus.mockResolvedValue({
    verified: true,
    suppressed: false,
    channel: "sms",
    destination: "+447700900123",
    contactExternalId: "contact-1",
  });
});

describe("configured workflow materialization", () => {
  it("sends the initial message only on attempt one and schedules the exact next configured attempt", async () => {
    mocks.getClientActionConfiguration.mockResolvedValue(firstContactConfiguration());

    const attemptOne = await buildConfiguredWorkflowPlan({
      organisationId: 1,
      request: { workflowKey: "first_contact", leadLabel: "Test Customer" },
      customer: customer({ taskTitle: "Attempt 1", taskExternalId: "task-1" }),
      now: new Date("2026-09-04T16:30:00.000Z"),
    });

    expect(attemptOne.actions.map(action => action.actionType)).toContain(
      "send_sms_template"
    );
    expect(
      attemptOne.actions.find(action => action.actionType === "send_sms_template")
        ?.payload
    ).toMatchObject({
      senderIdentity: "+447700900999",
      compliance: { suppressionVerified: true, optedOut: false },
    });
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
      dueAt: "2026-09-07T08:00:00.000Z",
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

  it("blocks configured outreach before review when the current CRM status is a stop status", async () => {
    mocks.getClientActionConfiguration.mockResolvedValue(firstContactConfiguration());

    await expect(
      buildConfiguredWorkflowPlan({
        organisationId: 1,
        request: { workflowKey: "first_contact", leadLabel: "Test Customer" },
        customer: customer({ contactStatus: "Closed" }),
      })
    ).rejects.toThrow("WORKFLOW_STOP_STATUS");
  });

  it("requires the exact configured current task title before a destructive workflow can be prepared", async () => {
    const base = firstContactConfiguration();
    mocks.getClientActionConfiguration.mockResolvedValue({
      ...base,
      workflows: {
        final_close: {
          taskAliases: { final_follow_up: "Expected Final Task" },
          taskSequence: [],
          sequence: [
            "verify_contact_context:current_customer",
            "complete_active_task:final_follow_up",
          ],
          eligibilityStatuses: [],
          stopStatuses: [],
          opportunityMappings: {},
          statusMappings: {},
          templates: {},
          timingRules: {},
          duplicateRules: ["external_read_before_write"],
          requiredPostconditions: ["crm_readback"],
        },
      },
    });

    await expect(
      buildConfiguredWorkflowPlan({
        organisationId: 1,
        request: { workflowKey: "final_close", leadLabel: "Test Customer" },
        customer: customer({ taskTitle: "Some Other Open Task" }),
      })
    ).rejects.toThrow("WORKFLOW_CURRENT_TASK_MISMATCH");
  });

  it("preserves factual outcome notes when tenant action order replaces the generic workflow plan", async () => {
    const base = firstContactConfiguration();
    mocks.getClientActionConfiguration.mockResolvedValue({
      ...base,
      workflows: {
        "post_consultation_follow_up:no_answer": {
          taskAliases: {},
          taskSequence: [],
          sequence: [
            "verify_contact_context:current_customer",
            "append_contact_note:follow_up_outcome",
          ],
          eligibilityStatuses: [],
          stopStatuses: [],
          opportunityMappings: {},
          statusMappings: {},
          templates: {},
          timingRules: {},
          duplicateRules: [],
          requiredPostconditions: [],
        },
      },
    });

    const plan = await buildConfiguredWorkflowPlan({
      organisationId: 1,
      request: {
        workflowKey: "post_consultation_follow_up",
        leadLabel: "Test Customer",
        callOutcome: "no_answer",
      },
      customer: customer(),
    });

    expect(
      plan.actions.find(action => action.actionType === "append_contact_note")
        ?.payload.content
    ).toBe("Follow-up call attempted: no answer.");
  });

  it("materializes stage-aware closure fields and the exact configured CRM sequence", async () => {
    const base = firstContactConfiguration();
    mocks.getClientActionConfiguration.mockResolvedValue({
      ...base,
      workflows: {
        final_close: {
          taskAliases: { final_follow_up: "Final attempt" },
          taskSequence: [],
          sequence: [
            "verify_contact_context:current_customer",
            "complete_active_task:final_follow_up",
            "update_current_opportunity:close_or_lost",
            "update_contact_status:closed_or_lost",
            "apply_sequence:closed_lost",
          ],
          eligibilityStatuses: [],
          stopStatuses: [],
          opportunityMappings: {},
          opportunityStageTransitions: {
            close_or_lost: {
              "Attempting Contact": "Lost - No Contact",
              "Considering": "Not a Fit",
            },
          },
          opportunityFieldMappings: {
            close_or_lost: { lostReason: "No successful contact", closed: true },
          },
          statusMappings: { closed_or_lost: "Lost" },
          contactFieldMappings: {
            closed_or_lost: { closureReason: "No successful contact" },
          },
          sequenceMappings: { closed_lost: "Tenant closed-lost sequence" },
          templates: {},
          timingRules: {},
          duplicateRules: ["external_read_before_write"],
          requiredPostconditions: ["crm_readback"],
        },
      },
    });

    const plan = await buildConfiguredWorkflowPlan({
      organisationId: 1,
      request: { workflowKey: "final_close", leadLabel: "Test Customer" },
      customer: customer({
        taskTitle: "Final attempt",
        stage: "Attempting Contact",
      }),
    });

    expect(
      plan.actions.find(action => action.actionType === "update_current_opportunity")
        ?.payload.patch
    ).toMatchObject({
      stage: "Lost - No Contact",
      lostReason: "No successful contact",
      closed: true,
    });
    expect(
      plan.actions.find(action => action.actionType === "update_contact_status")
        ?.payload.fields
    ).toMatchObject({ status: "Lost", closureReason: "No successful contact" });
    expect(
      plan.actions.find(action => action.actionType === "apply_sequence")?.payload
        .sequence
    ).toBe("Tenant closed-lost sequence");
  });

  it("fails closed when the current opportunity stage has no configured closure transition", async () => {
    const base = firstContactConfiguration();
    mocks.getClientActionConfiguration.mockResolvedValue({
      ...base,
      workflows: {
        final_close: {
          taskAliases: { final_follow_up: "Final attempt" },
          taskSequence: [],
          sequence: ["update_current_opportunity:close_or_lost"],
          opportunityMappings: {},
          opportunityStageTransitions: {
            close_or_lost: { "New Lead": "Lost - No Contact" },
          },
          statusMappings: {},
          templates: {},
          timingRules: {},
          duplicateRules: [],
          requiredPostconditions: [],
        },
      },
    });

    await expect(
      buildConfiguredWorkflowPlan({
        organisationId: 1,
        request: { workflowKey: "final_close", leadLabel: "Test Customer" },
        customer: customer({ taskTitle: "Final attempt", stage: "Unexpected Stage" }),
      })
    ).rejects.toThrow("WORKFLOW_OPPORTUNITY_STAGE_UNMAPPED");
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

    const answeredWithAgreedFollowUpConfig = {
      ...base,
      workflows: {
        "post_consultation_follow_up:answered": {
          ...(
            mocks.getClientActionConfiguration.mock.results.length
              ? {
                  taskAliases: {
                    post_follow_up: "Current Follow-up",
                    agreed_follow_up: "Agreed Follow-up",
                  },
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
                }
              : {}
          ),
        },
      },
    };
    mocks.getClientActionConfiguration.mockResolvedValue(
      answeredWithAgreedFollowUpConfig
    );
    const answeredWithAgreedFollowUp = await buildConfiguredWorkflowPlan({
      organisationId: 1,
      request: {
        workflowKey: "post_consultation_follow_up",
        leadLabel: "Test Customer",
        callOutcome: "answered",
        conversationNotes: "Customer asked for a call Friday afternoon.",
        agreedFollowUpAt: "2026-09-11T13:00:00.000Z",
      },
      customer: customer({ taskTitle: "Current Follow-up" }),
    });
    expect(
      answeredWithAgreedFollowUp.actions.find(
        action => action.actionType === "schedule_callback"
      )?.payload
    ).toMatchObject({
      taskTitle: "Agreed Follow-up",
      dueAt: "2026-09-11T13:00:00.000Z",
      agreedFromConversation: true,
    });
    expect(
      answeredWithAgreedFollowUp.actions.some(action =>
        /^send_(?:email|sms|whatsapp)/.test(action.actionType)
      )
    ).toBe(false);

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
