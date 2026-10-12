"""Owner tool for user photos: list, view, restore, delete.

  python scripts/photos_admin.py summary         (counts of hidden and pending photos)
  python scripts/photos_admin.py list [pending|hidden|rejected|failed|live|deleted]
  python scripts/photos_admin.py view <id>       (saves the photo and opens it)
  python scripts/photos_admin.py restore <id>
  python scripts/photos_admin.py hide <id>
  python scripts/photos_admin.py delete <id>

Reads ADMIN_TOKEN from .env. Use --base http://127.0.0.1:8787 for a local `wrangler dev`.
"""
import json, os, re, sys, tempfile, urllib.error, urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
# Captions are visitor text: drop control characters and bidi overrides before printing.
UNSAFE = re.compile("[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]")


def clean(s):
    return UNSAFE.sub(" ", s or "")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://publik.nxtduo.com"


def token():
    for line in open(os.path.join(ROOT, ".env"), encoding="utf-8"):
        if line.startswith("ADMIN_TOKEN="):
            return line.split("=", 1)[1].strip().strip('"')
    sys.exit("ADMIN_TOKEN is not in .env")


def call(path, body=None):
    req = urllib.request.Request(BASE + path, method="POST" if body else "GET")
    req.add_header("authorization", "Bearer " + token())
    req.add_header("user-agent", "publik-admin/1")
    if body:
        req.add_header("content-type", "application/json")
        req.data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read(), r.headers.get("content-type", "")
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode(errors='replace')[:200]}")


def main(argv):
    global BASE
    if "--base" in argv:
        i = argv.index("--base")
        BASE = argv[i + 1].rstrip("/")
        del argv[i:i + 2]
    cmd = argv[0] if argv else "list"
    if cmd == "summary":
        c = json.loads(call("/api/admin/summary")[0])
        print(f"hidden: {c['hidden']}  pending: {c['pending']}")
    elif cmd == "list":
        status = argv[1] if len(argv) > 1 else "pending"
        rows = json.loads(call(f"/api/admin/photos?status={status}")[0])["photos"]
        print(f"{len(rows)} {status} photos")
        for r in rows:
            print(f"{r['id']}  {r['place']}  reports={r['reports']}  {r['bytes'] // 1024} KB  {clean(r['reason'])}  | {clean(r['text'])[:60]}")
    elif cmd == "view" and len(argv) > 1:
        data, ctype = call(f"/api/admin/img/{argv[1]}/full")
        path = os.path.join(tempfile.gettempdir(), f"publik-{argv[1]}." + ("webp" if "webp" in ctype else "jpg"))
        open(path, "wb").write(data)
        print("saved", path)
        if hasattr(os, "startfile"):
            os.startfile(path)
    elif cmd in ("restore", "delete", "hide") and len(argv) > 1:
        print(call("/api/admin/photo", {"id": argv[1], "action": cmd})[0].decode())
    else:
        print(__doc__)


main(sys.argv[1:])
