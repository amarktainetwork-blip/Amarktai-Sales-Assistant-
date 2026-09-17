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
});
