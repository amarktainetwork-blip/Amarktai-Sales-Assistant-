import { describe, expect, it } from "vitest";
import { materializeApprovedCommunicationTemplate } from "./approvedTemplates";
import { planTelesalesCloseout } from "./telesales/closeoutPlanner";

const approved = {
  id: 12,
  templateKey: "product-brochure",
  version: 3,
  title: "Product brochure",
  body: "Here is the brochure you requested.",
};

describe("approved closeout communication templates", () => {
  it("queues exact non-empty server-resolved published content", () => {
    const communication = materializeApprovedCommunicationTemplate({
      channel: "email",
      to: "john@example.test",
      approved,
    });
    const action = planTelesalesCloseout({
      organisationId: 3,
      callSessionId: 41,
      leadLabel: "John",
      summary: "Requested information.",
      outcome: "information_requested",
      communication,
      commitmentsConfirmed: true,
    }).find(item => item.actionType === "send_email_template");
    expect(action?.payload).toMatchObject({
      body: approved.body,
      subject: approved.title,
      approvalTemplateId: 12,
      approvalTemplateVersion: 3,
    });
  });

  it("blocks a missing published template before an executable proposal exists", () => {
    expect(() =>
      materializeApprovedCommunicationTemplate({
        channel: "sms",
        to: "+27820000000",
        approved: undefined,
      })
    ).toThrow("TEMPLATE_NOT_FOUND");
  });

  it("never allows an auto-preapproved path to construct a blank communication", () => {
    expect(() =>
      planTelesalesCloseout({
        organisationId: 3,
        callSessionId: 41,
        leadLabel: "John",
        summary: "Requested information.",
        outcome: "information_requested",
        communication: { channel: "sms", to: "+27820000000", body: "" },
        commitmentsConfirmed: true,
      })
    ).toThrow("TEMPLATE_CONTENT_REQUIRED");
  });

  it("retains an explicitly provided valid custom message as a review-required non-template action", () => {
    const [action] = planTelesalesCloseout({
      organisationId: 3,
      callSessionId: 41,
      leadLabel: "John",
      summary: "Requested information.",
      outcome: "information_requested",
      communication: {
        channel: "sms",
        to: "+27820000000",
        body: "Here is the information you requested.",
      },
      commitmentsConfirmed: true,
    }).filter(item => item.actionType === "send_sms");
    expect(action).toMatchObject({
      actionType: "send_sms",
      payload: {
        reviewRequired: true,
        body: "Here is the information you requested.",
      },
    });
  });
});
