"""Build docs/data/places.json from the raw source files.

Sources (in raw/):
  osm_places.json       Overpass export: suburb/neighbourhood/quarter nodes, used to name areas
  parks_under_bbmp.kml  BBMP park list with timings (OpenCity, data.opencity.in/dataset/bbmp-parks)
  osm.json              Overpass export: parks, playgrounds, lakes, libraries, toilets (OpenStreetMap, ODbL)

Any later source (for example Google data) must produce records in the same
shape as make_place() and be appended in main() before dedupe.

Run: python -I scripts/build_data.py   (from W:/apps/publik)
"""
import html
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
OUT = ROOT / "docs" / "data" / "places.json"

# Every timing format found in the BBMP list, mapped by hand.
# Key: the timing text lowercased with all whitespace and <br> removed.
BBMP_HOURS = {
    "morning5amto1.30pmandevening4pmto9pm": [["05:00", "13:30"], ["16:00", "21:00"]],
    "5-00amto10-00am&4-30pmto9-00pm": [["05:00", "10:00"], ["16:30", "21:00"]],
    "5.00amto10.am1.30pmto8.00pm": [["05:00", "10:00"], ["13:30", "20:00"]],
    "5.00am-10.00am1.30am-8.00mm": [["05:00", "10:00"], ["13:30", "20:00"]],
    "5.00amto9.00am4.00pmto9.00pm": [["05:00", "09:00"], ["16:00", "21:00"]],
    "5.00amto10.am4.00pmto8.00pm": [["05:00", "10:00"], ["16:00", "20:00"]],
}

BBMP_FEATURES = {
    "Garden benches": "Benches",
    "Gazebo": "Gazebo",
    "Gym equipment": "Open gym",
    "Toilet": "Toilet",
    "Childrens Play equipments": "Play area",
    "Musical fountains": "Fountain",
}


def make_place(pid, cat, name, lat, lng, src, area=None, hours=None,
               hours_text=None, hours_src=None, features=None, extra=None, week=None):
    p = {"id": pid, "cat": cat, "name": name, "lat": round(lat, 6), "lng": round(lng, 6), "src": src}
    if area:
        p["area"] = area
    if hours:
        p["hours"] = hours
    if week:
        p["week"] = week
    if hours_text:
        p["hoursText"] = hours_text
    if hours_src:
        p["hoursSrc"] = hours_src
    if features:
        p["feat"] = features
    if extra:
        p.update(extra)
    return p


def clean(s):
    s = html.unescape(re.sub(r"\s+", " ", s or "")).strip()
    return s


def field(desc, label):
    """Return the value after 'label:' in a BBMP description, tolerant of double spaces."""
    pat = r"(?:^|<br>)\s*" + r"\s+".join(map(re.escape, label.split())) + r"\s*:(.*?)(?=<br>[^<]{1,120}?:|$)"
    m = re.search(pat, desc, re.S | re.I)
    return clean(m.group(1).replace("<br>", " ")) if m else ""


