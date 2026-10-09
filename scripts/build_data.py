"""Build docs/data/places.json from the raw source files.

Sources (in raw/):
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
               hours_text=None, hours_src=None, features=None, extra=None):
    p = {"id": pid, "cat": cat, "name": name, "lat": round(lat, 6), "lng": round(lng, 6), "src": src}
    if area:
        p["area"] = area
    if hours:
        p["hours"] = hours
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
    # The same point reused for many parks is a placeholder, not a location.
    seen = {}
    for p in out:
        k = (round(p["lat"], 4), round(p["lng"], 4))
        seen[k] = seen.get(k, 0) + 1
    placeholders = sum(1 for p in out if seen[(round(p["lat"], 4), round(p["lng"], 4))] > 2)
    out = [p for p in out if seen[(round(p["lat"], 4), round(p["lng"], 4))] <= 2]
    print("bbmp parks without usable coordinates:", skipped, "placeholder points:", placeholders)
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
    n = re.sub(r"^(maintenance|maintainance|development|improvement)s?\s+of\s+(the\s+)?(park|garden)s?\s*(at|in|near|on)?\s*",
               "", n, flags=re.I)
    n = re.sub(r"^(maintenance|maintainance)\s+of\s+", "", n, flags=re.I)
    n = re.sub(r"\s*,?\s*in\s+ward\s+no\.?\s*-?\s*\d+", "", n, flags=re.I)
    n = re.sub(r"\s*\(?p-[a-z]-\d+\)?\s*$", "", n, flags=re.I)
    n = re.sub(r",?\s*in\s+\w+\s+zone\.?", "", n, flags=re.I).strip(" ,.-")
    if not n:
        return "Park"
    if len(n) > 70:
        n = n[:67].rsplit(" ", 1)[0] + "..."
    n = n.title()
    return n if re.search(r"park|garden|udyana|vana|ground", n, re.I) else n + " Park"


def parse_osm_hours(s):
    """Handle the simple OSM opening_hours forms. Anything else stays as text only."""
    s = s.strip()
    if s == "24/7":
        return [["00:00", "24:00"]]
    s = re.sub(r"^(Mo-Su|Mo-Sa,Su|daily)\s+", "", s)
    ranges = re.findall(r"(\d{2}:\d{2})-(\d{2}:\d{2})", s)
    if ranges and re.fullmatch(r"[\d:\-,\s]+", s):
        return [list(r) for r in ranges]
    return None


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
            hours=parse_osm_hours(oh) if oh else None,
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
        elif "hours" not in near and "hours" in s:
            near["hours"], near["hoursSrc"] = s["hours"], s["hoursSrc"]
    return kept


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
            if r.get("week") and "hours" not in p:
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
    places = merge_google(bbmp + dedupe(bbmp, osm))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"built": __import__("datetime").date.today().isoformat(),
                               "places": places}, ensure_ascii=False, separators=(",", ":")),
                   encoding="utf-8")
    counts = {}
    for p in places:
        k = (p["cat"], "hours" in p)
        counts[k] = counts.get(k, 0) + 1
    print("bbmp", len(bbmp), "osm", len(osm), "total", len(places))
    for (cat, has), n in sorted(counts.items()):
        print(f"  {cat:10} hours={has!s:5} {n}")


if __name__ == "__main__":
    sys.exit(main())
