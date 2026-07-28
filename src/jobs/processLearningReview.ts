import { proposeLessonsFromEdits } from "../agents/learningAgent.js";
import { createLesson, listEditDiffSignals } from "../db/lessons.js";
import { notifyAnalytics } from "../integrations/notify.js";
import type { QueueJob } from "../queue/queue.js";

export async function processLearningReviewJob(_job: QueueJob) {
  const signals = await listEditDiffSignals(90, 100);
  if (signals.length < 2) return;

  const proposals = await proposeLessonsFromEdits(signals);
  const created = [];
  for (const proposal of proposals) {
    const result = await createLesson({
      kind: proposal.kind,
      lesson: proposal.lesson,
      confidence: proposal.confidence,
      evidence: proposal.evidenceApprovalIds.map((approvalId) => ({ approval_id: approvalId })),
      sourceApprovalIds: proposal.evidenceApprovalIds,
      proposedBy: "weekly-learning-review"
    });
    if (result.created) created.push(result.lesson);
  }

  if (created.length > 0) {
    await notifyAnalytics(
      `Bruno proposed ${created.length} learned rule${created.length === 1 ? "" : "s"} from repeated owner edits. Review them in Learning before they affect future drafts.`
    );
  }
}

