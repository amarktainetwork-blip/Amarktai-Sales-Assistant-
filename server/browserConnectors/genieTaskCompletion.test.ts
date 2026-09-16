import { it, expect } from "vitest";
import { normalizeGenieTaskGridPage } from "./browserCrmAdapter";
import { isIncompleteTask } from "../../shared/taskState";
const normalize = (properties: Record<string, unknown>) =>
  normalizeGenieTaskGridPage({
    customObjectRecords: [{ id: "task", owners: ["owner"], properties }],
    total: 1,
  }).records[0];
it.each([1, true, "1", "true"])(
  "normalizes completed %s without inventing a timestamp",
  completed => {
    const task = normalize({ completed, dueDate: "2020-01-01" });
    expect(task.status).toBe("completed");
    expect(task.completedAt).toBe("");
    expect(isIncompleteTask(task.status)).toBe(false);
  }
);
it.each([0, false, "0", "false"])("normalizes incomplete %s", completed =>
  expect(normalize({ completed }).status).toBe("open")
);
it("fails conservatively when completion and explicit status are unknown", () => {
  expect(normalize({}).status).toBe("unknown");
  expect(isIncompleteTask(normalize({ completed: "maybe" }).status)).toBe(
    false
  );
});
it("respects completion true above stale open, and explicit terminal state above false", () => {
  expect(normalize({ completed: 1, status: "open" }).status).toBe("completed");
  expect(normalize({ completed: 0, status: "done" }).status).toBe("done");
  expect(normalize({ status: "pending" }).status).toBe("pending");
});
it("keeps only reliable explicit completion timestamps", () => {
  expect(normalize({ completed: 1, updatedAt: "2026-01-01" }).completedAt).toBe(
    ""
  );
  expect(
    normalize({ completed: 1, completedAt: "2026-01-01T12:00:00Z" }).completedAt
  ).toBe("2026-01-01T12:00:00Z");
});