def load_bbmp():
    text = (RAW / "parks_under_bbmp.kml").read_text(encoding="utf-8", errors="replace")
    out = []
    skipped = 0
    for i, pm in enumerate(re.findall(r"<Placemark>(.*?)</Placemark>", text, re.S)):
        dm = re.search(r"<!\[CDATA\[(.*?)\]\]>", pm, re.S)
        cm = re.search(r"<coordinates>\s*([-\d.]+),([-\d.]+)", pm)
        if not dm:
            continue
        desc = dm.group(1)
        ll = bbmp_latlng(desc, cm)
        if ll is None:
            skipped += 1
            continue
        lat, lng = ll
        name = clean_park_name(field(desc, "Name of Parks"))
        ward = field(desc, "Ward Name and No")
        ward = re.sub(r"^\d+\s*-\s*|\s*-?\s*\d+$", "", ward).strip().title()
        raw_t = field(desc, "Park Timings")
        key = re.sub(r"\s+", "", raw_t.lower())
        hours = BBMP_HOURS.get(key)
        feats = [lab for k, lab in BBMP_FEATURES.items() if field(desc, k).lower().startswith(("avail", "yes"))]
        sqm = to_float(field(desc, "Area (in sqm)")) or to_float(re.sub(r"\D", "", field(desc, "Area (in sqm)")) + ".0")
        out.append(make_place(
            f"bbmp-{i}", "park", name, lat, lng, "bbmp", area=ward or None,
            hours=hours, hours_src="BBMP park list" if hours else None, features=feats or None,
            extra={"sqm": int(sqm)} if sqm else None))
    # A point shared by two or more parks is a placeholder, not a location.
    seen = {}
    for p in out:
        k = (round(p["lat"], 4), round(p["lng"], 4))
        seen[k] = seen.get(k, 0) + 1
    placeholders = sum(1 for p in out if seen[(round(p["lat"], 4), round(p["lng"], 4))] >= 2)
    out = [p for p in out if seen[(round(p["lat"], 4), round(p["lng"], 4))] < 2]
    # Generic names carry no information. Keep them only when they have timings.
    generic = [p for p in out if p["name"].lower() in ("bbmp park", "park")]
    out = [p for p in out if p not in generic or "hours" in p]
    print("bbmp parks without usable coordinates:", skipped,
          "dropped at shared points:", placeholders,
          "generic names dropped:", sum(1 for p in generic if "hours" not in p))
    return out


def in_blr(lat, lng):
    return 12.75 < lat < 13.25 and 77.35 < lng < 77.85


def fix_typo(lat, lng):
    """Repair the two typo patterns seen in the BBMP file: a dropped leading 1 (2.91) and 7 for 1 (72.90)."""
    if 2 < lat < 3.3:
        lat += 10
    elif 72 < lat < 73.3:
        lat -= 60
    if lat > 70 and 12 < lng < 14:
        lat, lng = lng, lat
    return lat, lng


def to_float(s):
    m = re.search(r"\d+\.\d+", s or "")
    return float(m.group(0)) if m else None


def bbmp_latlng(desc, cm):
    cands = []
    if cm:
        cands.append((float(cm.group(2)), float(cm.group(1))))
    lat, lng = to_float(field(desc, "LATITUDE")), to_float(field(desc, "LONGITUDE"))
    if lat and lng:
        cands.append((lat, lng))
    m = re.search(r"Coordinates:\s*([\d.]+)\s*,\s*([\d.]+)", desc)
    if m:
        cands.append((float(m.group(1)), float(m.group(2))))
    for c in cands:
        if in_blr(*c):
            return c
    for c in cands:
        f = fix_typo(*c)
        if in_blr(*f):
            return f
    return None


def clean_park_name(n):
    n = re.sub(r"^ward\s*(no)?\.?\s*-?\s*\d+\s*[,.]?\s*", "", n, flags=re.I)
    n = re.sub(r"^(maintenance|maintainance|development|improvement)s?\s+of\s+(the\s+)?(park|garden)s?\s*(at|in|near|on)?\s*",
               "", n, flags=re.I)
    n = re.sub(r"^(maintenance|maintainance)\s+of\s+", "", n, flags=re.I)
    n = re.sub(r"\s*,?\s*(in\s+)?ward\s*(no)?\.?\s*-?\s*\d+", "", n, flags=re.I)
    n = re.sub(r"\s*\(?p-[a-z]-\d+\)?\s*$", "", n, flags=re.I)
    n = re.sub(r",?\s*in\s+\w+\s+zone\.?", "", n, flags=re.I)
    n = re.sub(r"\s*,(\s*,)+", ",", n)          # empty ", ," fragments
    n = re.sub(r"\s+,", ",", n)
    n = re.sub(r"\s{2,}", " ", n).strip(" ,.-")
    if not n:
        return "Park"
    if len(n) > 70:
        n = n[:67].rsplit(" ", 1)[0] + "..."
    n = n.title()
    n = re.sub(r"(\d)(St|Nd|Rd|Th)\b", lambda m: m.group(1) + m.group(2).lower(), n)
    n = re.sub(r"^Bbmp\b", "BBMP", n)
    return n if re.search(r"park|garden|udyana|vana|ground", n, re.I) else n + " Park"


