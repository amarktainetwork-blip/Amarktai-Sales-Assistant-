import {
  and,
  asc,
  count,
  eq,
  gte,
  inArray,
  isNull,
  lt,
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
  const incomplete = and(
    owned,
    inArray(crmTasks.status, [...INCOMPLETE_TASK_STATUSES])
  );
  const cutoff =
    input.backlogPolicy?.mode === "since" && input.backlogPolicy.actionableSince
      ? new Date(input.backlogPolicy.actionableSince)
      : null;
  if (cutoff && !Number.isFinite(cutoff.getTime()))
    throw Error("INVALID_BACKLOG_POLICY");
  const current = and(
    incomplete,
    cutoff ? or(isNull(crmTasks.dueAt), gte(crmTasks.dueAt, cutoff)) : undefined
  );
  const overdue = and(current, lt(crmTasks.dueAt, bounds.start));
  const today = and(
    current,
    gte(crmTasks.dueAt, bounds.start),
    lt(crmTasks.dueAt, bounds.endExclusive)
  );
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
    : sql`0`;
  const [
    overdueCount,
    dueTodayCount,
    incompleteCount,
    historicalBacklog,
    unknownCount,
    overdueTasks,
    dueToday,
    unscheduled,
  ] = await Promise.all([
    total(overdue),
    total(today),
    total(incomplete),
    cutoff
      ? total(and(incomplete, lt(crmTasks.dueAt, cutoff)))
      : Promise.resolve(0),
    total(and(owned, eq(crmTasks.status, "unknown"))),
    db
      .select()
      .from(crmTasks)
      .where(overdue)
      .orderBy(rank, asc(crmTasks.dueAt), asc(crmTasks.id))
      .limit(50),
    db
      .select()
      .from(crmTasks)
      .where(today)
      .orderBy(rank, asc(crmTasks.dueAt), asc(crmTasks.id))
      .limit(50),
    db
      .select()
      .from(crmTasks)
      .where(and(current, isNull(crmTasks.dueAt)))
      .orderBy(rank, asc(crmTasks.id))
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
    },
    queues: { overdueTasks, dueToday, unscheduled },
    queueLimit: 50,
    backlogPolicy: input.backlogPolicy || { mode: "all_incomplete" },
    overdueDefinition: "before_local_day_start" as const,
  };
}
