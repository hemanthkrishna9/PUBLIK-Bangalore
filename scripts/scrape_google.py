"""Collect opening hours, rating and review count from Google Maps for the places in docs/data/places.json.

This drives a real Chromium through Playwright and reads the public place panel.
It is against Google's terms of service. Run it from a personal machine only.
It collects no photos, no review text and no reviewer names.

How it works, per place:
  1. Open https://www.google.com/maps/search/<name>/@<lat>,<lng>,17z
     The map is centred on our point, so Google ranks nearby results first.
     (The ?api=1&query=<name> <lat>,<lng> form treats the coordinates as text and
     returned toilets 300 km away, so it is not used.)
  2. If Google shows a result list, open the nearest of the first six results.
  3. Read the result location from the URL (!3d<lat>!4d<lng>). Accept it only if it
     is within MAX_MATCH_M of our point; otherwise record "nomatch": <metres>.
     The Google category (Park, Public toilet, Library, ...) must also fit our
     category; otherwise record "wrongtype": "<Google category>". BBMP names such as
     "Ward No-174 HSR Layout 24th Cross Park" otherwise match offices and schools.
     If the name search fails, search once more for the bare category word
     ("park", "public toilet", ...) at the same point; such matches carry "via": "category".
  4. On a match read the weekly hours table (after expanding it), the star rating,
     the review count and "Permanently closed". aria-label text is preferred over
     CSS classes, which change often.
  5. Wait 5 to 10 seconds, save the cache, continue.
Places without timings are done first, then the rest (for ratings).
If Google shows a CAPTCHA or "unusual traffic" page the script stops with exit code 2
and writes raw/google.BLOCKED. No proxies, no CAPTCHA solving.

Output: raw/google.json keyed by our place IDs (see README of the record shape in
build_data.merge_google). Day keys "0".."6", "0" = Sunday, 24-hour HH:MM,
open 24 hours = [["00:00","24:00"]], closed = [], past midnight ends at "24:00".

Usage:
  python3 scripts/scrape_google.py --limit 20            test run
  python3 scripts/scrape_google.py                       everything not yet in the cache
  python3 scripts/scrape_google.py --shard 0/4           one of four parallel workers
                                                         (each writes raw/google.part<i>.json)
  python3 scripts/scrape_google.py --merge               combine part files into raw/google.json
  python3 scripts/build_data.py                          merge into places.json
"""
import argparse
import json
import math
import random
import re
import sys
import time
import urllib.parse
from datetime import date
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

ROOT = Path(__file__).resolve().parent.parent
PLACES = ROOT / "docs" / "data" / "places.json"
RAW = ROOT / "raw"
CACHE = RAW / "google.json"
BLOCKED = RAW / "google.BLOCKED"
MAX_MATCH_M = 250
MIN_WAIT, MAX_WAIT = 5, 10
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36")
DAYS = {"sunday": "0", "monday": "1", "tuesday": "2", "wednesday": "3",
        "thursday": "4", "friday": "5", "saturday": "6"}


class Blocked(Exception):
    pass


# What Google may call a place of our category (matched against the category label and the name).
CAT_WORDS = {
    "park": r"park|garden|udyan|green|recreation|playground",
    "playground": r"playground|park|play area|sports|ground",
    "lake": r"lake|reservoir|pond|kere|tank|wetland",
    "library": r"library|reading room",
    "toilet": r"toilet|restroom|washroom|bathroom|lavatory|urinal|e-toilet|sulabh",
}
CAT_QUERY = {"park": "park", "playground": "playground", "lake": "lake", "library": "library", "toilet": "public toilet"}


def type_ok(cat, gcat, gname):
    """Does Google's category (or, failing that, its name) fit our category?"""
    words = CAT_WORDS[cat]
    if gcat:
        return bool(re.search(words, gcat, re.I))
    return bool(re.search(words, gname or "", re.I))


def dist_m(lat1, lng1, lat2, lng2):
    dlat = (lat1 - lat2) * 111_320
    dlng = (lng1 - lng2) * 111_320 * math.cos(math.radians(lat1))
    return math.hypot(dlat, dlng)


