import { describe, expect, it } from "vitest";
import { GENIE_SCRIPT_NAMES } from "./savedScripts";

describe("Genie saved script catalogue", () => {
  it("contains every required operating module", () => {
    expect(GENIE_SCRIPT_NAMES).toEqual(expect.arrayContaining([
      "search_candidate",
      "read_candidate_history",
      "send_template_sms",
      "add_note",
      "complete_active_task",
      "create_next_task",
      "update_current_opportunity",
    ]));
  });
});
