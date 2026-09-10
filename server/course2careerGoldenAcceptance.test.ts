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

const INITIAL_SMS =
  "Hi [First Name], thank you for your enquiry about our Career Programme. I’ve received your details and would be happy to talk you through the programme and answer any questions you may have. We’re currently handling a high volume of enquiries, so please let me know a convenient day and time for a quick call, and confirm the best number to reach you on. Our office hours are Monday–Friday, 9am–6pm. Kind regards, Amelia – Course2Career";

const SENDER = "+447428000560";

/**
 * This is TEST-ONLY client acceptance data.
 * Values explicitly supplied by Amy are exact.
 * The TEST_ONLY_* values stand in for CRM-saved content/fields that must be
 * read from the real authorised Genie instance during live commissioning.
 * Nothing in this file is imported by production runtime.
 */
function course2CareerAcceptanceConfiguration() {
  return {
    workflows: {
      first_contact: {
        taskAliases: {
          attempt_1: "First Call",
          attempt_2: "Call 2",
          attempt_3: "Call 3",
          attempt_4: "Call 4",
        },
        taskSequence: ["attempt_1", "attempt_2", "attempt_3", "attempt_4"],
        sequence: [
          "verify_contact_context:current_customer",
          "send_sms_template:first_contact",
          "schedule_callback:follow_up",
        ],
        eligibilityStatuses: ["New Lead – Uncontacted", "Attempting Contact"],
        stopStatuses: [
          "pitched",
          "Pitch Done",
          "not interested",
          "closed",
          "rejected",
          "not a fit",
        ],
        opportunityMappings: {},
        statusMappings: {},
        templates: { first_contact: "initial-first-contact-sms" },
        timingRules: {
          attempt_2: "P1D",
          attempt_3: "P1D",
          attempt_4: "P1D",
          follow_up: "P1D",
        },
        duplicateRules: [
          "external_read_before_write",
          "no_equivalent_open_task",
        ],
        requiredPostconditions: ["task_readback", "activity_readback"],
      },
      "post_consultation_follow_up:no_answer": {
        taskAliases: {
          post_follow_up: "Yes/No Cyber",
          follow_up: "Last Try Cyber",
        },
        taskSequence: [],
        sequence: [
          "verify_contact_context:current_customer",
          "complete_active_task:post_follow_up",
          "append_contact_note:follow_up_outcome",
          "update_current_opportunity:post_consultation",
          "send_email_template:follow_up_email",
          "send_sms_template:follow_up_sms",
          "send_whatsapp_template:follow_up_whatsapp",
          "schedule_callback:follow_up",
        ],
        eligibilityStatuses: [],
        stopStatuses: ["closed", "rejected", "not a fit"],
        opportunityMappings: {
          post_consultation: "Discovery Completed – Considering Options",
        },
        statusMappings: {},
        templates: {
          follow_up_email: "follow-up-email-cyber",
          follow_up_sms: "failed-follow-up-cyber",
          follow_up_whatsapp: "tried-to-email",
        },
        timingRules: { follow_up: "P1D" },
        duplicateRules: [
          "external_read_before_write",
          "no_duplicate_communication",
          "no_equivalent_open_task",
        ],
        requiredPostconditions: [
          "task_readback",
          "opportunity_readback",
          "activity_readback",
        ],
      },
      "post_consultation_follow_up:answered": {
        taskAliases: {
          post_follow_up: "Yes/No Cyber",
          agreed_follow_up: "Agreed Follow-up",
        },
        taskSequence: [],
        sequence: [
          "verify_contact_context:current_customer",
          "complete_active_task:post_follow_up",
          "append_contact_note:follow_up_outcome",
          "update_current_opportunity:post_consultation",
        ],
        eligibilityStatuses: [],
        stopStatuses: ["closed", "rejected", "not a fit"],
        opportunityMappings: {
          post_consultation: "Discovery Completed – Considering Options",
        },
        statusMappings: {},
        templates: {},
        timingRules: {},
        duplicateRules: ["external_read_before_write"],
        requiredPostconditions: [
          "task_readback",
          "opportunity_readback",
          "activity_readback",
        ],
      },
      final_close: {
        taskAliases: { final_follow_up: "Last Try Cyber" },
        taskAliasAlternatives: {
          final_follow_up: ["Call 4", "Last Try"],
        },
        taskSequence: [],
        sequence: [
          "verify_contact_context:current_customer",
          "complete_active_task:final_follow_up",
          "send_email_template:closure_email",
          "send_sms_template:closure_sms",
          "update_current_opportunity:close_or_lost",
          "update_contact_status:closed_or_lost",
          "apply_sequence:closed_lost_sequence",
        ],
        optionalActions: [
          "complete_active_task:final_follow_up",
          "update_current_opportunity:close_or_lost",
        ],
        eligibilityStatuses: [],
        stopStatuses: ["closed"],
        opportunityMappings: {},
        opportunityStageTransitions: {
          close_or_lost: {
            "New Lead – Uncontacted": "Lost – No Show",
            "Attempting Contact": "Lost – No Show",
            "Discovery Call Completed – Considering Options":
              "Not a Fit / Rejected",
          },
        },
        statusMappings: { closed_or_lost: "Lost" },
        sequenceMappings: {
          closed_lost_sequence: "TEST_ONLY_LIVE_GENIE_CLOSED_LOST_SEQUENCE",
        },
        templates: {
          closure_email: "permission-to-close-your-file",
          closure_sms: "close-file-cyber",
        },
        timingRules: {},
        duplicateRules: [
          "external_read_before_write",
          "no_duplicate_communication",
        ],
        requiredPostconditions: [
          "task_readback",
          "opportunity_readback",
          "contact_readback",
          "activity_readback",
        ],
      },
    },
    templates: {
      "initial-first-contact-sms": {
        key: "initial-first-contact-sms",
        channel: "sms",
        source: "client_configuration",
        templateName: "Initial First Contact SMS",
        body: INITIAL_SMS,
        senderIdentity: SENDER,
      },
      "follow-up-email-cyber": {
        key: "follow-up-email-cyber",
        channel: "email",
        source: "crm_saved",
        templateName: "Follow-up Email Cyber",
        body: "TEST_ONLY_COMMISSIONED_EXACT_GENIE_BODY",
        requiredSubject: "TEST_ONLY_COMMISSIONED_EXACT_GENIE_SUBJECT",
      },
      "failed-follow-up-cyber": {
        key: "failed-follow-up-cyber",
        channel: "sms",
        source: "crm_saved",
        templateName: "Failed Follow-up Cyber",
        body: "TEST_ONLY_COMMISSIONED_EXACT_GENIE_SMS_BODY",
        senderIdentity: SENDER,
      },
      "tried-to-email": {
        key: "tried-to-email",
        channel: "whatsapp",
        source: "crm_saved",
        templateName: "tried_to_email",
        body: "TEST_ONLY_COMMISSIONED_EXACT_GENIE_WHATSAPP_BODY",
        senderIdentity: SENDER,
      },
      "permission-to-close-your-file": {
        key: "permission-to-close-your-file",
        channel: "email",
        source: "crm_saved",
        templateName: "Permission to Close Your File",
        body: "TEST_ONLY_COMMISSIONED_EXACT_GENIE_CLOSURE_BODY",
        requiredSubject: "TEST_ONLY_COMMISSIONED_EXACT_GENIE_CLOSURE_SUBJECT",
      },
      "close-file-cyber": {
        key: "close-file-cyber",
        channel: "sms",
        source: "crm_saved",
        templateName: "close file cyber",
        body: "TEST_ONLY_COMMISSIONED_EXACT_GENIE_CLOSURE_SMS_BODY",
        senderIdentity: SENDER,
      },
    },
    approvedSenders: { sms: [SENDER], whatsapp: [SENDER] },
    officeHours: {
      timezone: "Europe/London",
      days: [1, 2, 3, 4, 5],
      start: "09:00",
      end: "18:00",
    },
    duplicateRules: ["external_read_before_write"],
    closureMapping: {},
    requiredPostconditions: {},
    currentRecordRules: [],
  };
}

