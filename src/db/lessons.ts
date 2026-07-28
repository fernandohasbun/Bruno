import { pool } from "./pool.js";

export type LessonKind = "preference" | "copy" | "objection" | "targeting" | "process";
export type LessonStatus = "proposed" | "active" | "rejected" | "retired";

export interface AgentLessonRow {
  id: string;
  kind: LessonKind;
  lesson: string;
  evidence: unknown;
  confidence: number;
  status: LessonStatus;
  source_approval_ids: string[];
  proposed_by: string;
  approved_by: string | null;
  activated_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function listLessons(input: { status?: LessonStatus; limit?: number } = {}) {
  const result = await pool.query<AgentLessonRow>(
    `
      SELECT id, kind, lesson, evidence, confidence::float AS confidence,
             status, source_approval_ids, proposed_by, approved_by,
             activated_at::text, created_at::text, updated_at::text
      FROM agent_lessons
      WHERE ($1::text IS NULL OR status = $1)
      ORDER BY
        CASE status WHEN 'proposed' THEN 0 WHEN 'active' THEN 1 WHEN 'retired' THEN 2 ELSE 3 END,
        created_at DESC
      LIMIT $2
    `,
    [input.status ?? null, Math.min(200, Math.max(1, input.limit ?? 100))]
  );
  return result.rows;
}

export async function listActiveLessons() {
  return listLessons({ status: "active", limit: 100 });
}

export async function createLesson(input: {
  kind: LessonKind;
  lesson: string;
  evidence?: unknown;
  confidence?: number;
  status?: LessonStatus;
  sourceApprovalIds?: string[];
  proposedBy?: string;
  approvedBy?: string;
}) {
  const normalized = input.lesson.trim();
  if (!normalized) throw new Error("Lesson text is required");
  const existing = await pool.query<AgentLessonRow>(
    `
      SELECT id, kind, lesson, evidence, confidence::float AS confidence,
             status, source_approval_ids, proposed_by, approved_by,
             activated_at::text, created_at::text, updated_at::text
      FROM agent_lessons
      WHERE lower(lesson) = lower($1) AND status IN ('proposed', 'active')
      LIMIT 1
    `,
    [normalized]
  );
  if (existing.rows[0]) return { lesson: existing.rows[0], created: false };

  const status = input.status ?? "proposed";
  const result = await pool.query<AgentLessonRow>(
    `
      INSERT INTO agent_lessons (
        kind, lesson, evidence, confidence, status, source_approval_ids,
        proposed_by, approved_by, activated_at
      )
      VALUES (
        $1, $2, $3::jsonb, $4, $5, $6::uuid[], $7, $8,
        CASE WHEN $5 = 'active' THEN now() ELSE NULL END
      )
      RETURNING id, kind, lesson, evidence, confidence::float AS confidence,
                status, source_approval_ids, proposed_by, approved_by,
                activated_at::text, created_at::text, updated_at::text
    `,
    [
      input.kind,
      normalized,
      JSON.stringify(input.evidence ?? []),
      Math.min(1, Math.max(0, input.confidence ?? 0.5)),
      status,
      input.sourceApprovalIds ?? [],
      input.proposedBy ?? "bruno",
      input.approvedBy ?? null
    ]
  );
  return { lesson: result.rows[0], created: true };
}

export async function setLessonStatus(input: {
  id: string;
  status: LessonStatus;
  actor?: string;
}) {
  const result = await pool.query<AgentLessonRow>(
    `
      UPDATE agent_lessons
      SET status = $2,
          approved_by = CASE WHEN $2 = 'active' THEN $3 ELSE approved_by END,
          activated_at = CASE WHEN $2 = 'active' THEN now() ELSE activated_at END,
          updated_at = now()
      WHERE id = $1
      RETURNING id, kind, lesson, evidence, confidence::float AS confidence,
                status, source_approval_ids, proposed_by, approved_by,
                activated_at::text, created_at::text, updated_at::text
    `,
    [input.id, input.status, input.actor ?? "dashboard"]
  );
  if (!result.rows[0]) throw new Error("Lesson not found");
  return result.rows[0];
}

export interface EditDiffSignal {
  approval_id: string;
  intent: string;
  email: string | null;
  company_name: string | null;
  original_subject: string | null;
  original_body: string;
  final_subject: string | null;
  final_body: string | null;
  created_at: string;
}

export async function listEditDiffSignals(days = 90, limit = 100) {
  const result = await pool.query<EditDiffSignal>(
    `
      SELECT
        a.id AS approval_id,
        rc.intent,
        rc.email,
        rc.company_name,
        d.subject AS original_subject,
        d.body AS original_body,
        a.final_subject,
        a.final_body,
        a.created_at::text
      FROM approvals a
      JOIN drafts d ON d.id = a.draft_id
      JOIN reply_classifications rc ON rc.id = d.reply_classification_id
      WHERE a.action = 'edited'
        AND a.final_body IS NOT NULL
        AND a.created_at >= now() - ($1::text || ' days')::interval
      ORDER BY a.created_at DESC
      LIMIT $2
    `,
    [days, Math.min(250, Math.max(1, limit))]
  );
  return result.rows;
}

export interface ObjectionExample {
  objection: string;
  response: string;
  company_name: string | null;
  created_at: string;
}

export async function listObjectionExamples(limit = 5) {
  const result = await pool.query<ObjectionExample>(
    `
      SELECT
        rc.raw_thread AS objection,
        coalesce(a.final_body, d.body) AS response,
        rc.company_name,
        a.created_at::text
      FROM reply_classifications rc
      JOIN drafts d ON d.reply_classification_id = rc.id
      JOIN approvals a ON a.draft_id = d.id
      WHERE rc.intent = 'objection'
        AND a.action IN ('approved', 'edited')
        AND rc.raw_thread IS NOT NULL
      ORDER BY a.created_at DESC
      LIMIT $1
    `,
    [Math.min(20, Math.max(1, limit))]
  );
  return result.rows;
}

