import type {
  ClientActionConfiguration,
  TodayWorkCategoryConfiguration,
  TodayWorkPolicyConfiguration,
  TodayWorkSourceKind,
} from "./clientActionConfiguration";

export function normalizedWorkTitle(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function localMinute(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find(part => part.type === "hour")?.value || 0);
  const minute = Number(parts.find(part => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function localDayNumber(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find(part => part.type === type)?.value || 0);
  return Math.floor(
    Date.UTC(value("year"), Math.max(0, value("month") - 1), value("day")) /
      86_400_000
  );
}

function clockMinute(value: string | undefined) {
  if (!value || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function aliasesByPurpose(configuration: ClientActionConfiguration) {
  const map = new Map<string, Set<string>>();
  for (const workflow of Object.values(configuration.workflows)) {
    for (const purpose of workflow.taskSequence) {
      const aliases = [
        workflow.taskAliases[purpose],
        ...(workflow.taskAliasAlternatives?.[purpose] || []),
      ]
        .filter((value): value is string => Boolean(value?.trim()))
        .map(normalizedWorkTitle);
      if (!aliases.length) continue;
      const existing = map.get(purpose) || new Set<string>();
      for (const alias of aliases) existing.add(alias);
      map.set(purpose, existing);
    }
  }
  return map;
}

function taskMatchesCategory(
  title: string,
  category: TodayWorkCategoryConfiguration,
  purposeAliases: Map<string, Set<string>>
) {
  const normalized = normalizedWorkTitle(title);
  if (
    category.exactTaskTitles.some(
      candidate => normalizedWorkTitle(candidate) === normalized
    )
  )
    return true;
  if (
    category.taskTitlePrefixes.some(prefix =>
      normalized.startsWith(normalizedWorkTitle(prefix))
    )
  )
    return true;
  if (
    category.taskTitleContains.some(fragment =>
      normalized.includes(normalizedWorkTitle(fragment))
    )
  )
    return true;
  return category.workflowPurposes.some(
    purpose => purposeAliases.get(purpose)?.has(normalized) === true
  );
}

export function resolveTodayWorkCategory(input: {
  configuration: ClientActionConfiguration;
  sourceKind?: TodayWorkSourceKind;
  taskTitle?: string | null;
}) {
  const policy = input.configuration.todayWorkPolicy;
  if (!policy) return null;
  const purposeAliases = aliasesByPurpose(input.configuration);
  for (const category of policy.categories) {
    if (input.sourceKind && category.sourceKinds.includes(input.sourceKind))
      return category;
    if (
      input.taskTitle &&
      taskMatchesCategory(input.taskTitle, category, purposeAliases)
    )
      return category;
  }
  return null;
}

export function todayCategoryPriority(input: {
  category: TodayWorkCategoryConfiguration | null;
  now: Date;
  timezone: string;
  policy?: TodayWorkPolicyConfiguration;
  fallback: number;
  preserveUrgentRank?: boolean;
}) {
  if (!input.category) return input.fallback;
  const morningEnd = clockMinute(input.policy?.morningWindowEnd);
  const currentMinute = localMinute(input.now, input.timezone);
  const configured =
    morningEnd !== null &&
    currentMinute < morningEnd &&
    input.category.morningPriority != null
      ? input.category.morningPriority
      : input.category.priority;
  return input.preserveUrgentRank
    ? Math.min(input.fallback, configured)
    : configured;
}

function minuteLabel(minute: number) {
  const safe = Math.max(0, Math.min(23 * 60 + 59, Math.round(minute)));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(
    safe % 60
  ).padStart(2, "0")}`;
}

export function configuredCallTimeRotation(input: {
  policy?: TodayWorkPolicyConfiguration;
  categoryKey?: string | null;
  now: Date;
  timezone: string;
  previousAttempt?: Date | null;
}) {
  const rotation = input.policy?.callTimeRotation;
  if (
    !rotation?.enabled ||
    !input.categoryKey ||
    !rotation.categoryKeys.includes(input.categoryKey) ||
    !input.previousAttempt
  )
    return {
      defer: false,
      sortMinute: Number.MAX_SAFE_INTEGER,
      reason: null as string | null,
      sequenceGapDays: null as number | null,
    };

  const nowMinute = localMinute(input.now, input.timezone);
  const previousMinute = localMinute(input.previousAttempt, input.timezone);
  const gapDays =
    localDayNumber(input.now, input.timezone) -
    localDayNumber(input.previousAttempt, input.timezone);
  const difference = Math.abs(nowMinute - previousMinute);

  if (gapDays < 1 || difference >= rotation.minimumVariationMinutes)
    return {
      defer: false,
      sortMinute: Number.MAX_SAFE_INTEGER,
      reason:
        gapDays > 1 && gapDays < rotation.expectedConsecutiveDays
          ? `Contact sequence needs recovery: previous attempt was ${gapDays} days ago`
          : null,
      sequenceGapDays: gapDays,
    };

  const suggestedMinute = previousMinute + rotation.minimumVariationMinutes;
  if (suggestedMinute <= 20 * 60 && suggestedMinute > nowMinute)
    return {
      defer: true,
      sortMinute: suggestedMinute,
      reason: `Previous attempt was ${minuteLabel(previousMinute)}; vary today's contact time and try after ${minuteLabel(suggestedMinute)}`,
      sequenceGapDays: gapDays,
    };

  return {
    defer: false,
    sortMinute: Number.MAX_SAFE_INTEGER,
    reason: `Previous attempt was ${minuteLabel(previousMinute)}; use a meaningfully different contact time today`,
    sequenceGapDays: gapDays,
  };
}

export function buildTodayWorkGroups<
  T extends {
    workCategoryKey: string | null;
    workCategoryLabel: string | null;
    contactEligibleNow: boolean;
  },
>(
  queue: T[],
  policy?: TodayWorkPolicyConfiguration
) {
  if (!policy) return [];
  const countByKey = new Map<
    string,
    { count: number; availableNow: number; label: string }
  >();
  for (const item of queue) {
    if (!item.workCategoryKey || !item.workCategoryLabel) continue;
    const current = countByKey.get(item.workCategoryKey) || {
      count: 0,
      availableNow: 0,
      label: item.workCategoryLabel,
    };
    current.count += 1;
    if (item.contactEligibleNow) current.availableNow += 1;
    countByKey.set(item.workCategoryKey, current);
  }
  return policy.categories
    .map(category => {
      const counts = countByKey.get(category.key);
      return {
        key: category.key,
        label: category.label,
        count: counts?.count || 0,
        availableNow: counts?.availableNow || 0,
      };
    })
    .filter(group => group.count > 0);
}