function customer(input: {
  taskTitle: string;
  status?: string;
  stage?: string;
  firstName?: string;
}): ResolvedAssistantCustomerContext {
  const firstName = input.firstName ?? "Jamie";
  return {
    source: "manual_resolved",
    connectedSystemId: 10,
    provider: "genie",
    contactExternalId: "contact-amy-test",
    contactName: `${firstName} Test`,
    firstName,
    lastName: "Test",
    companyName: "Test Company",
    email: "jamie@example.test",
    phone: "+447700900123",
    contactStatus: input.status ?? "New Lead – Uncontacted",
    taskExternalId: "task-current",
    taskTitle: input.taskTitle,
    opportunityExternalId: "opp-current",
    opportunityName: "Current Cyber opportunity",
    stage: input.stage ?? "Attempting Contact",
    reasons: [],
    targetVerification: {
      verified: true,
      source: "assistant_customer_selector",
      connectedSystemId: 10,
      contactExternalId: "contact-amy-test",
    },
    operationalRecordState: {
      openTasks: [
        {
          externalId: "task-current",
          title: input.taskTitle,
          status: "open",
        },
      ],
      currentActiveTaskExternalId: "task-current",
      openOpportunities: [
        {
          externalId: "opp-current",
          name: "Current Cyber opportunity",
          stage: input.stage ?? "Attempting Contact",
        },
      ],
      currentActiveOpportunityExternalId: "opp-current",
      historicalCompletedTaskCount: 4,
      historicalClosedOpportunityCount: 2,
    },
  } as ResolvedAssistantCustomerContext;
}

