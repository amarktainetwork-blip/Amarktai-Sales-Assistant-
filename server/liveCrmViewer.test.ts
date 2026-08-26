import { describe, expect, it } from "vitest";
import { isLiveCrmViewerAccessAllowed } from "./liveCrmViewer";

const viewerToken = Buffer.from("viewer-token-for-test").toString("base64url");
const session = {
  organisationId: 18,
  connectedSystemId: 44,
  userId: 7,
  token: Buffer.from("viewer-token-for-test"),
};

describe("live CRM viewer access scope", () => {
  it("allows only the session owner in the active organisation with the exact short-lived token", () => {
    expect(isLiveCrmViewerAccessAllowed(session, { organisationId: 18, userId: 7, token: viewerToken })).toBe(true);
  });

  it("rejects an attempt by a different user to open the same session", () => {
    expect(isLiveCrmViewerAccessAllowed(session, { organisationId: 18, userId: 8, token: viewerToken })).toBe(false);
  });

  it("rejects an organisation mismatch and an invalid token", () => {
    expect(isLiveCrmViewerAccessAllowed(session, { organisationId: 19, userId: 7, token: viewerToken })).toBe(false);
    expect(isLiveCrmViewerAccessAllowed(session, { organisationId: 18, userId: 7, token: "wrong-token" })).toBe(false);
  });
});