def latlng_from_url(url):
    m = re.search(r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)", url)
    if m:
        return float(m.group(1)), float(m.group(2))
    return None


def is_blocked(page):
    if "/sorry/" in page.url or "recaptcha" in page.url:
        return True
    try:
        txt = page.evaluate("() => document.body ? document.body.innerText.slice(0, 4000) : ''")
    except Exception:
        return False
    return bool(re.search(r"unusual traffic|not a robot|automated queries", txt, re.I))


# ---- hours parsing -------------------------------------------------------

def to_24h(h, m, mer):
    h = int(h)
    m = int(m or 0)
    if mer == "am":
        h = 0 if h == 12 else h
    elif mer == "pm":
        h = 12 if h == 12 else h + 12
    return h * 60 + m


def fmt(mins):
    return f"{mins // 60:02d}:{mins % 60:02d}"


TIME_RE = re.compile(
    r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[–—-]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)",
    re.I)


def parse_ranges(text):
    """'5 am–10 am, 4–8 pm' -> [['05:00','10:00'],['16:00','20:00']]. Returns None if unreadable."""
    t = text.replace(" ", " ").replace(" ", " ").replace("\xa0", " ").lower()
    t = re.sub(r"\(.*?\)", "", t)  # "(Hours might differ)" and similar notes
    if re.search(r"open 24 hours|24 hours", t):
        return [["00:00", "24:00"]]
    if re.search(r"\bclosed\b", t) and not TIME_RE.search(t):
        return []
    out = []
    for sh, sm, smer, eh, em, emer in TIME_RE.findall(t):
        emer = emer.lower()
        smer = (smer or "").lower()
        end = to_24h(eh, em, emer)
        if smer:
            start = to_24h(sh, sm, smer)
        else:
            # "4–8 pm" means 4 pm to 8 pm, but "11–1 pm" means 11 am to 1 pm.
            start = to_24h(sh, sm, emer)
            if start >= end:
                start = to_24h(sh, sm, "am" if emer == "pm" else "pm")
        if end <= start:
            end = 24 * 60  # closes after midnight: cut at midnight
        if end == 0:
            end = 24 * 60
        out.append([fmt(start), fmt(end)])
    return out or None


def read_week(page):
    """Return {"0": [...], ...} from the expanded hours table, or None if Google shows no hours."""
    btn = page.query_selector('[role=main] [data-item-id="oh"], [role=main] button[aria-label*="hours" i]')
    if btn is None:
        return None
    try:
        btn.scroll_into_view_if_needed(timeout=3000)
        btn.click(timeout=3000)
    except Exception:
        pass
    rows = []
    for _ in range(12):
        time.sleep(0.5)
        rows = page.evaluate("""() => [...document.querySelectorAll('[role=main] table')].map(t =>
            [...t.querySelectorAll('tr')].map(r => [...r.querySelectorAll('td,th')].map(c => c.innerText)))""")
        if rows and len(rows[0]) >= 7:
            break
    if not rows:
        return None
    # The first table is the main set of hours. A second table (if any) is a sub-area
    # such as a fountain or a counter, which we do not use.
    week = {}
    for cells in rows[0]:
        if len(cells) < 2:
            continue
        day = re.sub(r"[^a-z]", "", cells[0].lower())
        if day not in DAYS:
            continue
        rng = parse_ranges(cells[1])
        if rng is None:
            continue
        week[DAYS[day]] = rng
    return week if len(week) == 7 else None


