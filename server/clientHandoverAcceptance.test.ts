import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

describe("final client handover regressions", () => {
  it("reports factual company-learning progress without a fake percentage", () => {
    const discovery = read("./companyDiscovery.ts");
    const jobs = read("./companyKnowledgeJobs.ts");
    const onboarding = read("../client/src/pages/Onboarding.tsx");
    for (const field of [
      "discoveredPages",
      "totalPagesKnown",
      "processedPages",
      "failedPages",
      "currentHost",
    ]) {
      expect(discovery).toContain(field);
      expect(onboarding).toContain(field);
    }
    expect(jobs).toContain("updatedAt: job.updatedAt");
    expect(onboarding).toContain("Larger websites can take several minutes");
    expect(onboarding).toContain("No percentage or finish");
  });

  it("guarantees an initial CRM frame and replays the initial auth snapshot", () => {
    const viewer = read("./liveCrmViewer.ts");
    expect(viewer.indexOf('cdp.on("Page.screencastFrame"')).toBeLessThan(
      viewer.indexOf('cdp.send("Page.startScreencast"')
    );
    expect(viewer).toContain('.send("Page.captureScreenshot"');
    expect(viewer).toContain(
      "...managedCrmBrowserSessionManager.snapshot(session.managed)"
    );
    const workspace = read("../client/src/pages/CrmWorkspace.tsx");
    expect(workspace).not.toContain('setStatus("CRM ready for sign-in")');
    expect(workspace).toContain("The CRM sign-in page did not render");
  });

  it("keeps automatic commissioning primary and manual teaching advanced", () => {
    const commissioning = read(
      "../client/src/components/BrowserCrmCommissioning.tsx"
    );
    for (const label of [
      "Customer data",
      "Tasks",
      "Opportunities",
      "Activities",
      "Notes",
      "Callback tasks",
      "Salesperson identity",
      "Advanced diagnostics",
    ])
      expect(commissioning).toContain(label);
    expect(commissioning.indexOf("Advanced diagnostics")).toBeLessThan(
      commissioning.lastIndexOf("Teach AmarktAI")
    );
  });

  it("uses one cohesive responsive Assistant conversation surface", () => {
    const assistant = read("../client/src/pages/Assistant.tsx");
    expect(assistant).toContain("data-assistant-conversation");
    expect(assistant).toContain("data-assistant-composer");
    expect(assistant).toContain(
      "AmarktAI knows your connected sales workspace"
    );
    expect(assistant).toContain("100dvh");
  });

  it("keeps Review editable and explicit about approval and evidence", () => {
    const reviews = read("../client/src/pages/Reviews.tsx");
    expect(reviews).toContain("Draft reply");
    expect(reviews).toContain("Purpose");
    expect(reviews).toContain("Approve &amp; send");
    expect(reviews).toContain("price, availability, finance or guarantee");
    expect(reviews).toContain("<EvidenceDetails item={item}");
  });

  it("uses the approved local company-setup image", () => {
    const css = read("../client/src/index.css");
    const setupRule = css.slice(
      css.indexOf("main.amk-auth.amk-auth--setup .amk-auth__visual > img"),
      css.indexOf("/* Slightly darker")
    );
    expect(setupRule).toContain("homestation-office-8780133_1920.jpg");
    expect(setupRule).not.toContain("thenikscape-ai-generated-9587004_1920.jpg");
  });
});
