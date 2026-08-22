export type ForecastOpportunity = { valueMinor: number; probability: number; stage: string; evidence: string[] };
export function buildExplainableForecast(opportunities: ForecastOpportunity[]) {
  const normalized = opportunities.map(item => ({ ...item, probability: Math.max(0, Math.min(100, item.probability)) }));
  const forecastValueMinor = normalized.reduce((total, item) => total + Math.round(item.valueMinor * item.probability / 100), 0);
  const evidence = normalized.map(item => ({ stage: item.stage, valueMinor: item.valueMinor, probability: item.probability, reasons: item.evidence }));
  const confidence = normalized.length ? Math.round(normalized.reduce((sum, item) => sum + item.probability, 0) / normalized.length) : 0;
  return { forecastValueMinor, confidence, methodology: "configured_probability_weighted_pipeline", evidence };
}