beforeEach(() => {
  mocks.getClientActionConfiguration.mockResolvedValue(
    course2CareerAcceptanceConfiguration()
  );
  mocks.getOutboundSuppressionStatus.mockResolvedValue({
    verified: true,
    suppressed: false,
    channel: "sms",
    destination: "+447700900123",
    contactExternalId: "contact-amy-test",
  });
});

describe("Course2Career first-client golden workflow contract (test-only fixture)", () => {
  it("personalizes Amy's exact First Call SMS, uses only the approved sender and schedules Call 2 without completing First Call", async () => {
    const plan = await buildConfiguredWorkflowPlan({
      organisationId: 4,
      request: { workflowKey: "first_contact", leadLabel: "Jamie Test" },
      customer: customer({ taskTitle: "First Call", firstName: "Jamie" }),
      now: new Date("2026-09-10T10:00:00.000Z"),
    });

    expect(plan.actions.map(action => action.actionType)).not.toContain(
      "complete_active_task"
    );
    const sms = plan.actions.find(action => action.actionType === "send_sms_template");
    expect(sms?.payload).toMatchObject({
      senderIdentity: SENDER,
      body: INITIAL_SMS.replace("[First Name]", "Jamie"),
      templateName: "Initial First Contact SMS",
    });
    const callback = plan.actions.find(
      action => action.actionType === "schedule_callback"
    );
    expect(callback?.payload).toMatchObject({
      taskTitle: "Call 2",
      taskPurpose: "attempt_2",
    });
  });

  it.each([
    ["Call 2", "Call 3"],
    ["Call 3", "Call 4"],
  ])("does not resend the initial SMS for %s and schedules only %s", async (current, next) => {
    const plan = await buildConfiguredWorkflowPlan({
      organisationId: 4,
      request: { workflowKey: "first_contact", leadLabel: "Jamie Test" },
      customer: customer({ taskTitle: current }),
      now: new Date("2026-09-10T10:00:00.000Z"),
    });
    expect(plan.actions.some(action => /^send_/.test(action.actionType))).toBe(
      false
    );
    expect(
      plan.actions.find(action => action.actionType === "schedule_callback")
        ?.payload.taskTitle
    ).toBe(next);
  });

  it("blocks progressed/closed candidates before any workflow proposal is prepared", async () => {
    await expect(
      buildConfiguredWorkflowPlan({
        organisationId: 4,
        request: { workflowKey: "first_contact", leadLabel: "Jamie Test" },
        customer: customer({ taskTitle: "First Call", status: "Pitch Done" }),
      })
    ).rejects.toThrow("WORKFLOW_STOP_STATUS");
  });

  it("prepares the Cyber no-answer path with the exact current task, configured channels and Last Try Cyber only", async () => {
    const plan = await buildConfiguredWorkflowPlan({
      organisationId: 4,
      request: {
        workflowKey: "post_consultation_follow_up",
        leadLabel: "Jamie Test",
        callOutcome: "no_answer",
      },
      customer: customer({
        taskTitle: "Yes/No Cyber",
        status: "Pitched",
        stage: "Discovery Call Completed – Considering Options",
      }),
      now: new Date("2026-09-10T10:00:00.000Z"),
    });

    const types = plan.actions.map(action => action.actionType);
    expect(types).toEqual(
      expect.arrayContaining([
        "verify_contact_context",
        "complete_active_task",
        "append_contact_note",
        "update_current_opportunity",
        "send_email_template",
        "send_sms_template",
        "send_whatsapp_template",
        "schedule_callback",
      ])
    );
    expect(
      plan.actions.find(action => action.actionType === "complete_active_task")
        ?.payload.taskTitle
    ).toBe("Yes/No Cyber");
    expect(
      plan.actions.find(action => action.actionType === "append_contact_note")
        ?.payload.content
    ).toBe("Follow-up call attempted: no answer.");
    expect(
      plan.actions.find(action => action.actionType === "update_current_opportunity")
        ?.payload.patch
    ).toMatchObject({ stage: "Discovery Completed – Considering Options" });
    expect(
      plan.actions.find(action => action.actionType === "send_email_template")
        ?.payload.templateName
    ).toBe("Follow-up Email Cyber");
    expect(
      plan.actions.find(action => action.actionType === "send_sms_template")
        ?.payload
    ).toMatchObject({
      templateName: "Failed Follow-up Cyber",
      senderIdentity: SENDER,
    });
    expect(
      plan.actions.find(action => action.actionType === "send_whatsapp_template")
        ?.payload.templateName
    ).toBe("tried_to_email");
    expect(
      plan.actions.find(action => action.actionType === "schedule_callback")
        ?.payload.taskTitle
    ).toBe("Last Try Cyber");
  });

  it("keeps an answered follow-up factual and excludes failed-contact messages and automatic Last Try", async () => {
    const plan = await buildConfiguredWorkflowPlan({
      organisationId: 4,
      request: {
        workflowKey: "post_consultation_follow_up",
        leadLabel: "Jamie Test",
        callOutcome: "answered",
        conversationNotes:
          "Customer has reviewed the information and will confirm their decision after speaking with family.",
      },
      customer: customer({
        taskTitle: "Yes/No Cyber",
        status: "Pitched",
        stage: "Discovery Call Completed – Considering Options",
      }),
    });

    expect(plan.actions.some(action => /^send_/.test(action.actionType))).toBe(
      false
    );
    expect(
      plan.actions.some(action => action.actionType === "schedule_callback")
    ).toBe(false);
    expect(
      plan.actions.find(action => action.actionType === "append_contact_note")
        ?.payload.content
    ).toBe(
      "Customer has reviewed the information and will confirm their decision after speaking with family."
    );
  });

  it("accepts Call 4 as an explicitly commissioned final-task alias and closes only the current open opportunity path", async () => {
    const plan = await buildConfiguredWorkflowPlan({
      organisationId: 4,
      request: { workflowKey: "final_close", leadLabel: "Jamie Test" },
      customer: customer({
        taskTitle: "Call 4",
        status: "Attempting Contact",
        stage: "Attempting Contact",
      }),
    });

    expect(
      plan.actions.find(action => action.actionType === "complete_active_task")
        ?.payload.taskTitle
    ).toBe("Call 4");
    expect(
      plan.actions.find(action => action.actionType === "send_email_template")
        ?.payload.templateName
    ).toBe("Permission to Close Your File");
    expect(
      plan.actions.find(action => action.actionType === "send_sms_template")
        ?.payload
    ).toMatchObject({
      templateName: "close file cyber",
      senderIdentity: SENDER,
    });
    expect(
      plan.actions.find(action => action.actionType === "update_current_opportunity")
        ?.payload.patch
    ).toMatchObject({ stage: "Lost – No Show" });
    expect(
      plan.actions.find(action => action.actionType === "update_contact_status")
        ?.payload.status
    ).toBe("Lost");
    expect(
      plan.actions.find(action => action.actionType === "apply_sequence")?.payload
        .sequence
    ).toBe("TEST_ONLY_LIVE_GENIE_CLOSED_LOST_SEQUENCE");
  });
});
