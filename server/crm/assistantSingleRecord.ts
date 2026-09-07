import { createHash } from "node:crypto";
import type { LiveCallCrmContext } from "../liveCalls/context";
import type { ProposedAction } from "../workflowRules";

function key(context: LiveCallCrmContext, instruction: string) {
  return `assistant-single:${createHash("sha256")
    .update(
      `${context.connectedSystemId}\0${context.contactExternalId}\0${instruction.trim().toLowerCase()}`
    )
    .digest("hex")
    .slice(0, 32)}`;
}

function tomorrowAt(instruction: string, now: Date, timezone: string) {
  const match =
    instruction.match(
      /\btomorrow\b.*?\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i
    ) ||
    instruction.match(
      /\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+tomorrow\b/i
    );
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (match[3]?.toLowerCase() === "pm" && hour < 12) hour += 12;
  if (match[3]?.toLowerCase() === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return undefined;
  const options: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  };
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", options);
  } catch {
    formatter = new Intl.DateTimeFormat("en-CA", {
      ...options,
      timeZone: "UTC",
    });
  }
  const numericParts = (value: Date) =>
    Object.fromEntries(
      formatter
        .formatToParts(value)
        .filter(part => part.type !== "literal")
        .map(part => [part.type, Number(part.value)])
    );
  const current = numericParts(now);
  const nextDay = new Date(
    Date.UTC(current.year, current.month - 1, current.day + 1)
  );
  const approximate = new Date(
    Date.UTC(
      nextDay.getUTCFullYear(),
      nextDay.getUTCMonth(),
      nextDay.getUTCDate(),
      hour,
      minute
    )
  );
  const zoned = numericParts(approximate);
  const offset =
    Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second
    ) - approximate.valueOf();
  return new Date(approximate.valueOf() - offset).toISOString();
}

/** Exact, selected-record intents that need no semantic model inference. */
export function planAssistantSingleRecordAction(input: {
  instruction: string;
  context: LiveCallCrmContext;
  now?: Date;
  timezone?: string;
}): ProposedAction | undefined {
  const instruction = input.instruction.trim();
  const common = {
    targetLabel: input.context.contactName,
    idempotencyKey: key(input.context, instruction),
  };
  const note = instruction
    .match(/^add (?:this )?(?:exact )?note\s*:\s*([\s\S]{1,10000})$/i)?.[1]
    ?.trim();
  if (note)
    return {
      ...common,
      actionType: "append_contact_note",
      title: `Add note for ${input.context.contactName}`,
      payload: {
        reviewRequired: true,
        connectedSystemId: input.context.connectedSystemId,
        contactExternalId: input.context.contactExternalId,
        content: note,
      },
    };
  if (/\bcreate (?:a )?callback\b/i.test(instruction)) {
    const dueAt = tomorrowAt(
      instruction,
      input.now || new Date(),
      input.timezone || "UTC"
    );
    if (!dueAt) return undefined;
    return {
      ...common,
      actionType: "schedule_callback",
      title: `Create callback for ${input.context.contactName}`,
      payload: {
        reviewRequired: true,
        connectedSystemId: input.context.connectedSystemId,
        contactExternalId: input.context.contactExternalId,
        opportunityExternalId: input.context.opportunityExternalId,
        taskTitle: `Callback: ${input.context.contactName}`,
        dueAt,
      },
    };
  }
  const stage = instruction
    .match(
      /^move (?:this|the current) (?:deal|opportunity) to\s+(.+?)\s*[.!]?$/i
    )?.[1]
    ?.trim();
  if (stage && input.context.opportunityExternalId)
    return {
      ...common,
      actionType: "update_current_opportunity",
      title: `Move ${input.context.opportunityName || "current opportunity"} to ${stage}`,
      payload: {
        reviewRequired: true,
        connectedSystemId: input.context.connectedSystemId,
        contactExternalId: input.context.contactExternalId,
        opportunityExternalId: input.context.opportunityExternalId,
        fields: { stage },
      },
    };
  return undefined;
}
