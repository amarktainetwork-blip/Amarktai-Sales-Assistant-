import assert from "node:assert/strict";
import { spawn, fork } from "node:child_process";
import { mkdtemp, readFile, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
process.env.AMARKTAI_PERSIST_CRM_CONTEXTS = "1";
if (process.argv[2] === "owner") {
  const browser = await chromium.connectOverCDP(process.argv[3]);
  const targets = [];
  for (const identity of ["owner-a", "owner-b"]) {
    const context = await browser.newContext();
    await context.addCookies([
      { name: "fixture_identity", value: identity, url: process.argv[4] },
    ]);
    const page = await context.newPage();
    await page.goto(process.argv[4]);
    await page.evaluate(
      value => sessionStorage.setItem("fixture_identity", value),
      identity
    );
    const cdp = await context.newCDPSession(page);
    const { targetInfo } = await cdp.send("Target.getTargetInfo");
    await cdp.detach();
    targets.push({ id: targetInfo.targetId, identity });
  }
  process.send(targets);
  await new Promise(() => {});
} else {
  const root = path.resolve(
    process.env.CRM_LIFECYCLE_OUTPUT || "../browser-lifecycle"
  );
  await mkdir(root, { recursive: true });
  const profile = await mkdtemp(path.join(root, "owned-fixture-"));
  const server = createServer((_req, res) =>
    res.end("<!doctype html><title>Local lifecycle fixture</title>")
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/`;
  const executable =
    process.env.CRM_TEST_CHROMIUM ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe";
  const chrome = spawn(
    executable,
    [
      "--headless=new",
      ...(process.platform === "linux" && process.env.CI ? ["--no-sandbox"] : []),
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true }
  );
  let owner, browser;
  try {
    let port;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        port = (
          await readFile(path.join(profile, "DevToolsActivePort"), "utf8")
        ).split("\n")[0];
        break;
      } catch {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    assert(port, "Local fixture Chromium did not start");
    const endpoint = `http://127.0.0.1:${port}`;
    owner = fork(fileURLToPath(import.meta.url), ["owner", endpoint, url], {
      stdio: ["ignore", "ignore", "inherit", "ipc"],
      windowsHide: true,
    });
    const [targets] = await Promise.race([
      once(owner, "message"),
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("Owner fixture timed out")), 30000)
      ),
    ]);
    const ownerExit = once(owner, "exit");
    owner.kill("SIGKILL");
    await ownerExit;
    browser = await chromium.connectOverCDP(endpoint);
    const seen = [];
    for (const context of browser.contexts())
      for (const page of context.pages()) {
        if (page.url() !== url) continue;
        const cdp = await context.newCDPSession(page);
        const { targetInfo } = await cdp.send("Target.getTargetInfo");
        await cdp.detach();
        const expected = targets.find(x => x.id === targetInfo.targetId);
        assert(expected, "Unexpected test target");
        const cookies = await context.cookies(url);
        assert.equal(
          cookies.find(x => x.name === "fixture_identity")?.value,
          expected.identity
        );
        assert.equal(
          await page.evaluate(() => sessionStorage.getItem("fixture_identity")),
          expected.identity
        );
        assert.equal(
          context.pages().filter(x => x.url() === url).length,
          1,
          "Different owners share a context"
        );
        seen.push(targetInfo.targetId);
      }
    assert.equal(
      seen.length,
      2,
      "Authenticated targets were lost when the owner process exited"
    );
    console.log(
      JSON.stringify({
        passed: true,
        targetsSurvived: seen.length,
        isolatedCookies: true,
        sessionStoragePreserved: true,
        scope: "local fixtures only",
      })
    );
  } finally {
    owner?.kill();
    await browser?.close().catch(() => {});
    chrome.kill();
    await new Promise(r => setTimeout(r, 300));
    server.close();
    assert(profile.startsWith(root + path.sep + "owned-fixture-"));
    await rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    }).catch(() => {});
  }
}
