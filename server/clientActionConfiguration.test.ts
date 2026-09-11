import { describe, expect, it } from "vitest";
import {
  normalizeClientActionConfiguration,
  resolveConfiguredCurrentContact,
  validateClientActionConfigurationForCommissioning,
} from "./clientActionConfiguration";

describe("client action configuration", () => {
  it("normalizes reusable workflow primitives without client-specific engine constants", () => {
    const configuration = normalizeClientActionConfiguration({
      workflows: {
        first_contact: {
          taskAliases: { attempt_1: "Initial Call", attempt_2: "Second Call" },
          taskSequence: ["attempt_1", "attempt_2"],
          sequence: [
            "verify_contact_context:current_customer",
            "send_sms_template:first_contact",
            "schedule_callback:attempt_2",
          ],
          eligibilityStatuses: ["New"],
          stopStatuses: ["Converted", "Closed"],
          templates: { first_contact: "initial-sms" },
          timingRules: { attempt_2: "P1D" },
          duplicateRules: ["same_open_task"],
          requiredPostconditions: ["task_readback"],
        },
      },
      templates: {
        "initial-sms": {
          channel: "sms",
          source: "crm_saved",
          templateName: "Initial SMS",
          body: "Hello from the approved CRM template.",
          senderIdentity: "+441234567890",
          sourceReference: "crm-template-17",
          sourceVersion: "4",
          commissionedAt: "2026-09-02T12:00:00Z",
        },
      },
      approvedSenders: { sms: ["+441234567890"] },
      officeHours: {
        timezone: "Europe/London",
        days: [1, 2, 3, 4, 5],
        start: "09:00",
        end: "18:00",
      },
      currentRecordRules: [
        {
          provider: "genie",
          entity: "contact",
          pathPrefix: "/contacts/",
          idSegmentFromEnd: 1,
        },
      ],
    });

    expect(configuration.workflows.first_contact).toMatchObject({
      taskAliases: { attempt_1: "Initial Call", attempt_2: "Second Call" },
      taskSequence: ["attempt_1", "attempt_2"],
      eligibilityStatuses: ["New"],
      stopStatuses: ["Converted", "Closed"],
    });
    expect(configuration.templates["initial-sms"]).toMatchObject({
      source: "crm_saved",
      senderIdentity: "+441234567890",
      sourceReference: "crm-template-17",
      sourceVersion: "4",
      commissionedAt: "2026-09-02T12:00:00Z",
    });
  });

  it("normalizes programme matchers and validates per-task action sequences", () => {
    const result = validateClientActionConfigurationForCommissioning({
      workflows: {
        "first_contact:programme-alpha": {
          opportunityNameContains: ["Alpha Programme"],
          taskAliases: {
            attempt_1: "First call",
            attempt_2: "Second call",
          },
          taskSequence: ["attempt_1", "attempt_2"],
          sequence: ["verify_contact_context:current_customer"],
          sequenceByTaskPurpose: {
            attempt_2: [
              "append_contact_note:attempt_2_outcome",
              "schedule_callback:attempt_2",
            ],
          },
          timingRules: { attempt_2: "P1D" },
        },
      },
    });
    expect(
      result.configuration.workflows["first_contact:programme-alpha"]
    ).toMatchObject({
      opportunityNameContains: ["Alpha Programme"],
      sequenceByTaskPurpose: {
        attempt_2: [
          "append_contact_note:attempt_2_outcome",
          "schedule_callback:attempt_2",
        ],
      },
    });
  });

  it("resolves current customer only from a configured stable URL identifier", () => {
    const configuration = normalizeClientActionConfiguration({
      currentRecordRules: [
        {
          provider: "genie",
          entity: "contact",
          pathPrefix: "/customers/",
          idSegmentFromEnd: 1,
        },
      ],
    });

    expect(
      resolveConfiguredCurrentContact({
        authorisedUrl: "https://crm.example.test/customers/customer-123",
        provider: "genie",
        configuration,
      })
    ).toEqual({
      entity: "contact",
      externalId: "customer-123",
      source: "configured_path_rule",
    });

    expect(
      resolveConfiguredCurrentContact({
        authorisedUrl: "https://crm.example.test/search?name=Jane%20Doe",
        provider: "genie",
        configuration,
      })
    ).toBeNull();
  });

  it("rejects a CRM-saved email workflow when its exact approved subject was not commissioned", () => {
    expect(() =>
      validateClientActionConfigurationForCommissioning({
        workflows: {
          follow_up: {
            taskAliases: {},
            taskSequence: [],
            sequence: ["send_email_template:follow_up"],
            templates: { follow_up: "follow-email" },
          },
        },
        templates: {
          "follow-email": {
            channel: "email",
            source: "crm_saved",
            templateName: "Approved follow-up",
            body: "Exact saved body.",
          },
        },
      })
    ).toThrow("CLIENT_WORKFLOW_TEMPLATE_SUBJECT_REQUIRED");
  });

  it("rejects an SMS template whose sender is not approved for the organisation", () => {
    expect(() =>
      validateClientActionConfigurationForCommissioning({
        workflows: {
          first_contact: {
            taskAliases: { attempt_1: "Initial Contact" },
            taskSequence: ["attempt_1"],
            sequence: ["send_sms_template:first_contact"],
            templates: { first_contact: "initial-sms" },
          },
        },
        templates: {
          "initial-sms": {
            channel: "sms",
            source: "client_configuration",
            templateName: "Initial outreach",
            body: "Exact approved SMS.",
            senderIdentity: "+441111111111",
          },
        },
        approvedSenders: { sms: ["+442222222222"] },
      })
    ).toThrow("CLIENT_WORKFLOW_SENDER_NOT_APPROVED");
  });

  it("requires an exact tenant CRM sequence mapping before apply_sequence can be commissioned", () => {
    expect(() =>
      validateClientActionConfigurationForCommissioning({
        workflows: {
          final_close: {
            taskAliases: {},
            taskSequence: [],
            sequence: ["apply_sequence:closed_lost"],
            eligibilityStatuses: [],
            stopStatuses: [],
            opportunityMappings: {},
            statusMappings: {},
            sequenceMappings: {},
            templates: {},
            timingRules: {},
            duplicateRules: [],
            requiredPostconditions: [],
          },
        },
      })
    ).toThrow("CLIENT_WORKFLOW_SEQUENCE_MAPPING_REQUIRED");
  });

  it("accepts generic stage-dependent closure transitions and reviewed field mappings", () => {
    const result = validateClientActionConfigurationForCommissioning({
      workflows: {
        final_close: {
          taskAliases: { final_follow_up: "Final follow-up" },
          taskSequence: [],
          sequence: [
            "complete_active_task:final_follow_up",
            "update_current_opportunity:close_or_lost",
            "update_contact_status:closed_or_lost",
            "apply_sequence:closed_lost",
          ],
          opportunityStageTransitions: {
            close_or_lost: {
              "New Lead": "Lost - No Contact",
              Considering: "Not a Fit",
            },
          },
          opportunityFieldMappings: {
            close_or_lost: { lostReason: "No successful contact" },
          },
          statusMappings: { closed_or_lost: "Lost" },
          contactFieldMappings: {
            closed_or_lost: { closureReason: "No successful contact" },
          },
          sequenceMappings: { closed_lost: "Closed lost sequence" },
        },
      },
    });
    expect(result.valid).toBe(true);
    expect(
      result.configuration.workflows.final_close.opportunityStageTransitions
    ).toMatchObject({
      close_or_lost: { "New Lead": "Lost - No Contact" },
    });
  });

  it("accepts a complete generic four-attempt configuration without client constants", () => {
    const result = validateClientActionConfigurationForCommissioning({
      workflows: {
        first_contact: {
          taskAliases: {
            attempt_1: "Initial Contact",
            attempt_2: "Second Contact",
            attempt_3: "Third Contact",
            attempt_4: "Final Contact",
          },
          taskSequence: ["attempt_1", "attempt_2", "attempt_3", "attempt_4"],
          sequence: [
            "verify_contact_context:current_customer",
            "send_sms_template:first_contact",
            "schedule_callback:follow_up",
          ],
          eligibilityStatuses: ["New"],
          stopStatuses: ["Closed", "Converted"],
          templates: { first_contact: "initial-sms" },
          timingRules: {
            attempt_2: "P1D",
            attempt_3: "P1D",
            attempt_4: "P1D",
            follow_up: "P1D",
          },
        },
      },
      templates: {
        "initial-sms": {
          channel: "sms",
          source: "client_configuration",
          templateName: "Initial outreach",
          body: "Exact approved SMS.",
          senderIdentity: "+441111111111",
        },
      },
      approvedSenders: { sms: ["+441111111111"] },
      officeHours: {
        timezone: "Europe/London",
        days: [1, 2, 3, 4, 5],
        start: "09:00",
        end: "18:00",
      },
    });
    expect(result.valid).toBe(true);
    expect(result.workflowKeys).toEqual(["first_contact"]);
  });
});

