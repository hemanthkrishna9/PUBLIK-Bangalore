"""Point the Telegram bot at the PUBLIK webhook. Run once after the deploy and the secrets are set.

  python scripts/telegram_setup.py

Reads TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET from .env. The secret must be the same value as the
Worker secret TELEGRAM_WEBHOOK_SECRET. Prints only the ok and description fields, never the token.
"""
import json, os, ssl, sys, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "https://publik.nxtduo.com/api/tg"


def env():
    out = {}
    for line in open(os.path.join(ROOT, ".env"), encoding="utf-8"):
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"')
    return out


def context():
    # Zscaler re-signs TLS: use the Windows certificate store when truststore is installed.
    try:
        import truststore
        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    except ImportError:
        return ssl.create_default_context()


def main():
    e = env()
    token, secret = e.get("TELEGRAM_BOT_TOKEN"), e.get("TELEGRAM_WEBHOOK_SECRET")
    if not token or not secret:
        sys.exit("TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must be in .env")
    body = json.dumps({
        "url": URL, "secret_token": secret, "allowed_updates": ["callback_query"], "drop_pending_updates": True,
    }).encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/setWebhook", data=body, headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30, context=context()) as r:
            j = json.loads(r.read())
    except urllib.error.HTTPError as err:
        j = json.loads(err.read() or b"{}")
    except Exception as err:  # the message can hold the URL with the token, so print only the type
        sys.exit(f"Request failed: {type(err).__name__}")
    print("ok:", j.get("ok"))
    print("description:", j.get("description"))


main()
