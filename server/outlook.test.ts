import { describe, expect, it, vi } from "vitest";
import {
  createOutlookCalendarEvent,
  sendOutlookMail,
  validateEmailPreview,
} from "./outlook";

describe("legacy Microsoft Graph boundary", () => {
  it("rejects an email preview without an approved saved template", () => {
    expect(
      validateEmailPreview({
        to: "lead@example.test",
        subject: "Follow-up",
        body: "Hello",
      })
    ).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.stringContaining("template")]),
    });
  });

  it("requires review references before any legacy mail or calendar path", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      sendOutlookMail({
        to: "lead@example.test",
        subject: "Follow-up",
        body: "Hello",
        templateName: "approved-follow-up",
        reviewReference: "",
      })
    ).rejects.toThrow("review reference");
    await expect(
      createOutlookCalendarEvent({
        subject: "Discovery call",
        body: "Discuss next steps",
        startIso: "2026-08-23T10:00:00Z",
        endIso: "2026-08-23T10:30:00Z",
        attendees: ["lead@example.test"],
        reviewReference: "",
      })
    ).rejects.toThrow("review reference");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("cannot execute a shared application-mailbox send even with review", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      sendOutlookMail({
        to: "lead@example.test",
        subject: "Follow-up",
        body: "Hello",
        templateName: "approved-follow-up",
        reviewReference: "review-1",
      })
    ).rejects.toThrow("per-user delegated Microsoft connection");
    await expect(
      createOutlookCalendarEvent({
        subject: "Discovery call",
        body: "Discuss next steps",
        startIso: "2026-08-23T10:00:00Z",
        endIso: "2026-08-23T10:30:00Z",
        attendees: ["lead@example.test"],
        reviewReference: "review-2",
      })
    ).rejects.toThrow("per-user delegated Microsoft connection");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
