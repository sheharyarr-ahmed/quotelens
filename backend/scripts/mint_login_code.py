"""Mint an email-OTP sign-in code without sending email (admin API).

Until custom SMTP is configured, hosted Supabase sends only the default
link-only email templates under a 2-emails/hour cap (SPEC v1.3.1 - Auth),
so this is the reliable way to sign in during development:

    cd backend && set -a && source ../.env && set +a && \
        uv run python scripts/mint_login_code.py [email]

In the app, reach the code screen for the SAME email first (enter email,
tap Send code), then run this and type the printed code. Each new code
request — from this script or the app — invalidates the previous code.
"""

import os
import sys

from supabase import create_client

DEFAULT_EMAIL = "sheharyar.softwareengineer@gmail.com"


def _load_env() -> None:
    if os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        return
    env_path = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
    with open(env_path) as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main() -> None:
    _load_env()
    email = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_EMAIL
    client = create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )
    link = client.auth.admin.generate_link({"type": "magiclink", "email": email})
    code = link.properties.email_otp
    print(f"\nSign-in code for {email}:  {code}")
    print(
        "\nType it on the app's code screen for this same email. Note: the"
        "\nproject's OTP length setting decides the digit count; the app"
        "\naccepts 6 (set Email OTP Length to 6 in the Supabase dashboard)."
    )


if __name__ == "__main__":
    main()
