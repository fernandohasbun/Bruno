import { pool } from "../db/pool.js";

export type JobName =
  | "instantly.event.received"
  | "reply.poll"
  | "reply.classify"
  | "reply.retarget"
  | "lead.score"
  | "metrics.rollup"
  | "watchdog.check"
  | "daily.digest"
  | "weekly.analytics"
  | "learning.review"
  | "crm.leads.sync"
  | "crm.messages.sync"
  | "crm.reconcile"
  | "outbound.agent.reply";

export interface QueueJob<T = unknown> {
  id: string;
  name: JobName;
  payload: T;
  attempts: number;
  maxAttempts: number;
}

export async function enqueueJob(name: JobName, payload: unknown, options?: { runAfter?: Date; maxAttempts?: number }) {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO jobs (name, payload, run_after, max_attempts)
      VALUES ($1, $2::jsonb, $3, $4)
      RETURNING id
    `,
    [name, JSON.stringify(payload), options?.runAfter ?? new Date(), options?.maxAttempts ?? 5]
  );

  return result.rows[0].id;
}

/** Enqueue a singleton maintenance job only when the same job is not already queued or running. */
export async function enqueueJobIfIdle(
  name: JobName,
  payload: unknown,
  options?: { runAfter?: Date; maxAttempts?: number }
) {
  const result = await pool.query<{ id: string }>(
    `
      WITH locked AS (
        SELECT pg_advisory_xact_lock(hashtext('bruno:queue:' || $1::text))
      )
      INSERT INTO jobs (name, payload, run_after, max_attempts)
      SELECT $1, $2::jsonb, $3, $4
      FROM locked
      WHERE NOT EXISTS (
        SELECT 1 FROM jobs
        WHERE name = $1 AND status IN ('queued', 'running')
      )
      RETURNING id
    `,
    [name, JSON.stringify(payload), options?.runAfter ?? new Date(), options?.maxAttempts ?? 5]
  );
  return result.rows[0]?.id;
}

export async function claimNextJob(): Promise<QueueJob | null> {
  const result = await pool.query<{
    id: string;
    name: JobName;
    payload: unknown;
    attempts: number;
    max_attempts: number;
  }>(
    `
      UPDATE jobs
      SET status = 'running',
          locked_at = now(),
          attempts = attempts + 1,
          updated_at = now()
      WHERE id = (
        SELECT id
        FROM jobs
        WHERE (
            (status IN ('queued', 'failed') AND run_after <= now() AND attempts < max_attempts)
            OR (status = 'running' AND locked_at < now() - interval '10 minutes' AND attempts <= max_attempts)
          )
        ORDER BY run_after ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, name, payload, attempts, max_attempts
    `
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.max_attempts
  };
}

export async function completeJob(jobId: string) {
  await pool.query(
    `
      UPDATE jobs
      SET status = 'completed',
          completed_at = now(),
          updated_at = now()
      WHERE id = $1
    `,
    [jobId]
  );
}

export async function failJob(job: QueueJob, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const shouldRetry = job.attempts < job.maxAttempts;
  const backoffSeconds = Math.min(60 * job.attempts * job.attempts, 900);

  await pool.query(
    `
      UPDATE jobs
      SET status = $2,
          last_error = $3,
          run_after = CASE WHEN $2 = 'queued' THEN now() + ($4::text || ' seconds')::interval ELSE run_after END,
          updated_at = now()
      WHERE id = $1
    `,
    [job.id, shouldRetry ? "queued" : "failed", message, backoffSeconds]
  );

  return { willRetry: shouldRetry };
}