DAYS = ["su", "mo", "tu", "we", "th", "fr", "sa"]   # index = site day number, 0 = Sunday
DAY_RE = r"(?:mo|tu|we|th|fr|sa|su)[a-z]?"
SEL_RE = DAY_RE + r"(?:\s*-\s*" + DAY_RE + r")?"
TIME_RE = r"(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})"


def _day(tok):
    tok = tok.lower()
    if len(tok) == 3 and tok not in ("mon", "tue", "wed", "thu", "fri", "sat", "sun"):
        raise ValueError(tok)
    return DAYS.index(tok[:2])


def _days(sel):
    """'Mo-Fr,Su' -> set of day numbers (0 = Sunday). Raises ValueError if not understood."""
    out = set()
    for part in sel.split(","):
        part = part.strip()
        if not re.fullmatch(SEL_RE, part, re.I):
            raise ValueError(part)
        ends = [x.strip() for x in part.split("-")]
        a = _day(ends[0])
        b = _day(ends[-1])
        i = a
        while True:          # wraps past Sunday, so Fr-Mo works
            out.add(i)
            if i == b:
                break
            i = (i + 1) % 7
    return out


def _times(text):
    """'05:00-10:00,16:00-20:00' -> [["05:00","10:00"],...]. Raises ValueError if not understood."""
    ranges = []
    for part in text.split(","):
        m = re.fullmatch(TIME_RE, part.strip())
        if not m:
            raise ValueError(part)
        h1, m1, h2, m2 = (int(x) for x in m.groups())
        if h1 > 24 or h2 > 48 or m1 > 59 or m2 > 59:
            raise ValueError(part)
        a, b = f"{h1:02d}:{m1:02d}", f"{h2:02d}:{m2:02d}"
        if b <= a or h2 >= 24:
            b = "24:00"     # runs past midnight: cut at midnight
        if a < b:
            ranges.append([a, b])
    return _merge(ranges)


def _merge(ranges):
    """Sort time ranges and join the ones that overlap."""
    out = []
    for a, b in sorted(ranges):
        if out and a <= out[-1][1]:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def parse_osm_hours(s):
    """Parse common OSM opening_hours forms.

    Returns {"hours": ranges} when every day is the same, {"week": {"0".."6": ranges}}
    otherwise, or None when the text has anything not understood (PH, sunrise,
    week-of-month [n], months, comments). The caller keeps the raw text either way.
    Rules split by ";" override earlier rules for their days. Rules split by ","
    that start with a day selector add to earlier rules, as the OSM spec says.
    Exception: a ";" rule with no day selector adds its times to earlier rules.
    """
    s = (s or "").strip()
    if not s:
        return None
    if s.lower() == "24/7":
        return {"hours": [["00:00", "24:00"]]}
    week = {d: None for d in range(7)}   # None = no rule yet (closed in the end)
    try:
        for n_rule, rule in enumerate(filter(None, (r.strip() for r in s.split(";")))):
            # Split the rule into ", <days> ..." sub-rules; a bare ", 16:00-20:00" stays with its rule.
            subs = re.split(r"(?:(?<=\d)|(?<=off)|(?<=closed)),\s*(?=" + SEL_RE + r"(?:\s*,\s*" + SEL_RE + r")*\s+(?:\d|off|closed))", rule,
                            flags=re.I)
            touched = set()
            if n_rule and not re.match(SEL_RE + r"(?:\s*,\s*" + SEL_RE + r")*\s", rule, re.I):
                # "05:00-10:00;16:30-19:00": a later rule with no days is a second
                # time range, not an override. Mappers write it this way.
                touched = {d for d in range(7) if week[d] is not None}
            for sub in subs:
                sub = sub.strip()
                m = re.match(r"((?:" + SEL_RE + r")(?:\s*,\s*" + SEL_RE + r")*)\s+(.*)$", sub, re.I)
                if m:
                    days, body = _days(m.group(1)), m.group(2).strip()
                else:
                    days, body = set(range(7)), sub
                if body.lower() in ("off", "closed"):
                    ranges = []
                elif body.lower() == "24/7":
                    ranges = [["00:00", "24:00"]]
                else:
                    ranges = _times(body)
                for d in days:
                    if d in touched:
                        week[d] = _merge(week[d] + ranges)   # "," rule: add
                    else:
                        week[d] = list(ranges)               # new rule: replace
                touched |= days
    except ValueError:
        return None
    week = {d: (r or []) for d, r in week.items()}
    if all(not r for r in week.values()):
        return None
    vals = list(week.values())
    if all(v == vals[0] for v in vals):
        return {"hours": vals[0]}
    return {"week": {str(d): week[d] for d in range(7)}}


