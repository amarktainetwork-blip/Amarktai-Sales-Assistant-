import { describe, expect, it } from "vitest";
import {
  normalizeClientActionConfiguration,
  resolveConfiguredCurrentContact,
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
});
