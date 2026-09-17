import { describe, expect, it } from "vitest";
import {
  rememberNewLeadNotifications,
  unseenNewLeadNotifications,
} from "./newLeadNotifications";

describe("new lead notification dedupe", () => {
  it("does not re-notify the same lead on the next minute poll", () => {
    const alerts = [{ sourceKey: "lead:a" }, { sourceKey: "lead:b" }];
    const first = unseenNewLeadNotifications(alerts, []);
    const remembered = rememberNewLeadNotifications([], first);
    const next = unseenNewLeadNotifications(alerts, remembered);
    expect(first).toEqual(alerts);
    expect(next).toEqual([]);
  });

  it("still surfaces a genuinely new lead on a later poll", () => {
    const alerts = [{ sourceKey: "lead:a" }, { sourceKey: "lead:b" }];
    const next = unseenNewLeadNotifications(alerts, ["lead:a"]);
    expect(next).toEqual([{ sourceKey: "lead:b" }]);
  });
});
