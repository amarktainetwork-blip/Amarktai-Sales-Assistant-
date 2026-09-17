import { describe, expect, it, vi } from "vitest";
import { readGenieContactHistory } from "./genieContactHistory";
function fixture(owner = "owner", messages?: any[]) {
  const get = vi.fn(async (url: string) => ({
    ok: () => true,
    status: () => 200,
    json: async () =>
      url.endsWith("/notes")
        ? {
            notes: [
              {
                id: "n",
                contactId: "c",
                dateAdded: "2026-09-01T12:00:00Z",
                bodyText: "Customer requested information",
              },
            ],
          }
        : url.includes("/messages")
          ? {
              messages: {
                messages: messages || [
                  {
                    id: "m",
                    contactId: "c",
                    type: 2,
                    dateAdded: "2026-09-02T12:00:00Z",
                  },
                ],
                nextPage: true,
              },
            }
          : url.includes("conversations/search")
            ? {
                conversations: [
                  {
                    id: "thread",
                    contactId: "c",
                    locationId: "loc",
                    assignedTo: "owner",
                  },
                ],
                total: 1,
              }
            : { contact: { id: "c", assignedTo: owner, locationId: "loc" } },
  }));
  return {
    get,
    page: {
      url: () => "https://example.test/v2/location/loc/contacts",
      evaluate: async () => "token",
      context: () => ({ request: { get } }),
    } as any,
  };
}
describe("selected customer source history", () => {
  it("revalidates source contact ownership before notes or messages and uses GET only", async () => {
    const f = fixture("other");
    await expect(
      readGenieContactHistory({
        page: f.page,
        ownerExternalId: "owner",
        contactExternalId: "c",
        assertControl: () => {},
      })
    ).rejects.toThrow("CRM_OWNER_SCOPE_VIOLATION");
    expect(f.get).toHaveBeenCalledTimes(1);
  });
  it("normalizes proven notes and SMS and declares bounded history coverage", async () => {
    const f = fixture();
    const result = await readGenieContactHistory({
      page: f.page,
      ownerExternalId: "owner",
      contactExternalId: "c",
      assertControl: () => {},
    });
    expect(
      result.activities.map(a => [
        a.activityType,
        a.ownerExternalId,
        a.contactExternalId,
      ])
    ).toEqual([
      ["note", "owner", "c"],
      ["sms", "owner", "c"],
    ]);
    expect(result.coverage.communications).toBe("recent_page");
    expect(f.get).toHaveBeenCalledTimes(4);
  });
});

describe("source communication type contract", () => {
  it("keeps calls, SMS, email and metadata-proven WhatsApp distinct", async () => {
    const f = fixture(
      "owner",
      [1, 2, 3, 2].map((type, i) => ({
        id: `m${i}`,
        contactId: "c",
        type,
        messageTypeString: i === 3 ? "TYPE_WHATSAPP" : undefined,
        direction: i % 2 ? "inbound" : "outbound",
        body: "Message",
        dateAdded: "2026-09-17T10:00:00Z",
      }))
    );
    const result = await readGenieContactHistory({
      page: f.page,
      ownerExternalId: "owner",
      contactExternalId: "c",
      assertControl() {},
    });
    expect(result.activities.slice(1).map(a => a.activityType)).toEqual([
      "call",
      "sms",
      "email",
      "whatsapp",
    ]);
    expect(result.activities[2].raw).toMatchObject({ direction: "inbound" });
  });
  it("rejects messages from another contact", async () => {
    const f = fixture("owner", [
      { id: "m", contactId: "other", type: 2, dateAdded: "2026-09-17" },
    ]);
    await expect(
      readGenieContactHistory({
        page: f.page,
        ownerExternalId: "owner",
        contactExternalId: "c",
        assertControl() {},
      })
    ).rejects.toThrow("CRM_CONTACT_SCOPE_VIOLATION");
  });
});
