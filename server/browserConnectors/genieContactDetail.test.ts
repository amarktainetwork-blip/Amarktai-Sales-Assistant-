import { describe, expect, it, vi } from "vitest";
import {
  exactGenieContactRecord,
  exactGenieContactTarget,
  readOwnerScopedGenieContactDetail,
} from "./genieContactDetail";

const current = "https://genie.entrepreneurscircle.org/v2/location/loc/tasks";
const target =
  "https://genie.entrepreneurscircle.org/v2/location/loc/contacts/detail/c-1";
const found = {
  id: "c-1",
  locationId: "loc",
  assignedTo: "amelia",
  firstName: "Test",
  lastName: "Contact",
  email: "test@example.invalid",
  phone: "+440000000000",
};
const mockPage = (
  value: unknown = { contact: found },
  token = "real-token"
) => {
  const get = vi.fn(async () => ({
    status: () => 200,
    ok: () => true,
    json: async () => value,
  }));
  return {
    page: {
      url: () => current,
      evaluate: async () => token,
      context: () => ({ request: { get } }),
    } as any,
    get,
  };
};

describe("exact owner-scoped Genie contact detail GET", () => {
  it("accepts only the authorized same-location detail URL", () => {
    expect(exactGenieContactTarget(current, target)).toEqual({
      locationId: "loc",
      externalId: "c-1",
    });
    expect(exactGenieContactTarget(current, "c-1")).toEqual({
      locationId: "loc",
      externalId: "c-1",
    });

    expect(() =>
      exactGenieContactTarget(
        current,
        "https://example.com/v2/location/loc/contacts/detail/c-1"
      )
    ).toThrow("SCOPE");
    expect(() =>
      exactGenieContactTarget(
        current,
        "https://genie.entrepreneurscircle.org/v2/location/other/contacts/detail/c-1"
      )
    ).toThrow("SCOPE");
    expect(() => exactGenieContactTarget(current, target + "?x=1")).toThrow(
      "SCOPE"
    );
  });
  it("rejects missing, foreign, or mismatched immutable source identities", () => {
    const scope = {
      locationId: "loc",
      externalId: "c-1",
      ownerExternalId: "amelia",
    };
    expect(() =>
      exactGenieContactRecord({ ...found, assignedTo: "foreign" }, scope)
    ).toThrow("SCOPE_VIOLATION");
    expect(() =>
      exactGenieContactRecord({ ...found, locationId: "other" }, scope)
    ).toThrow("SCOPE_VIOLATION");
    expect(() =>
      exactGenieContactRecord({ ...found, id: "c-2" }, scope)
    ).toThrow("SCOPE_VIOLATION");
    expect(() => exactGenieContactRecord({}, scope)).toThrow("SCOPE_VIOLATION");
  });
  it("performs GET only and emits structured exact read evidence", async () => {
    const { page, get } = mockPage();
    const assertControl = vi.fn();
    const response = await readOwnerScopedGenieContactDetail({
      page,
      requested: target,
      ownerExternalId: "amelia",
      assertControl,
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe(
      "https://services.leadconnectorhq.com/contacts/c-1"
    );
    expect(response.success).toBe(true);
    expect(response.data.actualExternalId).toBe("c-1");
    expect(JSON.parse(response.data.records)).toEqual([
      expect.objectContaining({
        externalId: "c-1",
        ownerExternalId: "amelia",
        firstName: "Test",
      }),
    ]);
    expect(assertControl).toHaveBeenCalledTimes(2);
  });
  it("fails closed on missing credentials or an unauthorized response", async () => {
    const noToken = mockPage(undefined, "");
    await expect(
      readOwnerScopedGenieContactDetail({
        page: noToken.page,
        requested: target,
        ownerExternalId: "amelia",
        assertControl: () => {},
      })
    ).rejects.toThrow("REAUTHENTICATION_REQUIRED");
    expect(noToken.get).not.toHaveBeenCalled();
    const foreign = mockPage({ contact: { ...found, assignedTo: "foreign" } });
    await expect(
      readOwnerScopedGenieContactDetail({
        page: foreign.page,
        requested: target,
        ownerExternalId: "amelia",
        assertControl: () => {},
      })
    ).rejects.toThrow("OWNER_SCOPE_VIOLATION");
  });
});