def read_place(page):
    """Read the place panel. Returns dict with gname, rating, reviews, status, week."""
    rec = {}
    rec["gname"] = page.evaluate("() => document.querySelector('[role=main] h1')?.innerText || null")
    gcat = page.evaluate("""() => document.querySelector('[role=main] button[jsaction*="category"]')?.innerText || null""")
    if not gcat:  # fall back to the header text under the name, e.g. "4.3 | (24,195) | Park"
        hdr = page.evaluate("""() => { const h = document.querySelector('[role=main] h1');
            if (!h) return ''; let e = h; for (let i = 0; i < 3 && e.parentElement; i++) e = e.parentElement;
            return e.innerText.slice(0, 400); }""")
        m = re.search(r"\b(park|garden|playground|lake|reservoir|pond|library|public toilet|toilet|restroom|washroom)\b", hdr, re.I)
        gcat = m.group(1).title() if m else None
    if gcat:
        rec["gcat"] = gcat
    labels = page.evaluate("""() => [...document.querySelectorAll('[role=main] [aria-label]')]
        .map(e => e.getAttribute('aria-label'))""")
    for l in labels:
        m = re.fullmatch(r"\s*(\d(?:\.\d)?) stars?\s*", l or "")
        if m:
            rec["rating"] = float(m.group(1))
            break
    for l in labels:
        m = re.fullmatch(r"\s*([\d,]+) reviews?\s*", l or "")
        if m:
            rec["reviews"] = int(m.group(1).replace(",", ""))
            break
    closed = page.evaluate("""() => [...document.querySelectorAll('[role=main] span, [role=main] div')]
        .some(e => e.children.length === 0 && /^\\s*Permanently closed\\s*$/i.test(e.textContent))""")
    rec["status"] = "CLOSED_PERMANENTLY" if closed else "OPERATIONAL"
    return rec


def wait_for_result(page, seconds):
    """Wait until Google settled on a place, a result list, or a no-results message."""
    t0 = time.time()
    while time.time() - t0 < seconds:
        if is_blocked(page):
            raise Blocked()
        if latlng_from_url(page.url):
            return "place"
        if page.query_selector('[role=feed] a[href*="/maps/place/"]'):
            return "list"
        try:
            if page.evaluate("() => /can't find|no results|doesn't have anything/i.test(document.body.innerText)"):
                return "none"
        except Exception:
            pass
        time.sleep(0.7)
    return "timeout"


def lookup(page, p):
    """Name search first; if that gives nothing usable, one search for the bare category word."""
    rec = search(page, p, p["name"], 17)
    if "gid" not in rec and "error" not in rec:
        time.sleep(random.uniform(MIN_WAIT, MAX_WAIT))
        rec2 = search(page, p, CAT_QUERY[p["cat"]], 18)
        if "gid" in rec2:
            rec2["via"] = "category"
            rec2["first"] = {k: v for k, v in rec.items() if k != "checked"}
            return rec2
    return rec


def search(page, p, query, zoom):
    url = f"https://www.google.com/maps/search/{urllib.parse.quote(query)}/@{p['lat']},{p['lng']},{zoom}z?hl=en"
    rec = {"checked": date.today().isoformat()}
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
    except PWTimeout:
        rec["error"] = "timeout"
        return rec
    kind = wait_for_result(page, 25)
    if kind == "list":
        # Take the nearest of the first few listed results (the list is not sorted by distance).
        hrefs = page.evaluate("""() => [...document.querySelectorAll('[role=feed] a[href*="/maps/place/"]')]
            .map(a => a.href).slice(0, 6)""")
        best, best_d = None, None
        for h in hrefs:
            ll = latlng_from_url(h)
            if ll:
                d = dist_m(p["lat"], p["lng"], *ll)
                if best_d is None or d < best_d:
                    best, best_d = h, d
        if best is None:
            best = hrefs[0]
        elif best_d > MAX_MATCH_M:  # no need to open a result that is too far away
            rec["nomatch"] = round(best_d)
            return rec
        page.goto(best, wait_until="domcontentloaded", timeout=60000)
        kind = wait_for_result(page, 20)
    if kind == "none":
        rec["noresult"] = True
        return rec
    if kind != "place":
        rec["error"] = kind
        return rec
    ll = latlng_from_url(page.url)
    d = dist_m(p["lat"], p["lng"], *ll)
    if d > MAX_MATCH_M:
        rec["nomatch"] = round(d)
        return rec
    time.sleep(1.5)  # let the panel finish rendering
    if is_blocked(page):
        raise Blocked()
    info = read_place(page)
    if not type_ok(p["cat"], info.get("gcat"), info.get("gname")):
        rec["wrongtype"] = info.get("gcat") or info.get("gname") or "?"
        rec["dist"] = round(d)
        return rec
    rec["gid"] = re.sub(r"[?&]g_ep=[^&]*", "", page.url)
    rec["dist"] = round(d)
    rec.update(info)
    week = read_week(page)
    if week:
        rec["week"] = week
    return rec


