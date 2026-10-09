"""Fetch opening hours, rating and review count from the Google Places API (New).

Run this on a personal machine, not the work laptop.

For each place in docs/data/places.json that has no timings, the script runs one
Text Search with the place name, biased to a 300 m circle around our location.
It accepts the top result only if it is within MAX_MATCH_M of our location.
Results are cached in raw/google.json, so a second run only asks for places
that are not in the cache yet. build_data.py merges the cache into places.json.

Each request is billed as Text Search Enterprise (regularOpeningHours, rating,
userRatingCount are Enterprise fields). Use --limit to stay inside the free tier.

Usage:
  set GOOGLE_MAPS_KEY=...            (Windows)   or   export GOOGLE_MAPS_KEY=...
  python scripts/google_hours.py --limit 20     (test run)
  python scripts/google_hours.py --limit 1000
  python scripts/build_data.py
"""
import argparse
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLACES = ROOT / "docs" / "data" / "places.json"
CACHE = ROOT / "raw" / "google.json"
URL = "https://places.googleapis.com/v1/places:searchText"
FIELDS = "places.id,places.displayName,places.location,places.regularOpeningHours,places.rating,places.userRatingCount,places.businessStatus"
MAX_MATCH_M = 250


def dist_m(lat1, lng1, lat2, lng2):
    dlat = (lat1 - lat2) * 111_320
    dlng = (lng1 - lng2) * 111_320 * math.cos(math.radians(lat1))
    return math.hypot(dlat, dlng)


def search(key, p):
    body = {
        "textQuery": f"{p['name']} Bengaluru",
        "pageSize": 1,
        "locationBias": {"circle": {"center": {"latitude": p["lat"], "longitude": p["lng"]}, "radius": 300.0}},
    }
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), method="POST", headers={
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELDS,
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r).get("places", [])


def daily_ranges(oh):
    """Convert Google periods to {day: [[open, close], ...]} with day 0 = Sunday, times as HH:MM."""
    out = {}
    for per in oh.get("periods", []):
        o, c = per.get("open"), per.get("close")
        if o is None:
            continue
        if c is None:  # open 24 hours
            for d in range(7):
                out.setdefault(d, []).append(["00:00", "24:00"])
            continue
        start = f"{o['hour']:02d}:{o.get('minute', 0):02d}"
        end = f"{c['hour']:02d}:{c.get('minute', 0):02d}"
        if c["day"] != o["day"] or end <= start:
            end = "24:00"  # closes after midnight: cut at midnight
        out.setdefault(o["day"], []).append([start, end])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=20, help="maximum API requests in this run")
    ap.add_argument("--all", action="store_true", help="also look up places that already have timings")
    args = ap.parse_args()

    key = os.environ.get("GOOGLE_MAPS_KEY")
    if not key:
        sys.exit("Set GOOGLE_MAPS_KEY first.")

    places = json.loads(PLACES.read_text(encoding="utf-8"))["places"]
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    todo = [p for p in places if p["id"] not in cache and (args.all or "hours" not in p)]
    print(f"{len(todo)} places to look up, this run will do at most {args.limit}")

    done = matched = 0
    for p in todo[: args.limit]:
        try:
            res = search(key, p)
        except urllib.error.HTTPError as e:
            print(f"HTTP {e.code} on {p['id']}: {e.read()[:300]!r}")
            if e.code in (400, 403, 429):
                break
            continue
        done += 1
        rec = {"checked": date.today().isoformat()}
        if res:
            g = res[0]
            loc = g.get("location", {})
            d = dist_m(p["lat"], p["lng"], loc.get("latitude", 0), loc.get("longitude", 0))
            if d <= MAX_MATCH_M:
                matched += 1
                rec.update({
                    "gid": g.get("id"),
                    "gname": g.get("displayName", {}).get("text"),
                    "dist": round(d),
                    "status": g.get("businessStatus"),
                    "rating": g.get("rating"),
                    "reviews": g.get("userRatingCount"),
                })
                if g.get("regularOpeningHours"):
                    rec["week"] = daily_ranges(g["regularOpeningHours"])
            else:
                rec["nomatch"] = round(d)
        cache[p["id"]] = rec
        if done % 25 == 0:
            CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
            print(f"  {done} done, {matched} matched")
        time.sleep(0.1)

    CACHE.parent.mkdir(exist_ok=True)
    CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    with_hours = sum(1 for r in cache.values() if r.get("week"))
    print(f"requests {done}, matched {matched}. Cache: {len(cache)} places, {with_hours} with timings.")


if __name__ == "__main__":
    main()
