import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("client handover recovery contract", () => {
  it("routes Genie through the established browser adapter", () => {
    const source = read("./adapterRegistry.ts");
    expect(source).toContain('genie: browserAdapter("genie")');
    expect(source).not.toContain("genieSessionApiAdapter");
  });

  it("does not bypass normal browser commissioning for Genie", () => {
    const source = read("./automaticCommissioning.ts");
    expect(source).not.toContain(
      'job.connectorClass === "native_api" || system.provider === "genie"'
    );
    expect(source).not.toContain(
      'system.connectionMethod === "oauth" || sessionApi'
    );
    expect(source).not.toContain(
      'const sessionApi = system.provider === "genie"'
    );
    expect(source).toContain('if (system.connectionMethod !== "oauth") {');
  });

  it("keeps exact salesperson scope while browser operation truth gates sync", () => {
    const source = read("./sync.ts");
    expect(source).toContain("hasExactBrowserUserScope");
    expect(source).toContain('const browserSourceScopedResource = ["contacts", "tasks"].includes(resourceType)');
    expect(source).toContain("browserOperationStatuses?.get(syncOperationKey)");
    expect(source).not.toContain("const sessionApi =");
  });

  it("restarts only safe-read verification after identity confirmation", () => {
    const source = read("../teamAdmin/routes.ts");
    expect(source).toContain('state: "TEST_SAFE_READS"');
    expect(source).toContain('status: "queued"');
    expect(source).toContain("Verifying salesperson CRM reads");
  });

  it("binds captured Contacts navigation to every canonical Genie read that starts through Contacts", () => {
    const source = read("./automaticCommissioning.ts");
    expect(source).toContain(
      'definition.execute?.steps[0]?.selector === "#sb_contacts"'
    );
    expect(source).not.toContain(
      '["contact.sync", "contact.search"].includes(operationKey)'
    );
    expect(source).toContain("contactNavigationVersion !== 2");
    expect(source).toContain("contactNavigationVersion: 2");
  });

  it("passes the exact Git revision into the existing Docker image label", () => {
    const update = read("../../deploy/webdock/update.sh");
    const dockerfile = read("../../deploy/webdock/Dockerfile");
    expect(update).toContain('VCS_REF="$(git rev-parse HEAD');
    expect(update).toContain('build --build-arg VCS_REF="$VCS_REF"');
    expect(dockerfile).toContain("ARG VCS_REF=unknown");
    expect(dockerfile).toContain("LABEL org.opencontainers.image.revision=$VCS_REF");
  });
});
