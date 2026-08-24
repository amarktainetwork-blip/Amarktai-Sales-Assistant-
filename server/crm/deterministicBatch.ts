import { createHash } from "node:crypto";

export type BatchPage<RecordType> = {
  records: RecordType[];
  nextCursor?: string;
};

export type BatchRecordResult = {
  recordId: string;
  status: "completed" | "skipped" | "failed";
  attempts: number;
  detail?: string;
};

export type DeterministicBatchProgress = {
  jobId: string;
  discovered: number;
  completed: number;
  skipped: number;
  failed: number;
  cursor?: string;
  cancelled: boolean;
};

/**
 * Assistant execution boundary:
 * interpret intent once, page deterministically, execute with bounded
 * concurrency/idempotency, verify each record, and report one job result.
 * AI is deliberately absent from the per-record loop.
 */
export async function runDeterministicCrmBatch<RecordType, Plan>(input: {
  jobId: string;
  instruction: string;
  interpretInstruction: (instruction: string) => Promise<Plan>;
  fetchPage: (plan: Plan, cursor: string | undefined, pageSize: number) => Promise<BatchPage<RecordType>>;
  recordId: (record: RecordType) => string;
  qualify?: (record: RecordType, plan: Plan) => Promise<boolean> | boolean;
  execute: (record: RecordType, plan: Plan, idempotencyKey: string) => Promise<unknown>;
  verify: (record: RecordType, plan: Plan) => Promise<boolean>;
  alreadyCompleted?: (idempotencyKey: string) => Promise<boolean>;
  markCompleted?: (idempotencyKey: string) => Promise<void>;
  isCancelled?: () => Promise<boolean>;
  onProgress?: (progress: DeterministicBatchProgress) => Promise<void> | void;
  pageSize?: number;
  concurrency?: number;
  maxRetries?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  retryDelayMs?: (attempt: number, error: unknown) => number;
}) {
  const plan = await input.interpretInstruction(input.instruction);
  const pageSize = Math.min(500, Math.max(1, input.pageSize ?? 100));
  const concurrency = Math.min(20, Math.max(1, input.concurrency ?? 5));
  const maxRetries = Math.min(5, Math.max(0, input.maxRetries ?? 2));
  const progress: DeterministicBatchProgress = {
    jobId: input.jobId,
    discovered: 0,
    completed: 0,
    skipped: 0,
    failed: 0,
    cancelled: false,
  };
  const results: BatchRecordResult[] = [];
  let cursor: string | undefined;
  const idempotencyKey = (recordId: string) =>
    createHash("sha256")
      .update(`${input.jobId}:${recordId}`)
      .digest("hex");

  do {
    if (await input.isCancelled?.()) {
      progress.cancelled = true;
      break;
    }
    const page = await input.fetchPage(plan, cursor, pageSize);
    progress.discovered += page.records.length;
    for (let offset = 0; offset < page.records.length; offset += concurrency) {
      if (await input.isCancelled?.()) {
        progress.cancelled = true;
        break;
      }
      const chunk = page.records.slice(offset, offset + concurrency);
      const chunkResults = await Promise.all(
        chunk.map(async record => {
          const recordId = input.recordId(record);
          const key = idempotencyKey(recordId);
          if (input.qualify) {
            try {
              if (!(await input.qualify(record, plan)))
                return { recordId, status: "skipped" as const, attempts: 0 };
            } catch (error) {
              return {
                recordId,
                status: "failed" as const,
                attempts: 0,
                detail: (error instanceof Error ? error.message : String(error)).slice(0, 500),
              };
            }
          }
          if (await input.alreadyCompleted?.(key))
            return { recordId, status: "skipped" as const, attempts: 0 };
          let lastError = "";
          for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
            try {
              await input.execute(record, plan, key);
              if (!(await input.verify(record, plan)))
                throw new Error("Deterministic CRM readback did not confirm the update.");
              await input.markCompleted?.(key);
              return { recordId, status: "completed" as const, attempts: attempt };
            } catch (error) {
              lastError = error instanceof Error ? error.message : String(error);
              if (
                attempt > maxRetries ||
                (input.shouldRetry && !input.shouldRetry(error, attempt))
              ) break;
              const retryDelay = Math.min(
                10_000,
                Math.max(0, input.retryDelayMs?.(attempt, error) || 0)
              );
              if (retryDelay)
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
          }
          return {
            recordId,
            status: "failed" as const,
            attempts: maxRetries + 1,
            detail: lastError.slice(0, 500),
          };
        })
      );
      results.push(...chunkResults);
      for (const result of chunkResults) progress[result.status] += 1;
      progress.cursor = page.nextCursor;
      await input.onProgress?.({ ...progress });
    }
    if (progress.cancelled) break;
    cursor = page.nextCursor;
  } while (cursor);

  return {
    plan,
    progress,
    results,
    partialFailure: progress.failed > 0,
  };
}
