import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLocalSessionIdentity: vi.fn(),
  resolveActiveOrganisation: vi.fn(),
  verifyTwoFactorSession: vi.fn(),
}));

vi.mock("./localAuth", () => ({ getLocalSessionIdentity: mocks.getLocalSessionIdentity }));
vi.mock("./organisation", () => ({ resolveActiveOrganisation: mocks.resolveActiveOrganisation }));
vi.mock("./twoFactor", () => ({ TWO_FACTOR_COOKIE: "two_factor", verifyTwoFactorSession: mocks.verifyTwoFactorSession }));

import { requireLocalHttpContext } from "./httpAuth";

const request = { headers: { cookie: "session=token; two_factor=verified" } } as any;
const membership = { organisationId: 7, userId: 2, role: "owner", organisationName: "North", timezone: "UTC", locale: "en", currency: "USD" };

describe("signed active organisation HTTP boundary", () => {
  beforeEach(() => {
    mocks.getLocalSessionIdentity.mockReset();
    mocks.resolveActiveOrganisation.mockReset();
    mocks.verifyTwoFactorSession.mockReset();
  });

  it("returns the verified active membership to protected routes", async () => {
    mocks.getLocalSessionIdentity.mockResolvedValue({ user: { id: 2 }, activeOrganisationId: 7 });
    mocks.resolveActiveOrganisation.mockResolvedValue(membership);
    mocks.verifyTwoFactorSession.mockResolvedValue(true);
    await expect(requireLocalHttpContext(request)).resolves.toEqual({ userId: 2, membership });
  });

  it("denies an active organisation claim that does not resolve to a membership", async () => {
    mocks.getLocalSessionIdentity.mockResolvedValue({ user: { id: 2 }, activeOrganisationId: 9 });
    mocks.resolveActiveOrganisation.mockRejectedValue(new Error("ACTIVE_ORGANISATION_ACCESS_DENIED"));
    await expect(requireLocalHttpContext(request)).rejects.toThrow("ACTIVE_ORGANISATION_ACCESS_DENIED");
    expect(mocks.verifyTwoFactorSession).not.toHaveBeenCalled();
  });
});
