import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "playwright-core";
import {
  executeGenieExactOptionalRead,
  GENIE_EXACT_OPTIONAL_READS,
  isGenieExactOptionalRead,
} from "./genieOptionalReads";
import { readOwnerScopedGenieContactDetail } from "./genieContactDetail";
import { readGenieContactHistory } from "./genieContactHistory";
import { readOwnerScopedGenieOpportunityDetail } from "./genieOpportunityDetail";

vi.mock("./genieContactDetail", () => ({
  readOwnerScopedGenieContactDetail: vi.fn(),
}));
vi.mock("./genieContactHistory", () => ({
  readGenieContactHistory: vi.fn(),
}));
vi.mock("./genieOpportunityDetail", () => ({
  readOwnerScopedGenieOpportunityDetail: vi.fn(),
}));
const owner = "amelia-owner";
const contact = "real-contact";
const opportunity = "real-opportunity";
const page = {} as Page;
const assertControl = vi.fn();
const call = (operationKey: (typeof GENIE_EXACT_OPTIONAL_READS)[number], externalId = contact) =>
  executeGenieExactOptionalRead({
    page, operationKey, payload: { externalId }, ownerExternalId: owner, assertControl,
  });
const activities = [
  {
    externalId: "message:one", contactExternalId: contact, ownerExternalId: owner,
    activityType: "email", occurredAt: new Date("2026-10-01T13:00:00Z"),
    raw: { sourceKind: "conversation_message" },
  },
  {
    externalId: "note:two", contactExternalId: contact, ownerExternalId: owner,
    activityType: "note", occurredAt: new Date("2026-10-01T14:00:00Z"),
    raw: { sourceKind: "contact_note" },
  },
] as Awaited<ReturnType<typeof readGenieContactHistory>>["activities"];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readGenieContactHistory).mockResolvedValue({
    activities,
    coverage: { notes: "complete", communications: "complete", refreshedAt: "2026-10-02" },
  });
});

describe("exact native Genie read commissioning", () => {
  it("recognises only independently implemented read keys", () => {
    expect(GENIE_EXACT_OPTIONAL_READS).toHaveLength(7);
    expect(isGenieExactOptionalRead("opportunity.read")).toBe(true);
    expect(isGenieExactOptionalRead("workflow.execute")).toBe(false);
    expect(isGenieExactOptionalRead("task.sync")).toBe(false);
  });
  it("rejects absent owner and non-immutable targets without opening the source", async () => {
    await expect(executeGenieExactOptionalRead({
      page, operationKey: "contact.open", payload: { externalId: contact },
      ownerExternalId: "", assertControl,
    })).rejects.toThrow("CRM_OWNER_SCOPE_REQUIRED");
    await expect(call("history.read", "https://untrusted.invalid/id"))
      .rejects.toThrow("GENIE_NATIVE_READ_EXACT_TARGET_REQUIRED");
    expect(readGenieContactHistory).not.toHaveBeenCalled();
  });
  it("delegates exact contact.open to independently owner-scoped source GET", async () => {
    vi.mocked(readOwnerScopedGenieContactDetail).mockResolvedValue({
      success: true, completedAt: "2026-10-02T10:00:00Z", detail: "exact",
      data: { actualExternalId: contact, ownerExternalId: owner, records: "[]" },
    });
    const result = await call("contact.open");
    expect(result.data.actualExternalId).toBe(contact);
    expect(readOwnerScopedGenieContactDetail).toHaveBeenCalledWith({
      page, requested: contact, ownerExternalId: owner, assertControl,
    });
  });
  it("separates notes, communications, latest interaction and full history", async () => {
    const history = await call("history.read");
    const notes = await call("note.read");
    const latest = await call("interaction.latest");
    const communications = await call("communication.context");
    expect(JSON.parse(history.data.records)).toHaveLength(2);
    expect(JSON.parse(notes.data.records).map((x: { externalId: string }) => x.externalId))
      .toEqual(["note:two"]);
    expect(JSON.parse(latest.data.records).map((x: { externalId: string }) => x.externalId))
      .toEqual(["note:two"]);
    expect(JSON.parse(communications.data.records).map((x: { externalId: string }) => x.externalId))
      .toEqual(["message:one"]);
    expect(readGenieContactHistory).toHaveBeenCalledTimes(4);
  });
  it("fails closed when there is no genuine note and when another owner's activity appears", async () => {
    vi.mocked(readGenieContactHistory).mockResolvedValueOnce({
      activities: [activities[0]],
      coverage: { notes: "complete", communications: "complete", refreshedAt: "2026-10-02" },
    });
    await expect(call("note.read")).rejects.toThrow("GENIE_NATIVE_READ_NO_GENUINE_SOURCE_RECORD");
    vi.mocked(readGenieContactHistory).mockResolvedValueOnce({
      activities: [{ ...activities[0], ownerExternalId: "another-owner" }],
      coverage: { notes: "complete", communications: "complete", refreshedAt: "2026-10-02" },
    });
    await expect(call("history.read")).rejects.toThrow("CRM_OWNER_SCOPE_VIOLATION");
  });
  it("requires an exact opportunity identity, owner and real stage fields", async () => {
    vi.mocked(readOwnerScopedGenieOpportunityDetail).mockResolvedValue({
      externalId: opportunity, ownerExternalId: owner,
      name: "Source opportunity", pipeline: "Source pipeline", stage: "First Call",
      raw: { sourceKind: "genie_exact_owner_scoped_get" },
    });
    const result = await call("opportunity.read", opportunity);
    expect(JSON.parse(result.data.records)[0].sourceKind).toBe("genie_exact_owner_scoped_get");
    expect(readOwnerScopedGenieOpportunityDetail).toHaveBeenCalledWith({
      page, externalId: opportunity, ownerExternalId: owner, assertControl,
    });
    expect(JSON.parse((await call("stage.read", opportunity)).data.records)[0].stage)
      .toBe("First Call");
    vi.mocked(readOwnerScopedGenieOpportunityDetail).mockResolvedValueOnce({
      externalId: opportunity, ownerExternalId: owner, name: "Missing source stage",
    });
    await expect(call("stage.read", opportunity)).rejects
      .toThrow("GENIE_EXACT_STAGE_SOURCE_FIELDS_REQUIRED");
  });
});
