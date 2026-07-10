"""Configure hosted Supabase for code-based email-OTP sign-in (SPEC v1.3.1 - Auth).

Applies, via the Supabase Management API, the custom-SMTP + code-only-template
setup that hosted Supabase requires before it will send a typable 6-digit
sign-in code (link-only templates and the 2-emails/hour built-in cap are locked
until custom SMTP is configured; the default OTP length is 8, the app accepts 6):

  1. Custom SMTP  -> Brevo relay, from the BREVO_* vars in the repo-root .env.
     Enabling SMTP is also what UNLOCKS email-template editing, so it goes first.
  2. mailer_otp_length -> 6   (app's code screen accepts 6 digits).
  3. Magic Link + Confirm signup templates -> code-only, using {{ .Token }}
     (signInWithOtp uses Magic Link for an existing user, Confirm signup for a
     new one; both must carry the code).

Idempotent: re-running just re-applies the same values. Secrets are read from
the environment and never printed. Run it (config write -> the owner runs it):

    cd backend && set -a && source ../.env && set +a && \
        uv run python scripts/configure_email_smtp.py

Requires in .env: SUPABASE_URL, SUPABASE_ACCESS_TOKEN, and
BREVO_SMTP_HOST / BREVO_SMTP_PORT / BREVO_SMTP_LOGIN / BREVO_SMTP_KEY /
BREVO_SENDER_EMAIL / BREVO_SENDER_NAME.
"""

import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request

import certifi

MGMT_BASE = "https://api.supabase.com"

# Cloudflare fronts the Management API and 403s (error 1010) on stdlib urllib's
# default "Python-urllib/x.y" User-Agent; a curl-style UA is allowed through.
_USER_AGENT = "curl/8.7.1"

# This machine's system Python has no usable CA bundle (SSL verify fails on
# stdlib urllib); auth.py hits the same wall and fixes it with certifi. Reuse it.
_SSL_CTX = ssl.create_default_context(cafile=certifi.where())

# Code-only email body. signInWithOtp injects the 6-digit code as {{ .Token }};
# NOT {{ .ConfirmationURL }}, which would render a magic link instead of a code.
CODE_TEMPLATE = (
    "<h2>Your QuoteLens sign-in code</h2>\n"
    "<p>Enter this code in the app to sign in:</p>\n"
    '<p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:16px 0">'
    "{{ .Token }}</p>\n"
    '<p style="color:#666">This code expires in 60 minutes. '
    "If you didn't request it, you can ignore this email.</p>"
)
CODE_SUBJECT = "Your QuoteLens sign-in code"


def _load_env() -> None:
    if os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_ACCESS_TOKEN"):
        return
    env_path = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
    with open(env_path) as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _require(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        sys.exit(f"ERROR: {name} is missing from the environment / .env")
    return val


def _project_ref(url: str) -> str:
    m = re.match(r"https://([a-z0-9]+)\.supabase\.co", url)
    if not m:
        sys.exit(f"ERROR: could not parse project ref from SUPABASE_URL={url!r}")
    return m.group(1)


def _patch(ref: str, token: str, secret: str, body: dict, label: str) -> None:
    url = f"{MGMT_BASE}/v1/projects/{ref}/config/auth"
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="PATCH")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", _USER_AGENT)
    for attempt in (1, 2):
        try:
            with urllib.request.urlopen(req, timeout=30, context=_SSL_CTX) as resp:
                resp.read()
            print(f"  OK  {label}")
            return
        except urllib.error.HTTPError as e:
            detail = _redact(e.read().decode(errors="replace"), secret)
            # Template editing can 403 briefly right after SMTP is enabled; retry once.
            if e.code == 403 and attempt == 1:
                print(f"  ..  {label}: 403, retrying after SMTP settles")
                time.sleep(3)
                continue
            sys.exit(f"  FAIL {label}: HTTP {e.code}\n{detail}")
        except urllib.error.URLError as e:
            sys.exit(f"  FAIL {label}: {e}")


