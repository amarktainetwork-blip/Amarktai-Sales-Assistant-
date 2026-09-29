import {
  and,
  asc,
  count,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { crmTasks } from "../drizzle/schema";
import { getDb } from "./db";
import { personalOwnerSql } from "./customerData";
import { organisationDayBounds } from "../shared/organisationWorkspace";
import { INCOMPLETE_TASK_STATUSES } from "../shared/taskState";
export async function getTodayTaskData(input: {
  userId: number;
  organisationId: number;
  timezone: string;
  now: Date;
  priorityTitles: string[];
  backlogPolicy?: { mode: string; actionableSince?: string };
  excludeExternalIds?: string[];
}) {
  const db = await getDb();
  if (!db) throw Error("Database connection is unavailable.");
  const bounds = organisationDayBounds(input.now, input.timezone);
  const owned = and(
    eq(crmTasks.organisationId, input.organisationId),
    personalOwnerSql(
      input,
      crmTasks.connectedSystemId,
      crmTasks.ownerExternalId
    )
  );
  const excluded = Array.from(
    new Set(
      (input.excludeExternalIds || [])
        .map(value => value.trim())
        .filter(Boolean)
    )
  );
  // Source metrics must stay identical to CRM truth. Review-state exclusions
  // affect only the actionable queue, never the source counts shown to the user.
  const sourceIncomplete = and(
    owned,
    inArray(crmTasks.status, [...INCOMPLETE_TASK_STATUSES])
  );
  const cutoff =
    input.backlogPolicy?.mode === "since" && input.backlogPolicy.actionableSince
      ? new Date(input.backlogPolicy.actionableSince)
      : null;
  if (cutoff && !Number.isFinite(cutoff.getTime()))
    throw Error("INVALID_BACKLOG_POLICY");
  const sourceCurrent = and(
    sourceIncomplete,
    cutoff ? or(isNull(crmTasks.dueAt), gte(crmTasks.dueAt, cutoff)) : undefined
  );
  const queueCurrent = and(
    sourceCurrent,
    excluded.length ? notInArray(crmTasks.externalId, excluded) : undefined
  );
  const overdue = and(sourceCurrent, lt(crmTasks.dueAt, input.now));
  const today = and(
    sourceCurrent,
    gte(crmTasks.dueAt, input.now),
    lt(crmTasks.dueAt, bounds.endExclusive)
  );
  const futureScheduled = and(
    sourceCurrent,
    gte(crmTasks.dueAt, bounds.endExclusive)
  );
  const unscheduledWhere = and(sourceCurrent, isNull(crmTasks.dueAt));
  const queueOverdue = and(queueCurrent, lt(crmTasks.dueAt, input.now));
  const queueToday = and(
    queueCurrent,
    gte(crmTasks.dueAt, input.now),
    lt(crmTasks.dueAt, bounds.endExclusive)
  );
  const queueUnscheduledWhere = and(queueCurrent, isNull(crmTasks.dueAt));
  const total = async (where: ReturnType<typeof and>) => {
    const [r] = await db.select({ total: count() }).from(crmTasks).where(where);
    return Number(r.total);
  };
  const rank = input.priorityTitles.length
    ? sql`case ${sql.join(
        input.priorityTitles.map(
          (title, i) =>
            sql`when lower(trim(${crmTasks.title}))=${title.trim().toLowerCase()} then ${i}`
        ),
        sql` `
      )} else ${input.priorityTitles.length} end`
    : undefined;
  const priorityOrder = rank ? [rank] : [];
  const [
    overdueCount,
    dueTodayCount,
    incompleteCount,
    historicalBacklog,
    unknownCount,
    futureScheduledCount,
    unscheduledCount,
    overdueTasks,
    dueToday,
    unscheduled,
  ] = await Promise.all([
    total(overdue),
    total(today),
    total(sourceIncomplete),
    cutoff
      ? total(and(sourceIncomplete, lt(crmTasks.dueAt, cutoff)))
      : Promise.resolve(0),
    total(and(owned, eq(crmTasks.status, "unknown"))),
    total(futureScheduled),
    total(unscheduledWhere),
    db
      .select()
      .from(crmTasks)
      .where(queueOverdue)
      .orderBy(...priorityOrder, asc(crmTasks.dueAt), asc(crmTasks.id)),
    db
      .select()
      .from(crmTasks)
      .where(queueToday)
      .orderBy(...priorityOrder, asc(crmTasks.dueAt), asc(crmTasks.id)),
    db
      .select()
      .from(crmTasks)
      .where(queueUnscheduledWhere)
      .orderBy(...priorityOrder, asc(crmTasks.id))
      .limit(20),
  ]);
  return {
    bounds,
    timezone: input.timezone,
    metrics: {
      overdue: overdueCount,
      dueToday: dueTodayCount,
      incomplete: incompleteCount,
      historicalBacklog,
      unknown: unknownCount,
      futureScheduled: futureScheduledCount,
      unscheduled: unscheduledCount,
    },
    queues: { overdueTasks, dueToday, unscheduled },
    queueLimit: null,
    backlogPolicy: input.backlogPolicy || { mode: "all_incomplete" },
    overdueDefinition: "before_current_time" as const,
  };
}
