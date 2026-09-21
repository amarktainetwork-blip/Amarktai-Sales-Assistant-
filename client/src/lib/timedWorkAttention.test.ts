import { describe, expect, it } from "vitest";
import { timedWorkAttention } from "./timedWorkAttention";

const item = (key: string, dueAt: string) => ({
  key,
  name: key,
  headline: `Task ${key}`,
  dueAt,
});

describe("timed work attention", () => {
  const now = new Date("2026-09-21T13:30:00Z").valueOf();

  it("stays quiet outside the 30-minute warning window", () => {
    expect(
      timedWorkAttention(
        [item("later", "2026-09-21T14:00:01Z")],
        now
      )
    ).toBeNull();
  });

  it("raises work inside 30 minutes and reports the remaining minutes", () => {
    const result = timedWorkAttention(
      [item("soon", "2026-09-21T13:59:00Z")],
      now
    );
    expect(result?.phase).toBe("soon");
    expect(result?.minutes).toBe(29);
  });
  it("escalates at due time with a distinct due phase", () => {
    const result = timedWorkAttention(
      [item("now", "2026-09-21T13:30:00Z")],
      now
    );
    expect(result?.phase).toBe("due");
    expect(result?.minutes).toBe(0);
  });

  it("drops old overdue work from the global reminder while Today keeps it", () => {
    expect(
      timedWorkAttention(
        [item("old", "2026-09-21T13:28:59Z")],
        now
      )
    ).toBeNull();
  });

  it("chooses the earliest timed item in the active alert window", () => {
    const result = timedWorkAttention(
      [
        item("later", "2026-09-21T13:58:00Z"),
        item("first", "2026-09-21T13:40:00Z"),
      ],
      now
    );
    expect(result?.item.key).toBe("first");
  });
});
