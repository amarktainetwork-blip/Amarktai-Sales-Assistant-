import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../client/src/pages/CrmWorkspace.tsx", import.meta.url),
  "utf8"
);

describe("CRM workspace customer interaction contract", () => {
  it("keeps Amarktai navigation while removing redundant setup chrome inside CRM", () => {
    expect(source).toContain("<DashboardLayout>");
    expect(source).toContain("data-crm-workspace-root");
    expect(
      readFileSync(
        new URL("../client/src/dashboard-final.css", import.meta.url),
        "utf8"
      )
    ).toContain("main:has(> [data-crm-workspace-root])");
    expect(source).not.toContain("<style>");
    expect(source).not.toContain("Capability summary");
    expect(source).not.toContain("Latest CRM activity");
  });

  it("automatically acquires human control for the first CRM interaction", () => {
    expect(source).toContain("pendingInputsRef");
    expect(source).toContain('type: "acquireHumanControl"');
    expect(source).toContain("flushPendingInput");
    expect(source).toContain("Move here to take control");
  });

  it("automatically hands authenticated CRM control back for commissioning", () => {
    expect(source).toContain("authenticationHandoffRef");
    expect(source).toContain('type: "customerFinishedSigningIn"');
    expect(source).toContain("Finishing your setup");
    expect(source.replace(/\s+/g, " ")).toContain(
      "Keep this page open — you do not need to click anything."
    );
  });

  it("keeps the CRM learning screen latched through polling and viewer reconnects", () => {
    expect(source).toContain(
      "const [learningStarted, setLearningStarted] = useState(false)"
    );
    expect(source).toContain(
      'if (browserAuthenticationState === "AUTHENTICATED")'
    );
    expect(source).toContain(
      'if (body.job?.state && body.job.state !== "AUTHENTICATE")'
    );
    expect(source).toContain(
      "}, [canManage, onboardingComplete, selectedSystemId]);"
    );
    expect(source).not.toContain(
      "}, [canManage, onboardingComplete, selected]);"
    );
    expect(source).toContain(
      "{canManage && !onboardingComplete && learningStarted ? ("
    );
    expect(source).toContain("Find CRM navigation");
    expect(source).toContain("Discover CRM functions");
    expect(source).toContain("Prove required CRM reads");
    expect(source).toContain("Prepare synchronized workspace");
  });

  it("does not make shared owner setup depend on claiming a salesperson identity", () => {
    expect(source).not.toContain("!crmIdentityMapped");
    expect(source).not.toContain("<CrmIdentitySetup");
    expect(source).toContain("capabilityAccounting");
    expect(source).toContain("criticalGaps");
  });

  it("maps the streamed browser image back to Chromium coordinates", () => {
    expect(source).toContain("frameMetadata");
    expect(source).toContain("deviceWidth");
    expect(source).toContain("deviceHeight");
    expect(source).toContain("localX / scale");
    expect(source).toContain("localY / scale");
    expect(source).toContain("deviceScaleFactor: 1");
  });

  it("uses the available responsive viewport without a duplicate sign-in overlay", () => {
    const input = readFileSync(
      new URL("../client/src/lib/crmViewerInput.ts", import.meta.url),
      "utf8"
    );
    expect(input).not.toContain("Math.max(1_024");
    expect(source).not.toContain(
      "Move into the CRM to take control automatically."
    );
    expect(source).not.toContain("Sign in directly to {crmName}");
    expect(source).toContain(
      'className="pointer-events-none h-full w-full select-none object-contain"'
    );
  });

  it("keeps keyboard and bounded paste input inside the managed CRM", () => {
    expect(source).toContain("onKeyDown");
    expect(source).toContain("onKeyUp");
    expect(source).toContain("onPaste");
    expect(source).toContain(".slice(0, 4_000)");
  });

  it("keeps secondary controls in the Assistant drawer", () => {
    expect(source).toContain(
      "const [assistantOpen, setAssistantOpen] = useState(false)"
    );
    expect(source).toContain("CRM controls");
    expect(source).toContain("Recent CRM activity");
    expect(source).not.toContain("CRM functions ·");
    expect(source).not.toContain("readyCapabilities.map");
  });

  it("forces a fresh isolated session when the customer reconnects", () => {
    expect(source).toContain(
      "const openViewer = async (forceReconnect = false)"
    );
    expect(source).toContain("forceReconnect,");
    expect(source).toContain("openViewer(true)");
  });
});
