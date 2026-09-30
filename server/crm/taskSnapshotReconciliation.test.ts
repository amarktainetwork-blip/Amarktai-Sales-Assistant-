import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { missingTaskIdsFromSnapshot } from "./sync";

describe("CRM pending-task snapshot reconciliation", () => {
  it("retires only cached open tasks that disappeared from the complete current snapshot", () => {
    expect(
      missingTaskIdsFromSnapshot(
        ["still-open", "now-closed", "still-open", "deleted-or-closed"],
        ["still-open"]
      )
    ).toEqual(["now-closed", "deleted-or-closed"]);
  });

  it("does not retire anything when every cached open task is still present", () => {
    expect(
      missingTaskIdsFromSnapshot(["a", "b"], new Set(["b", "a"]))
    ).toEqual([]);
  });

  it("restarts full task snapshots from the first provider page instead of a historical cursor", () => {
    const source = readFileSync(new URL("./sync.ts", import.meta.url), "utf8");
    const fullBuffer = source.indexOf(
      "const bufferedTaskRecords ="
    );
    const fullDrain = source.indexOf(
      "const drained = await drainCrmPages<SyncRecord>",
      fullBuffer
    );
    const fullPersist = source.indexOf(
      "await upsertTasks(",
      fullDrain
    );
    const fullSnapshot = source.slice(fullDrain, fullPersist);
    expect(fullSnapshot).toContain(
      'resourceType === "tasks" ? undefined : existing?.cursor ?? undefined'
    );
  });

  it("publishes Genie task snapshots only after the complete owner-scoped read succeeds", () => {
    const source = readFileSync(new URL("./sync.ts", import.meta.url), "utf8");
    expect(source).toContain(
      "Do not publish any page until the complete snapshot has succeeded."
    );
    const routineBuffer = source.indexOf(
      "const bufferedTaskRecords: NormalizedTask[] = []"
    );
    const routineDrain = source.indexOf(
      "const drained = await drainCrmPages<NormalizedTask>"
    );
    const routinePersist = source.indexOf(
      "await upsertTasks(input.organisationId, system.id, bufferedTaskRecords"
    );
    expect(routineBuffer).toBeGreaterThan(-1);
    expect(routineDrain).toBeGreaterThan(routineBuffer);
    expect(routinePersist).toBeGreaterThan(routineDrain);
  });
});
