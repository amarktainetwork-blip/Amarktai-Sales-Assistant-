import { describe, expect, it, vi } from "vitest";
import { readGenieContactHistory } from "./genieContactHistory";
function fixture(owner = "owner") {
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
                messages: [
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
  it("normalizes proven notes and calls and declares bounded history coverage", async () => {
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
      ["call", "owner", "c"],
    ]);
    expect(result.coverage.communications).toBe("recent_page");
    expect(f.get).toHaveBeenCalledTimes(4);
  });
});
