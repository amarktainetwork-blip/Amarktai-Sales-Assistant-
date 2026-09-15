type OwnerScopedRecord = { ownerExternalId?: string | null };

const PERSONAL_BROWSER_RESOURCES = new Set(["contacts", "tasks"]);

export function assertPersonalBrowserOwnerScope(input: {
  resourceType: string;
  expectedOwnerExternalId: string;
  records: OwnerScopedRecord[];
}) {
  if (!PERSONAL_BROWSER_RESOURCES.has(input.resourceType)) return;
  const expected = input.expectedOwnerExternalId.trim();
  if (!expected)
    throw new Error(
      "CRM_OWNER_SCOPE_REQUIRED: personal CRM sync requires an immutable salesperson owner ID."
    );

  for (const record of input.records) {
    const actual = String(record.ownerExternalId || "").trim();
    if (!actual)
      throw new Error(
        `CRM_OWNER_SCOPE_REQUIRED: ${input.resourceType} returned a record without immutable owner identity.`
      );
    if (actual !== expected)
      throw new Error(
        `CRM_OWNER_SCOPE_VIOLATION: ${input.resourceType} returned another salesperson's record.`
      );
  }
}
