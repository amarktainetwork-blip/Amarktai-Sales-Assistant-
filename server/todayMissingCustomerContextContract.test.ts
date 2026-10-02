import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../client/src/pages/Today.tsx", import.meta.url),
  "utf8"
);

describe("Internal tasks without a resolved CRM contact", () => {
  it("keeps the assigned task visible and labels missing source context truthfully", () => {
    expect(source).toContain("data-internal-contact-unavailable");
    expect(source).toContain("Linked CRM contact context unavailable");
    expect(source).toContain("customer identity, ownership and history cannot be safely inferred.");
    expect(source).toContain("Do not assume the customer name, owner, history or course.");
  });

  it("still prepares from real task instructions without inventing a customer", () => {
    expect(source).toContain("Task instruction: ${item.detail || item.title}.");
    expect(source).toContain("Prepare with AmarktAI");
    expect(source).toContain("Summarise the task instructions and explain the safest next action");
    expect(source).toContain("data-today-internal-work");
  });
});
