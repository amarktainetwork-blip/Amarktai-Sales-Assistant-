import { describe, expect, it } from "vitest";
import { scoreAgainstRubric } from "./scoring";
describe("QA rubric scoring", () => { it("produces a transparent weighted score", () => expect(scoreAgainstRubric([{ key: "accuracy", weight: 2 }, { key: "empathy", weight: 1 }], { accuracy: 90, empathy: 60 })).toBe(80)); });
