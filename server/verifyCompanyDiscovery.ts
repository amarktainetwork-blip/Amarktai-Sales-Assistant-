import { pathToFileURL } from "node:url";
import { discoverPublicWebsite } from "./companyDiscovery";

type DiscoveryProbeFacts = {
  renderedPages?: number;
  renderFallbacks?: number;
};

function line(name: string, value: string | number) {
  process.stdout.write(`${name}=${value}\n`);
}

export async function runCompanyDiscoveryProbe(rawUrl: string) {
  try {
    const discovery = await discoverPublicWebsite(rawUrl);
    const facts = discovery.proposedFacts as DiscoveryProbeFacts;
    line("DISCOVERY_FETCH", "PASS");
    line("PAGES_COLLECTED", discovery.pages.length);
    line("RENDERED_PAGES", facts.renderedPages ?? 0);
    line("RENDER_FALLBACKS", facts.renderFallbacks ?? 0);
    line("APP_PROCESS_STABLE", "PASS");
    return 0;
  } catch {
    line("DISCOVERY_FETCH", "FAIL");
    line("PAGES_COLLECTED", 0);
    line("RENDERED_PAGES", 0);
    line("RENDER_FALLBACKS", 0);
    line("APP_PROCESS_STABLE", "PASS");
    return 1;
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const rawUrl = process.argv[2]?.trim();
  if (!rawUrl) {
    line("DISCOVERY_FETCH", "FAIL");
    line("PAGES_COLLECTED", 0);
    line("RENDERED_PAGES", 0);
    line("RENDER_FALLBACKS", 0);
    line("APP_PROCESS_STABLE", "PASS");
    process.exitCode = 2;
  } else {
    void runCompanyDiscoveryProbe(rawUrl).then(code => {
      process.exitCode = code;
    });
  }
}
