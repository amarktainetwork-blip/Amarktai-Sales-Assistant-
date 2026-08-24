import { describe, expect, it } from "vitest";
import {
  BROWSER_OPERATION_CATALOGUE,
  assertBrowserOperationRuntimeStatus,
  assertBrowserOperationScope,
  deriveBrowserCapabilityReadiness,
  compileGuidedBrowserOperation,
  proposeGuidedBrowserSteps,
  sanitizeTrainingCapture,
  validateLearnedOperationDefinition,
  verifyBrowserCreateTarget,
  verifyBrowserPostconditions,
  verifyBrowserTarget,
} from "./operationContracts";

describe("Genie commissioning catalogue", () => {
  it("preserves every required operation including the governed dialler", () => {
    const keys = new Set(BROWSER_OPERATION_CATALOGUE.map(operation => operation.key));
    for (const key of [
      "auth.login", "home.open", "prospect.next", "contact.search", "contact.open", "contact.read", "contact.sync", "contact.create", "contact.update", "company.read", "company.sync", "company.create", "history.read", "note.read", "note.create", "interaction.latest", "communication.context", "task.list", "task.read", "task.sync", "task.create", "task.complete", "task.create_callback", "opportunity.read", "opportunity.sync", "opportunity.create", "opportunity.update", "pipeline.list", "stage.read", "stage.update", "owner.sync", "owner.assign", "activity.sync", "activity.create", "dialler.launch", "email.send", "sms.send", "whatsapp.send", "sequence.apply", "appointment.book", "quote.create", "workflow.execute",
    ]) expect(keys.has(key), `${key} must remain in the catalogue`).toBe(true);
  });
});

describe("browser CRM record guardian", () => {
  it("blocks an ambiguous target", () => {
    const result = verifyBrowserTarget({ name: "John Smith" }, [
      { name: "John Smith", email: "one@example.com" },
      { name: "John Smith", email: "two@example.com" },
    ]);
    expect(result).toMatchObject({ ok: false, code: "AMBIGUOUS_TARGET" });
  });

  it("blocks a target identity mismatch", () => {
    const result = verifyBrowserTarget(
      { externalId: "48129", email: "john@example.com" },
      [{ externalId: "99213", email: "fred@example.com" }]
    );
    expect(result).toMatchObject({ ok: false, code: "TARGET_MISMATCH" });
  });

  it("accepts an exact external id", () => {
    const result = verifyBrowserTarget({ externalId: "48129" }, [
      { externalId: "48129", name: "John Smith" },
    ]);
    expect(result).toMatchObject({ ok: true, code: "TARGET_VERIFIED" });
  });

  it("accepts two matching stable identifiers", () => {
    const result = verifyBrowserTarget(
      { name: "John Smith", email: "JOHN@example.com" },
      [{ name: " john  smith ", email: "john@example.com" }]
    );
    expect(result).toMatchObject({ ok: true, code: "TARGET_VERIFIED" });
    expect(result.matchedFields).toEqual(["name", "email"]);
  });

  it("blocks duplicate creation and requires stable intended identity", () => {
    expect(
      verifyBrowserCreateTarget({ email: "john@example.com" }, [])
    ).toMatchObject({ ok: false, code: "TARGET_IDENTITY_REQUIRED" });
    expect(
      verifyBrowserCreateTarget(
        { name: "John Smith", email: "john@example.com" },
        [{ externalId: "existing" }]
      )
    ).toMatchObject({ ok: false, code: "TARGET_MISMATCH" });
    expect(
      verifyBrowserCreateTarget(
        { name: "John Smith", email: "john@example.com" },
        []
      )
    ).toMatchObject({ ok: true });
  });
});

describe("browser CRM postconditions", () => {
  it("does not report success when readback fails", () => {
    expect(
      verifyBrowserPostconditions(
        [{ actualKey: "taskStatus", expectedValue: "completed" }],
        { taskStatus: "open" },
        {}
      )
    ).toMatchObject({ ok: false, code: "EXECUTION_UNVERIFIED" });
  });

  it("records a successful exact and contained readback", () => {
    expect(
      verifyBrowserPostconditions(
        [
          { actualKey: "taskStatus", expectedValue: "completed" },
          {
            actualKey: "notes",
            expectedInput: "noteBody",
            comparator: "contains",
          },
        ],
        { taskStatus: "completed", notes: "Called customer — factual note" },
        { noteBody: "factual note" }
      )
    ).toMatchObject({ ok: true, code: "POSTCONDITION_VERIFIED" });
  });
});

