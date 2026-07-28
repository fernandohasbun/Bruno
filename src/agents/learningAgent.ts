import { z } from "zod";
import { callClaudeJson, hasClaudeKey } from "../integrations/claude.js";
import type { EditDiffSignal, LessonKind } from "../db/lessons.js";

const lessonProposalSchema = z.object({
  proposals: z.array(
    z.object({
      kind: z.enum(["preference", "copy", "objection", "targeting", "process"]),
      lesson: z.string(),
      confidence: z.number().min(0).max(1),
      evidence_approval_ids: z.array(z.string())
    })
  ).max(5)
});

export interface LessonProposal {
  kind: LessonKind;
  lesson: string;
  confidence: number;
  evidenceApprovalIds: string[];
}

const SYSTEM_PROMPT = `
You review how a sales owner edited Bruno's proposed replies.
Find repeated, generalizable preferences that should improve future drafts.

Rules:
- Propose a lesson only when at least two edits support the same pattern.
- Lessons must be short, imperative, and applicable to future messages.
- Do not infer business facts that are absent from the edits.
- Do not use lead names, companies, or email addresses in a lesson.
- Do not propose conflicting lessons.
- Every proposal must cite the approval ids that support it.
- Return no proposals when the evidence is too sparse or inconsistent.
- These are proposals only; a human must approve them before they affect a prompt.
- Return JSON only.
`;

export async function proposeLessonsFromEdits(signals: EditDiffSignal[]): Promise<LessonProposal[]> {
  if (!hasClaudeKey() || signals.length < 2) return [];

  const compact = signals.map((signal) => ({
    approval_id: signal.approval_id,
    intent: signal.intent,
    original_subject: signal.original_subject,
    original_body: signal.original_body,
    final_subject: signal.final_subject,
    final_body: signal.final_body
  }));
  const result = await callClaudeJson({
    model: "strong",
    system: SYSTEM_PROMPT,
    user: JSON.stringify({ edits: compact }, null, 2),
    schema: lessonProposalSchema,
    maxTokens: 1800
  });

  const knownIds = new Set(signals.map((signal) => signal.approval_id));
  return result.proposals.flatMap((proposal) => {
    const evidenceApprovalIds = proposal.evidence_approval_ids.filter((id) => knownIds.has(id));
    if (evidenceApprovalIds.length < 2) return [];
    return [{
      kind: proposal.kind,
      lesson: proposal.lesson.trim(),
      confidence: proposal.confidence,
      evidenceApprovalIds
    }];
  });
}

