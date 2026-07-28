#!/usr/bin/env python3
"""Upsert the safe, broader-fit lead cohort into paused Instantly campaigns.

The strict launch cohort follows every persona filter. This recovery cohort
keeps verified leads that missed only targeting preferences (title, geography,
employee count, or industry). It continues to exclude Apollo-disqualified,
catch-all, and duplicate-company rows.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
REJECTED_PATH = ROOT / "new-campaign" / "instantly-imports" / "rejected-for-review.csv"
MANIFEST_PATH = ROOT / "new-campaign" / "instantly-imports" / "manifest.json"
INSTANTLY_BASE_URL = "https://api.instantly.ai"
EXPECTED_RECOVERY_COUNT = 894
EXPECTED_CATCH_ALL_COUNT = 543
EXPECTED_REMAINING_COUNT = 32

ALLOWED_RECOVERY_REASONS = {
    "title_not_included",
    "geography_mismatch",
    "employee_count_mismatch",
    "industry_mismatch",
}

PERSONAS = {
    "EA": {
        "key": "ea",
        "campaign_name": "Kinta | P1 EA | B1 | 2026-07",
        "persona": "EA",
        "target_role": "Executive Assistant",
        "work_item": "inbox and calendar",
    },
    "Legal": {
        "key": "legal",
        "campaign_name": "Kinta | P2 Legal | B1 | 2026-07",
        "persona": "Legal",
        "target_role": "Paralegal",
        "work_item": "case files",
    },
    "Developer": {
        "key": "developer",
        "campaign_name": "Kinta | P3 Developer | B1 | 2026-07",
        "persona": "Developer",
        "target_role": "Software Developer",
        "work_item": "repo",
    },
    "AEC": {
        "key": "aec",
        "campaign_name": "Kinta | P4 AEC | B1 | 2026-07",
        "persona": "AEC",
        "target_role": "BIM Modeler",
        "work_item": "project files",
    },
    "Marketing": {
        "key": "social",
        "campaign_name": "Kinta | P5 Social | B1 | 2026-07",
        "persona": "Marketing",
        "target_role": "Social Media Manager",
        "work_item": "content calendar",
    },
}


def normalized(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).casefold()


def company_key(company_name: str, email: str) -> str:
    return normalized(company_name) or normalized(email).partition("@")[2]


def api_request(api_key: str, method: str, path: str, body: Any | None = None) -> Any:
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        f"{INSTANTLY_BASE_URL}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "curl/8.7.1",
            **({"Content-Type": "application/json"} if data is not None else {}),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Instantly API failed: {error.code} {detail}") from error


def list_campaign_emails(api_key: str, campaign_id: str) -> set[str]:
    emails: set[str] = set()
    cursor: str | None = None
    while True:
        body: dict[str, Any] = {"campaign": campaign_id, "limit": 100}
        if cursor:
            body["starting_after"] = cursor
        response = api_request(api_key, "POST", "/api/v2/leads/list", body)
        for lead in response.get("items", []):
            email = normalized(lead.get("email"))
            if email:
                emails.add(email)
        cursor = response.get("next_starting_after")
        if not cursor:
            return emails


def approved_keys() -> tuple[set[str], dict[str, set[str]]]:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    emails: set[str] = set()
    companies = {config["key"]: set() for config in PERSONAS.values()}
    for persona in manifest["personas"]:
        for lead in persona["leads"]:
            email = normalized(lead["email"])
            emails.add(email)
            companies[persona["key"]].add(company_key(lead.get("company_name", ""), email))
    return emails, companies


def recovery_cohort(
    catch_all_only: bool = False,
    remaining_only: bool = False,
) -> tuple[dict[str, list[dict[str, Any]]], Counter[str]]:
    approved_emails, seen_companies = approved_keys()
    seen_emails = set(approved_emails)
    selected = {config["key"]: [] for config in PERSONAS.values()}
    exclusions: Counter[str] = Counter()

    with REJECTED_PATH.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            reasons = {reason for reason in row["Reasons"].split(";") if reason}
            allowed_reasons = (
                ALLOWED_RECOVERY_REASONS | {"catch_all"}
                if catch_all_only
                else ALLOWED_RECOVERY_REASONS
            )
            if remaining_only:
                matches_cohort = bool({"apollo_disqualified", "duplicate_company"} & reasons)
            elif catch_all_only:
                matches_cohort = "catch_all" in reasons
            else:
                matches_cohort = bool(reasons)
            if not matches_cohort:
                continue
            if not remaining_only and not reasons.issubset(allowed_reasons):
                for reason in reasons - allowed_reasons:
                    exclusions[reason] += 1
                continue

            config = PERSONAS[row["Persona"]]
            email = normalized(row["Email"])
            key = company_key(row["Company Name"], email)
            if email in seen_emails:
                exclusions["cross_cohort_duplicate_email"] += 1
                continue
            if not catch_all_only and not remaining_only and key in seen_companies[config["key"]]:
                exclusions["cross_cohort_duplicate_company"] += 1
                continue

            seen_emails.add(email)
            seen_companies[config["key"]].add(key)
            selected[config["key"]].append(
                {
                    "email": row["Email"].strip(),
                    "first_name": row["First Name"].strip(),
                    "last_name": row["Last Name"].strip(),
                    "company_name": row["Company Name"].strip(),
                    "job_title": row["Title"].strip(),
                    "custom_variables": {
                        "persona": config["persona"],
                        "targetRole": config["target_role"],
                        "workItem": config["work_item"],
                        "batch": "2026-07-21-recovery",
                    },
                }
            )

    total = sum(len(leads) for leads in selected.values())
    if remaining_only:
        expected = EXPECTED_REMAINING_COUNT
    elif catch_all_only:
        expected = EXPECTED_CATCH_ALL_COUNT
    else:
        expected = EXPECTED_RECOVERY_COUNT
    if total != expected:
        raise RuntimeError(
            f"Recovery safety check failed: expected {expected} leads, found {total}"
        )
    return selected, exclusions


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    cohort_group = parser.add_mutually_exclusive_group()
    cohort_group.add_argument("--catch-all-only", action="store_true")
    cohort_group.add_argument("--remaining-only", action="store_true")
    options = parser.parse_args()

    api_key = os.environ.get("INSTANTLY_API_KEY")
    if not api_key:
        raise RuntimeError("INSTANTLY_API_KEY is not configured")

    selected, exclusions = recovery_cohort(
        catch_all_only=options.catch_all_only,
        remaining_only=options.remaining_only,
    )
    query = urllib.parse.urlencode({"limit": 100, "search": "Kinta"})
    campaigns_response = api_request(api_key, "GET", f"/api/v2/campaigns?{query}")
    campaigns = campaigns_response.get("items", [])
    campaign_by_name = {campaign["name"]: campaign for campaign in campaigns}
    results: list[dict[str, Any]] = []

    for source_persona, config in PERSONAS.items():
        campaign = campaign_by_name.get(config["campaign_name"])
        if not campaign:
            raise RuntimeError(f"Campaign not found: {config['campaign_name']}")
        if campaign.get("status") != 2:
            raise RuntimeError(
                f"Refusing to import into non-paused campaign {config['campaign_name']}: "
                f"status={campaign.get('status')}"
            )

        existing_before = list_campaign_emails(api_key, campaign["id"])
        missing = [
            lead for lead in selected[config["key"]] if normalized(lead["email"]) not in existing_before
        ]
        result: dict[str, Any] = {
            "key": config["key"],
            "campaign_id": campaign["id"],
            "campaign_status": campaign["status"],
            "recovery_cohort": len(selected[config["key"]]),
            "campaign_leads_before": len(existing_before),
            "missing_before_upsert": len(missing),
        }

        if options.apply and missing:
            result["upsert"] = api_request(
                api_key,
                "POST",
                "/api/v2/leads/add",
                {
                    "campaign_id": campaign["id"],
                    "leads": missing,
                    "verify_leads_on_import": False,
                    "skip_if_in_workspace": True,
                    "skip_if_in_campaign": True,
                    "skip_if_in_list": False,
                },
            )

        existing_after = (
            list_campaign_emails(api_key, campaign["id"]) if options.apply else existing_before
        )
        result["campaign_leads_after"] = len(existing_after)
        result["recovery_missing_after"] = sum(
            normalized(lead["email"]) not in existing_after for lead in selected[config["key"]]
        )
        results.append(result)

    billing = api_request(api_key, "GET", "/api/v2/workspace-billing/plan-details")
    outreach = billing.get("subscriptions", {}).get("outreach", {})
    print(
        json.dumps(
            {
                "mode": "apply" if options.apply else "dry-run",
                "cohort": (
                    "remaining"
                    if options.remaining_only
                    else "catch-all"
                    if options.catch_all_only
                    else "broader-fit"
                ),
                "recovery_total": sum(len(leads) for leads in selected.values()),
                "excluded_safety_reasons": dict(sorted(exclusions.items())),
                "campaigns": results,
                "workspace": {
                    "plan": outreach.get("plan_name"),
                    "current_lead_count": outreach.get("current_lead_count"),
                    "total_lead_limit": outreach.get("total_lead_limit"),
                },
                "activation": "not called; campaigns remain paused",
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
