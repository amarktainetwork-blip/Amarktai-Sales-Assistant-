import { describe, expect, it } from "vitest";
import { buildExplainableForecast } from "./explainable";
describe("explainable forecasting", () => { it("uses only supplied configured probability evidence", () => {
  const forecast = buildExplainableForecast([{ valueMinor: 10000, probability: 50, stage: "qualified", evidence: ["mapped qualified stage"] }, { valueMinor: 3000, probability: 100, stage: "won", evidence: ["mapped won stage"] }]);
  expect(forecast.forecastValueMinor).toBe(8000); expect(forecast.confidence).toBe(75); expect(forecast.evidence).toHaveLength(2);
}); });