describe("operation truth and training privacy", () => {
  it("requires LIVE_PROVEN for production and keeps TEST_READY test-only", () => {
    expect(() => assertBrowserOperationRuntimeStatus("NOT_LEARNED")).toThrow(
      "OPERATION_NOT_LEARNED"
    );
    expect(() => assertBrowserOperationRuntimeStatus("TEST_READY")).toThrow(
      "OPERATION_NOT_LIVE_PROVEN"
    );
    expect(() =>
      assertBrowserOperationRuntimeStatus("TEST_READY", true)
    ).not.toThrow();
    expect(() =>
      assertBrowserOperationRuntimeStatus("LIVE_PROVEN")
    ).not.toThrow();
  });

  it("cannot cross an organisation or connected system", () => {
    expect(() =>
      assertBrowserOperationScope(
        { organisationId: 1, connectedSystemId: 9 },
        { organisationId: 2, connectedSystemId: 9 }
      )
    ).toThrow("OPERATION_ORGANISATION_MISMATCH");
    expect(() =>
      assertBrowserOperationScope(
        { organisationId: 1, connectedSystemId: 9 },
        { organisationId: 1, connectedSystemId: 10 }
      )
    ).toThrow("OPERATION_CONNECTED_SYSTEM_MISMATCH");
  });
  it("does not infer a full broad capability from partial operation coverage", () => {
    const result = deriveBrowserCapabilityReadiness(
      {
        "task.list": "LIVE_PROVEN",
        "task.read": "TEST_READY",
        "task.sync": "NOT_LEARNED",
      },
      "tasks.read"
    );
    expect(result.state).toBe("LIMITED");
    expect(result.missingOperations).toEqual(["task.read", "task.sync"]);
  });

  it("masks password and token fields and replaces ordinary input values", () => {
    const result = sanitizeTrainingCapture([
      {
        action: "fill",
        inputType: "password",
        name: "Password",
        value: "super-secret",
      },
      {
        action: "fill",
        inputType: "text",
        label: "Contact email",
        value: "real.person@example.com",
        attributes: {
          name: "email",
          "data-token": "secret",
          "data-testid": "email",
        },
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("super-secret");
    expect(JSON.stringify(result)).not.toContain("real.person@example.com");
    expect(JSON.stringify(result)).not.toContain("data-token");
    expect(result[1]).toMatchObject({
      value: "{{contactEmail}}",
      attributes: { name: "email", "data-testid": "email" },
    });
  });

  it("requires target and postcondition scripts for write definitions", () => {
    expect(() =>
      validateLearnedOperationDefinition({
        mode: "write",
        execute: { steps: [{ action: "click", selector: "button" }] },
      })
    ).toThrow(/target-read/i);
  });

  it("turns a sanitized demonstration into guided deterministic review steps", () => {
    const steps = proposeGuidedBrowserSteps([
      {
        action: "click",
        url: "https://crm.example/contacts",
        name: "Notes",
        selector: "[data-testid='notes']",
      },
      {
        action: "fill",
        url: "https://crm.example/contact/48129",
        label: "Note",
        selector: "textarea[name='note']",
        value: "private customer text",
      },
      {
        action: "click",
        url: "https://crm.example/contact/48129",
        name: "Save",
        selector: "[data-testid='save-note']",
      },
    ]);
    expect(steps).toEqual([
      { action: "goto", value: "https://crm.example/contacts" },
      { action: "click", selector: "[data-testid='notes']", value: undefined },
      {
        action: "fill",
        selector: "textarea[name='note']",
        value: "{{noteBody}}",
      },
      {
        action: "click",
        selector: "[data-testid='save-note']",
        value: undefined,
      },
    ]);
    expect(JSON.stringify(steps)).not.toContain("private customer text");
  });

  it("compiles a manager guided write review without raw operation JSON", () => {
    const result = compileGuidedBrowserOperation({
      mode: "write",
      review: {
        steps: [{ action: "click", selector: "[data-testid='save-note']" }],
        target: {
          rowSelector: "[data-testid='contact-row']",
          fields: [
            { key: "externalId", selector: "[data-field='id']" },
            { key: "email", selector: "[data-field='email']" },
          ],
        },
        postcondition: {
          action: "read_text",
          selector: "[data-testid='latest-note']",
          key: "latestNote",
          expectedInput: "noteBody",
          comparator: "contains",
        },
      },
    });
    expect(result.definition).toMatchObject({
      mode: "write",
      targetRead: { steps: [{ action: "read_rows", key: "targets" }] },
      postconditionRead: {
        steps: [{ action: "read_text", key: "latestNote" }],
      },
    });
    expect(result.postconditionAssertions).toEqual([
      expect.objectContaining({
        actualKey: "latestNote",
        expectedInput: "noteBody",
      }),
    ]);
  });
});
