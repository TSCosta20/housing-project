from __future__ import annotations

import json
import os
from typing import Any

import httpx
from google.auth.transport.requests import Request
from google.oauth2 import service_account

from backend.core.supabase_repo import SupabaseRepo


FCM_LEGACY_URL = "https://fcm.googleapis.com/fcm/send"
FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"


def send_pending_push_notifications(repo: SupabaseRepo) -> int:
    service_account_path = os.environ.get("FCM_SERVICE_ACCOUNT_JSON_PATH")
    service_project_id = os.environ.get("FCM_PROJECT_ID")
    server_key = os.environ.get("FCM_SERVER_KEY")

    sender: Any = None
    if service_account_path:
        sender = lambda token, payload: _send_fcm_v1(  # noqa: E731
            service_account_path=service_account_path,
            project_id=service_project_id,
            device_token=token,
            payload=payload,
        )
    elif server_key:
        sender = lambda token, payload: _send_fcm_legacy(server_key, token, payload)  # noqa: E731
    else:
        return 0

    sent_count = 0
    events = repo.get_unnotified_push_events()
    for event in events:
        user_id = repo.get_zone_owner_user_id(event["zone_id"])
        if not user_id:
            continue
        tokens = repo.get_device_tokens(user_id)
        if not tokens:
            continue

        payload = _event_to_payload(event)
        sent_any = False
        for token in tokens:
            if sender(token, payload):
                sent_count += 1
                sent_any = True
        if sent_any:
            repo.mark_deal_event_push_notified(event["id"])
    return sent_count


def _event_to_payload(event: dict[str, Any]) -> dict[str, Any]:
    trigger = event.get("trigger_type", "p10_deal")
    ratio = event.get("ratio_years")
    price = event.get("price_eur")
    return {
        "title": "New property deal",
        "body": f"{trigger} | ratio={ratio} | price={price}",
        "data": {
            "zone_id": str(event.get("zone_id")),
            "listing_id": str(event.get("listing_id")),
            "trigger_type": str(trigger),
        },
    }


def _send_fcm_legacy(server_key: str, device_token: str, payload: dict[str, Any]) -> bool:
    request_body = {
        "to": device_token,
        "notification": {
            "title": payload["title"],
            "body": payload["body"],
        },
        "data": payload["data"],
    }
    headers = {"Authorization": f"key={server_key}", "Content-Type": "application/json"}
    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.post(FCM_LEGACY_URL, json=request_body, headers=headers)
            response.raise_for_status()
        return True
    except Exception:  # noqa: BLE001
        return False


def _send_fcm_v1(
    service_account_path: str,
    project_id: str | None,
    device_token: str,
    payload: dict[str, Any],
) -> bool:
    try:
        credentials = service_account.Credentials.from_service_account_file(
            service_account_path,
            scopes=[FCM_SCOPE],
        )
        credentials.refresh(Request())

        resolved_project_id = project_id or _read_project_id(service_account_path)
        if not resolved_project_id:
            return False

        url = f"https://fcm.googleapis.com/v1/projects/{resolved_project_id}/messages:send"
        request_body = {
            "message": {
                "token": device_token,
                "notification": {
                    "title": payload["title"],
                    "body": payload["body"],
                },
                "data": payload["data"],
            }
        }
        headers = {
            "Authorization": f"Bearer {credentials.token}",
            "Content-Type": "application/json; charset=UTF-8",
        }
        with httpx.Client(timeout=15.0) as client:
            response = client.post(url, json=request_body, headers=headers)
            response.raise_for_status()
        return True
    except Exception:  # noqa: BLE001
        return False


def _read_project_id(service_account_path: str) -> str | None:
    try:
        with open(service_account_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        value = data.get("project_id")
        return str(value) if value else None
    except Exception:  # noqa: BLE001
        return None
