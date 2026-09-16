export const AMELIA_HANDOVER = {
  userId: 2,
  organisationId: 8,
  connectedSystemId: 8,
  email: "amelia@course2career.com",
  ownerExternalId: "yZrFI0ptOyvG3ZXvs7iZ",
} as const;
export function handoverCheck(name: string, ok: unknown) {
  return { name, ok: ok === true };
}
export function exactOwnerCounts(
  rows: Array<{ ownerExternalId: string | null; count: number }>,
  owner: string
) {
  return {
    total: rows.reduce((n, r) => n + Number(r.count), 0),
    owned: rows
      .filter(r => r.ownerExternalId === owner)
      .reduce((n, r) => n + Number(r.count), 0),
    nullOwner: rows
      .filter(r => !r.ownerExternalId)
      .reduce((n, r) => n + Number(r.count), 0),
    other: rows
      .filter(r => r.ownerExternalId && r.ownerExternalId !== owner)
      .reduce((n, r) => n + Number(r.count), 0),
  };
}
export function exactTaskCollectionProven(
  count: number,
  evidence: Record<string, unknown>
) {
  return (
    evidence.ownerExternalId === AMELIA_HANDOVER.ownerExternalId &&
    Number(evidence.sourceTotal) === count &&
    Number(evidence.pagesRead) > 0
  );
}
export function handoverAllPassed(checks: Array<{ ok: boolean }>) {
  return checks.length > 0 && checks.every(c => c.ok);
}
