# AI SDR Agent Tools

## Now

- `list_campaigns`: Instantly campaign names, IDs, and statuses.
- `get_campaign_performance`: sends, opens, replies, bounces, opportunities, reply/open rates.
- `list_recent_replies`: recent inbound replies with sender, time, subject, and preview.
- `count_leads`: total leads loaded in a campaign.
- `list_leads`: sample lead emails, names, and companies.
- `list_inboxes`: connected sender inboxes and status.
- `get_inbox_health`: warmup volume and inbox landing rate.
- `draft_reply`: classify pasted prospect text and draft a response.
- `set_agent_paused`: pause/resume the app's internal polling/classify/draft loops.

## Reply Ops

- `list_pending_drafts`: drafts waiting for human approval.
- `get_draft`: one draft, classification, prospect context, and original reply.
- `edit_draft`: update draft subject/body before approval.
- `approve_draft`: mark draft approved by a human.
- `reject_draft`: mark draft rejected with optional reason.
- `send_approved_reply`: send an approved draft through Instantly.
- `list_hot_replies`: high-priority replies needing action.
- `mark_reply_handled`: close a reply without sending.
- `suppress_lead`: add email/domain to Instantly block list.
- `update_lead_interest_status`: mark lead interested/not interested/etc. in Instantly.
- `schedule_not_now_followup`: create a future reminder/nurture action.

## Campaign Control

- `pause_campaign`: pause Instantly campaign after confirmation.
- `resume_campaign`: resume Instantly campaign after confirmation.
- `get_campaign_settings`: schedule, daily limits, inboxes, sequence settings.
- `update_daily_limit`: change sending volume after approval.
- `list_sequences`: show campaign email steps and variants.
- `propose_sequence_change`: suggest sequence edits without applying them.
- `propose_copy_variant`: draft new A/B subject/body variant.
- `activate_copy_variant`: enable approved copy variant.

## Lead Scoring / Acquisition

- `import_leads_from_csv`: ingest uploaded/manual lead lists.
- `search_apollo_leads`: pull leads from Apollo search criteria.
- `score_lead`: evaluate one lead's fit.
- `score_lead_batch`: score many leads and rank them.
- `list_scored_leads`: review scored leads by tier/status.
- `approve_leads_for_instantly`: human approves selected leads.
- `add_leads_to_campaign`: push approved leads into Instantly.
- `reject_leads`: exclude weak/irrelevant leads.
- `explain_lead_score`: show why a lead received a score.

## CRM / Instantly State

- `get_lead`: fetch one lead's Instantly CRM profile.
- `update_lead_status`: change lead status/label.
- `add_lead_note`: attach internal note to lead if supported.
- `list_lead_activity`: show sends, opens, replies, status changes.
- `find_company_or_lead`: search Instantly/Postgres for a person/company.
- `get_conversation_thread`: retrieve the email thread context.

## Metrics / Analytics

- `get_daily_metrics`: daily sends, replies, bounces, positives.
- `get_weekly_metrics`: weekly trend summary.
- `analyze_campaign_performance`: explain what is/isn't working.
- `analyze_segment_performance`: compare industries, roles, company types.
- `analyze_copy_performance`: compare email variants/subjects.
- `compare_inboxes`: performance by sender inbox.
- `get_reply_rate_by_step`: replies by sequence step.
- `get_positive_reply_rate`: interested replies as percentage of sends/replies.
- `get_bounce_rate`: bounce percentage and risky campaigns/inboxes.
- `get_unsubscribe_rate`: opt-out percentage and trends.

## Deliverability

- `check_warmup_health`: warmup stats by inbox.
- `check_inbox_health`: sender status, setup, warmup score.
- `check_domain_health`: domain-level deliverability signals if available.
- `list_bounce_events`: recent bounced leads/emails.
- `recommend_deliverability_action`: suggest pause/hold/ramp fixes.
- `recommend_volume_ramp`: propose safe sending-volume increases.

## Learning

- `list_lessons`: show active learned rules/preferences.
- `remember_lesson`: store approved preference or process lesson.
- `forget_lesson`: deactivate a lesson.
- `propose_lesson_from_edits`: infer lesson from repeated human edits.
- `list_objection_examples`: past objections and successful responses.
- `save_objection_response`: store approved objection handling example.
- `retrieve_objection_examples`: pull examples into future drafting prompts.

## Ops / Safety

- `get_agent_status`: paused state, model config, health summary.
- `get_queue_health`: queued/running/failed jobs and oldest job age.
- `list_failed_jobs`: permanent or repeated job failures.
- `retry_failed_job`: rerun a failed job after review.
- `set_autonomy_level`: change what agent can do automatically.
- `get_autonomy_level`: show current autonomy settings.
- `set_spend_limit`: configure daily Claude/tool budget.
- `get_spend_usage`: current spend/call usage against budget.
