import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const today=readFileSync(new URL("../client/src/pages/Today.tsx",import.meta.url),"utf8");
const styles=readFileSync(new URL("../client/src/index.css",import.meta.url),"utf8");
describe("Today 2026 calm salesperson design",()=>{
  it("keeps the source-bound data and genuine work actions",()=>{
    for(const marker of [
      "data-today-workspace","data-today-design-version=\"20261002\"",
      "data-today-work-plan","data-today-summary","data-today-categories",
      "data-today-internal-work","data-today-queue",
      "crmConnection?.reconnectRequired","freshnessLabel(",
      "item.contactEligibleNow !== false","today.data?.queues.callQueue",
      "startCall.mutate","navigate(\"/reviews\")",
    ])expect(today).toContain(marker);
  });
  it("does not replace a real contact, stage or task with sample data",()=>{
    expect(today).toContain("{current.name}");
    expect(today).toContain("{upcoming[0]?.title || \"Nothing timed is outstanding\"}");
    expect(today).toContain("No customer messages are sent automatically.");
    expect(today).toContain("No customer should be contacted yet.");
  });
  it("scopes the accessible design and has mobile/reduced-motion rules",()=>{
    expect(styles).toContain('.amk-day[data-today-design-version="20261002"]');
    expect(styles).toContain("data-today-design-version");
    expect(styles).toContain("prefers-reduced-motion:reduce");
    expect(styles).toContain("focus-visible");
    expect(styles).toContain("grid-template-columns:1fr;");
  });
});
