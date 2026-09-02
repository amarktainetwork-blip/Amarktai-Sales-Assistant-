import { describe, expect, it } from "vitest";
import {
  authenticationStateFromEvidence,
  resolvedAuthenticationState,
  shouldReuseManagedCrmBrowserSession,
  type BrowserAuthenticationEvidence,
} from "./managedCrmBrowserSessionManager";

const authenticated: BrowserAuthenticationEvidence = {
  authorisedUrl: true,
  loginVisible: false,
  verificationVisible: false,
  strongAuthenticatedMarker: true,
  meaningfulApplicationStructure: true,
  stablePage: true,
  safeReadInspectionPassed: true,
  customerConfirmed: false,
  knownProvider: true,
};

describe("conservative CRM authentication proof", () => {
  it("does not treat a login page as authenticated", () => {
    expect(
      authenticationStateFromEvidence({ ...authenticated, loginVisible: true })
    ).toBe("LOGIN_REQUIRED");
  });

  it("does not treat MFA or SSO verification as authenticated", () => {
    expect(
      authenticationStateFromEvidence({
        ...authenticated,
        verificationVisible: true,
      })
    ).toBe("MFA_OR_SSO");
  });

  it("does not treat generic navigation or a loader-free page as proof", () => {
    expect(
      authenticationStateFromEvidence({
        ...authenticated,
        strongAuthenticatedMarker: false,
      })
    ).toBe("USER_AUTHENTICATING");
    expect(
      authenticationStateFromEvidence({ ...authenticated, stablePage: false })
    ).toBe("USER_AUTHENTICATING");
  });

  it("accepts a stable authorised known CRM shell with a strong marker", () => {
    expect(authenticationStateFromEvidence(authenticated)).toBe(
      "AUTHENTICATED"
    );
  });

  it("does not let customer confirmation replace a known CRM marker", () => {
    expect(
      authenticationStateFromEvidence({
        ...authenticated,
        strongAuthenticatedMarker: false,
        customerConfirmed: true,
      })
    ).toBe("CHECKING");
  });

  it("requires confirmation and structural proof for an unknown CRM", () => {
    const unknown = {
      ...authenticated,
      knownProvider: false,
      strongAuthenticatedMarker: false,
    };
    expect(authenticationStateFromEvidence(unknown)).toBe(
      "USER_AUTHENTICATING"
    );
    expect(
      authenticationStateFromEvidence({
        ...unknown,
        customerConfirmed: true,
        meaningfulApplicationStructure: false,
      })
    ).toBe("CHECKING");
    expect(
      authenticationStateFromEvidence({ ...unknown, customerConfirmed: true })
    ).toBe("AUTHENTICATED");
  });

  it("never lets customer confirmation override visible login controls", () => {
    expect(
      authenticationStateFromEvidence({
        ...authenticated,
        knownProvider: false,
        customerConfirmed: true,
        loginVisible: true,
      })
    ).toBe("LOGIN_REQUIRED");
  });

  it("reports sign-in-again when a restored session returns to login", () => {
    const login = { ...authenticated, loginVisible: true };
    expect(resolvedAuthenticationState(login, false)).toBe("LOGIN_REQUIRED");
    expect(resolvedAuthenticationState(login, true)).toBe(
      "REAUTHENTICATION_REQUIRED"
    );
  });
});

describe("managed CRM browser recovery", () => {
  it("does not reuse an about:blank session after navigation failed", () => {
    expect(
      shouldReuseManagedCrmBrowserSession({
        pageClosed: false,
        browserConnected: true,
        currentUrl: "about:blank",
        connectionHealth: "needs_attention",
      })
    ).toBe(false);
  });

  it("keeps a live login page available for the customer", () => {
    expect(
      shouldReuseManagedCrmBrowserSession({
        pageClosed: false,
        browserConnected: true,
        currentUrl: "https://genie.entrepreneurscircle.org/login",
        connectionHealth: "connecting",
      })
    ).toBe(true);
  });
});
