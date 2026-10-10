"""PUBLIK traffic report from the Cloudflare GraphQL API.

Run it from the repo root (the token comes from the wrangler login and is never printed):

    CF_TOKEN=$(NODE_OPTIONS=--use-system-ca npx wrangler auth token | tail -1) python -I scripts/traffic.py [days]

The free plan keeps only a few days of per-request data, so days is 1 to 3 (default 3).
Bots are split out by user agent: link previews, crawlers and scanners do not count as people.
"""
import json
import os
import re
import ssl
import sys
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

HOST = "publik.nxtduo.com"
IST = timedelta(hours=5, minutes=30)
BOT_RE = re.compile(r"bot|crawl|spider|externalhit|whatsapp|telegram|slack|skype|preview|go-http|python|curl|"
                    r"wget|headless|read-aloud|forestengine|checker|networkingextension|^mozilla/5\.0 \(compatible\)$|^$", re.I)
# Scanners send a bare browser string with no version, for example "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36".
BARE_RE = re.compile(r"^Mozilla/5\.0 \([^)]*\) AppleWebKit/537\.36$")

try:
    import truststore  # the Windows certificate store, for Zscaler
    CTX = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
except ImportError:
    CTX = ssl.create_default_context()
TOKEN = os.environ.get("CF_TOKEN", "").strip()


def call(path, body=None):
    req = urllib.request.Request(
        "https://api.cloudflare.com/client/v4" + path,
        data=json.dumps(body).encode() if body else None,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, context=CTX, timeout=60) as r:
        return json.load(r)


def is_bot(ua):
    return bool(BOT_RE.search(ua or "")) or bool(BARE_RE.match(ua or ""))


def main():
    if not TOKEN:
        sys.exit("Set CF_TOKEN first (see the top of this file).")
    days = max(1, min(3, int(sys.argv[1]) if len(sys.argv) > 1 else 3))
    zone = call("/zones?name=nxtduo.com")["result"][0]["id"]
    now = datetime.now(timezone.utc)
    since, until = (now - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ"), now.strftime("%Y-%m-%dT%H:%M:%SZ")
    f = f'datetime_geq:$s, datetime_lt:$u, clientRequestHTTPHost:"{HOST}"'
    q = f"""query($z:String!,$s:Time!,$u:Time!){{viewer{{zones(filter:{{zoneTag:$z}}){{
      pages: httpRequestsAdaptiveGroups(limit:5000, filter:{{{f}, edgeResponseContentTypeName:"html"}}){{
        count dimensions{{clientIP userAgent clientCountryName datetimeHour}} }}
      api: httpRequestsAdaptiveGroups(limit:50, filter:{{{f}, clientRequestPath_like:"/api/%", edgeResponseStatus:200}}){{
        count dimensions{{clientRequestPath}} }}
      probes: httpRequestsAdaptiveGroups(limit:1, filter:{{{f}, edgeResponseStatus:404}}){{ count }}
    }}}}}}"""
    out = call("/graphql", {"query": q, "variables": {"z": zone, "s": since, "u": until}})
    if out.get("errors"):
        sys.exit("Cloudflare error: " + "; ".join(e["message"] for e in out["errors"]))
    z = out["data"]["viewer"]["zones"][0]

    people_loads, bot_loads = Counter(), Counter()
    people_ips = defaultdict(set)
    hours = Counter()
    india = set()
    for r in z["pages"]:
        d = r["dimensions"]
        t = datetime.fromisoformat(d["datetimeHour"].replace("Z", "+00:00")) + IST
        day = t.strftime("%Y-%m-%d")
        if is_bot(d["userAgent"]):
            bot_loads[day] += r["count"]
            continue
        people_loads[day] += r["count"]
        people_ips[day].add(d["clientIP"])
        hours[t.strftime("%d %b %H:00")] += r["count"]
        if d["clientCountryName"] == "IN":
            india.add(d["clientIP"])

    all_ips = set().union(*people_ips.values()) if people_ips else set()
    print(f"PUBLIK traffic, last {days} day(s), IST dates. Generated {(now + IST).strftime('%d %b %Y %H:%M')} IST.")
    print(f"People (distinct IPs, bots removed): {len(all_ips)}, of which India: {len(india)}")
    print("Day        people  page loads  bot loads")
    for day in sorted(set(people_loads) | set(bot_loads)):
        print(f"{day:10} {len(people_ips[day]):6}  {people_loads[day]:10}  {bot_loads[day]:9}")
    print("Busiest hours (people page loads):")
    for h, n in hours.most_common(5):
        print(f"  {h} IST  {n}")
    api = {a["dimensions"]["clientRequestPath"]: a["count"] for a in z["api"]}
    print("Use of features (successful API calls):")
    print(f"  place cards opened (/api/reports): {api.get('/api/reports', 0)}")
    print(f"  one-tap reports sent (/api/report): {api.get('/api/report', 0)}")
    print(f"  I went here sent (/api/visit): {api.get('/api/visit', 0)}")
    print(f"  home page activity row loaded (/api/activity): {api.get('/api/activity', 0)}")
    probes = z["probes"][0]["count"] if z["probes"] else 0
    print(f"Not found (404) requests, mostly hacking scans: {probes}")


if __name__ == "__main__":
    main()
