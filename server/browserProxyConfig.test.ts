import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Chromium CDP reverse proxy", () => {
  it("keeps private WebSocket sessions alive during human sign-in", () => {
    const config = readFileSync(
      new URL("../deploy/browser/nginx.conf", import.meta.url),
      "utf8"
    );

    expect(config).toContain("proxy_set_header Upgrade $http_upgrade;");
    expect(config).toContain(
      "proxy_set_header Connection $connection_upgrade;"
    );
    expect(config).toContain("proxy_read_timeout 3600s;");
    expect(config).toContain("proxy_send_timeout 3600s;");
  });
});