def load(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def save(path, data):
    path.parent.mkdir(exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def merge_parts():
    out = load(CACHE)
    n = 0
    for part in sorted(RAW.glob("google.part*.json")):
        for k, v in load(part).items():
            out[k] = v
            n += 1
    save(CACHE, out)
    print(f"merged {n} records from part files into {CACHE} ({len(out)} places)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="stop after this many lookups (0 = all)")
    ap.add_argument("--shard", default="", help="i/n: do every n-th place starting at i, write raw/google.part<i>.json")
    ap.add_argument("--merge", action="store_true", help="combine raw/google.part*.json into raw/google.json and exit")
    ap.add_argument("--ids", nargs="*", help="only these place ids (for checks)")
    ap.add_argument("--headful", action="store_true", help="show the browser")
    args = ap.parse_args()

    if args.merge:
        merge_parts()
        return 0
    if BLOCKED.exists():
        sys.exit(f"{BLOCKED} exists: Google blocked an earlier run. Check in a browser, then delete the file.")

    places = json.loads(PLACES.read_text(encoding="utf-8"))["places"]
    cache_path = CACHE
    shard_i, shard_n = 0, 1
    if args.shard:
        shard_i, shard_n = map(int, args.shard.split("/"))
        cache_path = RAW / f"google.part{shard_i}.json"
    cache = load(cache_path)
    done_ids = set(cache) | set(load(CACHE))
    for part in RAW.glob("google.part*.json"):
        done_ids |= set(load(part))

    # Places without timings first, then the rest for ratings.
    todo = [p for p in places if "hours" not in p and "week" not in p] + \
           [p for p in places if "hours" in p or "week" in p]
    if args.ids:
        todo = [p for p in places if p["id"] in set(args.ids)]
    else:
        todo = [p for p in todo if p["id"] not in done_ids]
    todo = todo[shard_i::shard_n]
    if args.limit:
        todo = todo[: args.limit]
    print(f"{len(todo)} places to look up" + (f" (shard {shard_i}/{shard_n})" if args.shard else ""), flush=True)

    n = matched = with_week = 0
    rc = 0
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not args.headful)
        ctx = browser.new_context(locale="en-US", viewport={"width": 1280, "height": 900}, user_agent=UA)
        page = ctx.new_page()
        try:
            for p in todo:
                try:
                    rec = lookup(page, p)
                except Blocked:
                    BLOCKED.write_text(f"{date.today()} blocked at {p['id']} url={page.url}\n")
                    print(f"BLOCKED by Google at {p['id']}. Stopping. Delete {BLOCKED} after checking in a browser.", flush=True)
                    rc = 2
                    break
                except Exception as e:  # keep going on odd pages, record the error
                    rec = {"checked": date.today().isoformat(), "error": str(e)[:200]}
                cache[p["id"]] = rec
                save(cache_path, cache)
                n += 1
                if rec.get("gid"):
                    matched += 1
                    with_week += 1 if rec.get("week") else 0
                tag = ("match %dm%s%s %s" % (rec["dist"], " hours" if rec.get("week") else "",
                                              " via-cat" if rec.get("via") else "", (rec.get("gname") or "")[:30]) if rec.get("gid")
                       else "wrongtype %s" % rec["wrongtype"] if "wrongtype" in rec
                       else "nomatch %dm" % rec["nomatch"] if "nomatch" in rec
                       else "noresult" if rec.get("noresult") else "error " + str(rec.get("error")))
                print(f"[{n}/{len(todo)}] {p['id']:16} {p['name'][:40]:40} {tag}", flush=True)
                time.sleep(random.uniform(MIN_WAIT, MAX_WAIT))
        finally:
            browser.close()
    print(f"done {n}, matched {matched}, with hours {with_week}. cache {cache_path} has {len(cache)} places.", flush=True)
    return rc


if __name__ == "__main__":
    sys.exit(main())