def load_osm():
    els = json.loads((RAW / "osm.json").read_text(encoding="utf-8"))["elements"]
    out = []
    for e in els:
        t = e.get("tags", {})
        if t.get("access") in ("private", "no", "customers"):
            continue
        if t.get("leisure") == "park":
            cat = "park"
        elif t.get("leisure") == "playground":
            cat = "playground"
        elif t.get("water") == "lake":
            cat = "lake"
        elif t.get("amenity") == "library":
            cat = "library"
        elif t.get("amenity") == "toilets":
            cat = "toilet"
        else:
            continue
        name = clean(t.get("name:en") or t.get("name"))
        if not name:
            if cat != "toilet":
                continue  # unnamed parks and lakes are mostly apartment greens and ponds
            name = "Public toilet"
        c = e.get("center") or e
        if "lat" not in c:
            continue
        oh = t.get("opening_hours")
        parsed = parse_osm_hours(oh) if oh else None
        feats = []
        if cat == "toilet":
            if t.get("fee") == "no":
                feats.append("Free")
            elif t.get("fee") == "yes":
                feats.append("Paid")
            if t.get("wheelchair") == "yes":
                feats.append("Wheelchair access")
        out.append(make_place(
            f"osm-{e['type'][0]}{e['id']}", cat, name, c["lat"], c["lon"], "osm",
            hours=(parsed or {}).get("hours"), week=(parsed or {}).get("week"),
            hours_text=oh, hours_src="OpenStreetMap" if oh else None,
            features=feats or None))
    return out


def dist_m(a, b):
    dlat = (a["lat"] - b["lat"]) * 111_320
    dlng = (a["lng"] - b["lng"]) * 111_320 * math.cos(math.radians(a["lat"]))
    return math.hypot(dlat, dlng)


def dedupe(primary, secondary, radius_m=120):
    """Drop secondary parks that sit within radius_m of a primary park; borrow their hours if missing."""
    kept = []
    for s in secondary:
        if s["cat"] != "park":
            kept.append(s)
            continue
        near = next((p for p in primary if dist_m(p, s) < radius_m), None)
        if near is None:
            kept.append(s)
        elif "hours" not in near and "week" not in near and ("hours" in s or "week" in s):
            for k in ("hours", "week", "hoursSrc"):
                if k in s:
                    near[k] = s[k]
    return kept


def load_area_nodes():
    """Suburb, neighbourhood and quarter nodes from raw/osm_places.json, as (lat, lng, name)."""
    path = RAW / "osm_places.json"
    if not path.exists():
        print("raw/osm_places.json missing: areas not filled")
        return []
    try:
        els = json.loads(path.read_text(encoding="utf-8"))["elements"]
    except (ValueError, KeyError):
        print("raw/osm_places.json is not Overpass JSON (server busy?): areas not filled")
        return []
    nodes = []
    for e in els:
        t = e.get("tags", {})
        name = clean(t.get("name:en") or t.get("name"))
        if name and "lat" in e:
            nodes.append({"lat": e["lat"], "lng": e["lon"], "name": name})
    return nodes