def _get_config(ref: str, token: str) -> dict:
    url = f"{MGMT_BASE}/v1/projects/{ref}/config/auth"
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("User-Agent", _USER_AGENT)
    with urllib.request.urlopen(req, timeout=30, context=_SSL_CTX) as resp:
        return json.loads(resp.read())


def _redact(text: str, secret: str) -> str:
    return text.replace(secret, "***") if secret else text


def main() -> None:
    _load_env()
    supabase_url = _require("SUPABASE_URL")
    token = _require("SUPABASE_ACCESS_TOKEN")
    smtp_host = _require("BREVO_SMTP_HOST")
    smtp_port = _require("BREVO_SMTP_PORT")
    smtp_user = _require("BREVO_SMTP_LOGIN")
    smtp_pass = _require("BREVO_SMTP_KEY")
    sender_email = _require("BREVO_SENDER_EMAIL")
    sender_name = _require("BREVO_SENDER_NAME")
    ref = _project_ref(supabase_url)

    print(f"Configuring email OTP on project {ref} ...")

    # 1) SMTP + OTP length. Enabling SMTP unlocks template editing, so it is first.
    _patch(
        ref,
        token,
        smtp_pass,
        {
            "smtp_host": smtp_host,
            "smtp_port": smtp_port,
            "smtp_user": smtp_user,
            "smtp_pass": smtp_pass,
            "smtp_admin_email": sender_email,
            "smtp_sender_name": sender_name,
            "mailer_otp_length": 6,
        },
        "SMTP + mailer_otp_length=6",
    )

    # 2) Code-only templates for the two flows signInWithOtp uses.
    _patch(
        ref,
        token,
        smtp_pass,
        {
            "mailer_subjects_magic_link": CODE_SUBJECT,
            "mailer_templates_magic_link_content": CODE_TEMPLATE,
            "mailer_subjects_confirmation": CODE_SUBJECT,
            "mailer_templates_confirmation_content": CODE_TEMPLATE,
        },
        "Magic Link + Confirm signup code-only templates",
    )

    # 3) Verify (read-back), masking the SMTP password.
    cfg = _get_config(ref, token)
    ml = cfg.get("mailer_templates_magic_link_content", "") or ""
    cf = cfg.get("mailer_templates_confirmation_content", "") or ""
    checks = [
        ("smtp_host", cfg.get("smtp_host") == smtp_host, cfg.get("smtp_host")),
        ("smtp_admin_email", cfg.get("smtp_admin_email") == sender_email, cfg.get("smtp_admin_email")),
        ("smtp_user", cfg.get("smtp_user") == smtp_user, cfg.get("smtp_user")),
        ("smtp_sender_name", cfg.get("smtp_sender_name") == sender_name, cfg.get("smtp_sender_name")),
        ("smtp_pass set", bool(cfg.get("smtp_pass")), "***" if cfg.get("smtp_pass") else None),
        ("mailer_otp_length==6", cfg.get("mailer_otp_length") == 6, cfg.get("mailer_otp_length")),
        ("magic_link has {{ .Token }}", "{{ .Token }}" in ml, None),
        ("magic_link has NO {{ .ConfirmationURL }}", "{{ .ConfirmationURL }}" not in ml, None),
        ("confirmation has {{ .Token }}", "{{ .Token }}" in cf, None),
        ("confirmation has NO {{ .ConfirmationURL }}", "{{ .ConfirmationURL }}" not in cf, None),
    ]
    print("\nVerification:")
    all_ok = True
    for name, ok, shown in checks:
        mark = "PASS" if ok else "FAIL"
        all_ok = all_ok and ok
        suffix = "" if shown is None else f"  (= {shown!r})"
        print(f"  [{mark}] {name}{suffix}")

    if not all_ok:
        sys.exit("\nSome checks FAILED - config not fully applied.")
    print("\nAll checks passed. Email OTP is configured; ready to send a real code.")


if __name__ == "__main__":
    main()
