import { beforeEach, describe, expect, it, vi } from "vitest";
import { jwtVerify } from "jose";

const mocks = vi.hoisted(() => ({ getUserById: vi.fn() }));
vi.mock("./db", () => ({ createLocalAdminIfMissing: vi.fn(), getUserByEmail: vi.fn(), getUserById: mocks.getUserById }));

import { getLocalSessionIdentity, issueLocalSession, issuePasswordResetToken } from "./localAuth";

describe("local session active organisation claim", () => {
  beforeEach(() => {
    process.env.AUTH_MODE = "local";
    process.env.JWT_SECRET = "test-session-secret-with-sufficient-entropy";
    mocks.getUserById.mockReset();
  });

  it("reissues a signed session that resolves to the selected verified organisation", async () => {
    const user = { id: 19, email: "owner@example.test", name: "Owner", role: "user" } as any;
    mocks.getUserById.mockResolvedValue(user);
    const token = await issueLocalSession(user, 44);
    await expect(getLocalSessionIdentity(token)).resolves.toMatchObject({ user, activeOrganisationId: 44 });
  });

  it("issues a short-lived password-reset token bound to the current password hash", async () => {
    const user = { id: 19, email: "owner@example.test", passwordHash: "current-password-hash" } as any;
    const token = await issuePasswordResetToken(user);
    const verified = await jwtVerify(token, new TextEncoder().encode(process.env.JWT_SECRET));
    expect(verified.payload).toMatchObject({ sub: "19", purpose: "password_reset", passwordHash: "current-password-hash" });
  });
});
