export type ReplyIntent =
  | "positive"
  | "question"
  | "objection"
  | "not_now"
  | "negative"
  | "unsubscribe"
  | "out_of_office"
  | "unclear";

export type LeadTier = 1 | 2 | 3 | 4 | 5;

export interface InstantlyEvent {
  provider: "instantly";
  providerEventId: string;
  eventType: string;
  email?: string;
  companyName?: string;
  campaignId?: string;
  leadId?: string;
  subject?: string;
  threadText?: string;
  raw: unknown;
}

/**
 * Auto-responder detail, populated only when intent is "out_of_office".
 * returnDate is the first date the prospect is back, as YYYY-MM-DD. It is
 * absent whenever the message gives no usable date — we schedule nothing then
 * and let the campaign's own follow-up steps reach them.
 */
export interface OutOfOfficeDetail {
  returnDate?: string;
  /** Named alternate contact the autoresponder points at, if any. */
  alternateContact?: string;
  /**
   * Model's own read of how firm the date is: an explicit date beats "next week".
   * Optional because a dateless autoresponder routinely comes back without it.
   */
  dateConfidence?: number;
}

export interface ReplyClassification {
  intent: ReplyIntent;
  confidence: number;
  reason: string;
  suggestedNextAction: string;
  outOfOffice?: OutOfOfficeDetail;
}

export interface DraftedReply {
  subject?: string;
  body: string;
  internalReason: string;
}

export interface LeadScore {
  score: number;
  tier: LeadTier;
  reason: string;
  recommendedCampaign?: string;
}