describe("attempt-specific configuration safety", () => {
  const workflow = {
    taskAliases: { one: "Call one", two: "Call two" },
    taskSequence: ["one", "two"],
    sequence: ["verify_contact_context:current_customer"],
    timingRules: { two: "P1D" },
  };
  it("rejects aliases that map a task to two different attempts", () => {
    expect(() =>
      validateClientActionConfigurationForCommissioning({
        workflows: {
          first_contact: {
            ...workflow,
            taskAliasAlternatives: { two: ["Call one"] },
          },
        },
      })
    ).toThrow("CLIENT_WORKFLOW_TASK_ALIAS_DUPLICATE");
  });
  it("rejects attempt overrides outside the configured progression", () => {
    expect(() =>
      validateClientActionConfigurationForCommissioning({
        workflows: {
          first_contact: {
            ...workflow,
            taskAliases: { ...workflow.taskAliases, extra: "Extra" },
            sequenceByTaskPurpose: {
              extra: ["verify_contact_context:current_customer"],
            },
          },
        },
      })
    ).toThrow("CLIENT_WORKFLOW_TASK_SEQUENCE_PURPOSE_INVALID");
  });
  it("rejects empty overrides instead of silently executing default actions", () => {
    expect(() =>
      validateClientActionConfigurationForCommissioning({
        workflows: {
          first_contact: { ...workflow, sequenceByTaskPurpose: { two: [] } },
        },
      })
    ).toThrow("CLIENT_WORKFLOW_TASK_SEQUENCE_EMPTY");
  });
});
