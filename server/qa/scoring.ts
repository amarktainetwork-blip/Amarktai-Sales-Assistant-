export function scoreAgainstRubric(criteria: Array<{ key: string; weight: number }>, scores: Record<string, number>) {
  if (!criteria.length) throw new Error("QA_RUBRIC_EMPTY");
  const totalWeight = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (totalWeight <= 0) throw new Error("QA_RUBRIC_INVALID");
  const weighted = criteria.reduce((sum, criterion) => sum + Math.max(0, Math.min(100, scores[criterion.key] ?? 0)) * criterion.weight, 0);
  return Math.round(weighted / totalWeight);
}