def fill_areas(places, nodes, radius_m=2500):
    """Give each place without an area the name of the nearest area node within radius_m."""
    filled = 0
    for p in places:
        if p.get("area") or not nodes:
            continue
        best = min(nodes, key=lambda n: dist_m(p, n))
        if dist_m(p, best) <= radius_m:
            p["area"] = best["name"]
            filled += 1
    return filled


def name_generic(places):
    """Add the area to names that say nothing on their own."""
    for p in places:
        a = p.get("area")
        if p["name"] == "Public toilet" and a:
            p["name"] = f"Public toilet, {a}"
        elif p["src"] == "bbmp" and p["name"].lower() in ("bbmp park", "park"):
            p["name"] = "BBMP park" + (f", {a}" if a else "")


def test_parser():
    cases = ["Tu-Su 10:00-21:00", "mo-su 06:30-20:00", "5:00-10:00;16:30-19:00",
             "Mo-Su 05:00-10:00, Mo-Su 18:00-20:00", "24/7", "Mo-Sa 09:00-18:00; Su off",
             "sunrise-sunset", "Mo-Fr 18:00-02:00"]
    for c in cases:
        print(f"  {c!r:42} -> {json.dumps(parse_osm_hours(c))}")
    assert parse_osm_hours("sunrise-sunset") is None
    els = json.loads((RAW / "osm.json").read_text(encoding="utf-8"))["elements"]
    vals = sorted({e["tags"]["opening_hours"] for e in els if e.get("tags", {}).get("opening_hours")})
    bad = [v for v in vals if parse_osm_hours(v) is None]
    print(f"osm opening_hours: {len(vals) - len(bad)} of {len(vals)} distinct values parse")
    for v in bad:
        print("  not parsed:", repr(v))


def merge_google(places):
    """Merge raw/google.json (written by google_hours.py) if it exists.

    Google timings fill only places without timings. Ratings are added to every
    matched place. Places that Google marks as permanently closed are dropped.
    """
    path = RAW / "google.json"
    if not path.exists():
        return places
    g = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for p in places:
        r = g.get(p["id"])
        if r and r.get("gid"):
            if r.get("status") == "CLOSED_PERMANENTLY":
                continue
            if r.get("week") and "hours" not in p and "week" not in p:
                p["week"] = r["week"]
                p["hoursSrc"] = f"Google Maps, checked {r['checked']}"
            if r.get("reviews"):
                p["rating"], p["reviews"] = r.get("rating"), r["reviews"]
        out.append(p)
    print("google records merged:", sum(1 for p in out if "week" in p or "reviews" in p))
    return out


def main():
    bbmp = load_bbmp()
    osm = load_osm()
    test_parser()
    places = merge_google(bbmp + dedupe(bbmp, osm))
    nodes = load_area_nodes()
    no_area = sum(1 for p in places if not p.get("area"))
    filled = fill_areas(places, nodes)
    name_generic(places)
    print(f"area nodes: {len(nodes)}; places without area: {no_area}; filled: {filled}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"built": __import__("datetime").date.today().isoformat(),
                               "places": places}, ensure_ascii=False, separators=(",", ":")),
                   encoding="utf-8")
    counts = {}
    for p in places:
        c = counts.setdefault(p["cat"], {"total": 0, "hours": 0, "week": 0, "text only": 0, "area": 0})
        c["total"] += 1
        c["hours"] += "hours" in p
        c["week"] += "week" in p
        c["text only"] += "hoursText" in p and "hours" not in p and "week" not in p
        c["area"] += bool(p.get("area"))
    print("bbmp", len(bbmp), "osm", len(osm), "total", len(places))
    for cat, c in sorted(counts.items()):
        print(f"  {cat:10} " + " ".join(f"{k}={v}" for k, v in c.items()))


if __name__ == "__main__":
    sys.exit(main())
