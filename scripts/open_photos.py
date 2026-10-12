"""Find more free, credited photos for places in docs/data/places.json.

Two sources, each with its own cache in raw/:

  openverse  Photos from Flickr and other open collections, found through the
             Openverse search API (no key). Only CC BY, CC BY-SA, CC0 and public
             domain photos. Openverse has no location search, so a photo is
             accepted only if its title names the place, says what it is (lake,
             park, ...) and its title or tags say Bangalore or Bengaluru.
             Cache: raw/photos_openverse.json
  birds      Bird photos from iNaturalist, taken within BIRD_RADIUS_KM of a lake.
             Only research-grade observations with CC BY, CC BY-SA or CC0 photos.
             Cache: raw/birds.json

The site loads each image from the source's servers. Run
`python scripts/build_data.py --photos` afterwards to merge the caches.

Usage: python scripts/open_photos.py openverse|birds [--limit N]
"""
import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from wikimedia_photos import PLACES, ROOT, UA, key_words  # noqa: E402

OV_CACHE = ROOT / "raw" / "photos_openverse.json"
BIRD_CACHE = ROOT / "raw" / "birds.json"
WIKI_CACHE = ROOT / "raw" / "photos.json"
BIRD_RADIUS_KM = 0.6
BIRDS_PER_PLACE = 6
LICENSE = {"by": "CC BY", "by-sa": "CC BY-SA", "cc0": "CC0", "pdm": "Public domain"}
# Photos of people are left out, so that the site shows the place.
PEOPLE = re.compile(r"couple|people|girl|boy|selfie|portrait|wedding|man\b|woman|lady|kid|child|family|friends|me\b|us\b")
CITY = re.compile(r"bangalore|bengaluru|banglore")
# Titles about something other than the place itself, for example "Madhavan Park post office".
NOT_PLACE = re.compile(r"post office|office|tech|juice|restaurant|hotel|cafe|shop|mall|school|college|"
                       r"temple|church|mosque|station|bus|metro|road|signal|inaugurat|apartment|faraway")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def load(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def flickr_size(url):
    # Flickr "_b" is 1024 px wide. "_c" (800 px) is enough for the card and the strip.
    return re.sub(r"_[bhko]\.jpg$", "_c.jpg", url)


KIND_WORDS = {"lake": re.compile(r"lake|kere|tank"), "library": re.compile(r"library"),
              "park": re.compile(r"park|garden|udyana|vana"), "playground": re.compile(r"playground|park")}


def kind(p):
    return "lake" if p["cat"] == "lake" or KIND_WORDS["lake"].search(p["name"].lower()) else p["cat"]


def km(a, b):
    return ((a["lat"] - b["lat"]) ** 2 + ((a["lng"] - b["lng"]) * 0.974) ** 2) ** 0.5 * 111


def twins(places):
    """Places whose key words and kind match another place more than 3 km away,
    for example the two Puttenahalli lakes. Nearby matches are parts of one place."""
    groups = {}
    for p in places:
        groups.setdefault((tuple(key_words(p["name"])[:2]), kind(p)), []).append(p)
    return {p["id"] for g in groups.values() for p in g if any(km(p, q) > 3 for q in g)}


def squash(text):
    return re.sub(r"[^a-z]", "", text.lower())


def far_areas(p, nodes):
    """Squashed neighbourhood names (for example "jpnagar") that are only found more
    than 4 km from the place. A photo title that names one shows another place."""
    near, far = set(), set()
    for n in nodes:
        name = squash(n["name"])
        if len(name) >= 6:
            (near if km(p, n) <= 4 else far).add(name)
    own = {squash(w) for w in key_words(p["name"])}
    return {n for n in far - near if not any(n in w or w in n for w in own)}


def wiki_thumb(url):
    # A full-size Commons file can be 4000 px wide. Use the 960 px thumbnail.
    m = re.match(r"(https://upload\.wikimedia\.org/wikipedia/commons)/(\w/\w\w)/([^/]+)$", url)
    return f"{m[1]}/thumb/{m[2]}/{m[3]}/960px-{m[3]}" if m else url


def openverse_photo(p, shared, nodes=()):
    words = key_words(p["name"])[:2]
    area = key_words(p.get("area") or "")
    # A place with a far-away twin: the photo title must also name the area.
    twin = p["id"] in shared
    if twin and not area:
        return None
    q = " ".join(words + [{"library": "library", "lake": "lake"}.get(p["cat"], "")]).strip()
    url = "https://api.openverse.org/v1/images/?" + urllib.parse.urlencode(
        {"q": q + " bangalore", "license": ",".join(LICENSE), "page_size": 20, "mature": "false"})
    for r in get(url).get("results", []):
        title = (r.get("title") or "").lower()
        tags = " ".join(t.get("name", "") for t in r.get("tags") or []).lower()
        if not all(w in title for w in words) or not KIND_WORDS[kind(p)].search(title):
            continue
        if not CITY.search(title + " " + tags) or PEOPLE.search(title) or NOT_PLACE.search(title):
            continue
        # Park names are often area names too, so a park photo title must hold the whole name.
        if kind(p) != "lake" and squash(p["name"]) not in squash(title):
            continue
        if twin and not any(a in title for a in area):
            continue
        flat = squash(title)
        if any(a in flat for a in far_areas(p, nodes)):
            continue
        if (r.get("width") or 0) < 640 or not r.get("foreign_landing_url"):
            continue
        version = r.get("license_version") or ""
        return {
            "src": wiki_thumb(flickr_size(r["url"])),
            "page": r["foreign_landing_url"],
            "author": (r.get("creator") or "Unknown")[:80],
            "license": (LICENSE.get(r["license"], r["license"].upper()) + " " + version).strip(),
            "source": {"flickr": "Flickr", "wikimedia": "Wikimedia Commons"}.get(r["source"], r["source"].title()),
        }
    return None


def run_openverse(places, limit):
    cache = load(OV_CACHE)
    wiki = load(WIKI_CACHE)
    shared = twins(places)
    from build_data import load_area_nodes
    nodes = load_area_nodes()
    todo = [p for p in places if p["id"] not in cache and not wiki.get(p["id"])
            and p["cat"] != "toilet" and key_words(p["name"])]
    order = {"lake": 0, "library": 1}
    todo.sort(key=lambda p: (order.get(p["cat"], 2), -(p.get("reviews") or 0)))
    print(f"{len(todo)} places to check")
    found = 0
    for n, p in enumerate(todo[:limit], 1):
        try:
            ph = openverse_photo(p, shared, nodes)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print("Openverse rate limit reached. Run again later.")
                break
            print("skip", p["id"], e)
            continue
        except Exception as e:  # network hiccup: retry on the next run
            print("skip", p["id"], e)
            continue
        cache[p["id"]] = ph or {}
        found += bool(ph)
        if ph:
            print(f"  {p['name'][:40]:40} {ph['page']}")
        time.sleep(3.5)  # Openverse allows about 20 anonymous requests a minute
        if n % 20 == 0:
            save(OV_CACHE, cache)
    save(OV_CACHE, cache)
    print(f"done: {found} new photos. Cache has {sum(1 for v in cache.values() if v)} photos.")


def birds_near(p):
    url = "https://api.inaturalist.org/v1/observations?" + urllib.parse.urlencode({
        "lat": p["lat"], "lng": p["lng"], "radius": BIRD_RADIUS_KM, "iconic_taxa": "Aves",
        "quality_grade": "research", "photos": "true", "photo_license": "cc-by,cc-by-sa,cc0",
        "order_by": "votes", "per_page": 60, "locale": "en"})
    out, seen = [], set()
    for o in get(url).get("results", []):
        t = o.get("taxon") or {}
        name = t.get("preferred_common_name") or t.get("name")
        photo = next((ph for ph in o.get("photos", []) if ph.get("license_code") in ("cc-by", "cc-by-sa", "cc0")), None)
        if not name or not photo or t.get("id") in seen:
            continue
        seen.add(t.get("id"))
        user = o.get("user") or {}
        out.append({
            "name": name[:1].upper() + name[1:],
            "src": photo["url"].replace("/square.", "/medium."),
            "page": f"https://www.inaturalist.org/observations/{o['id']}",
            "author": (user.get("name") or user.get("login") or "Unknown")[:80],
            "license": {"cc-by": "CC BY", "cc-by-sa": "CC BY-SA", "cc0": "CC0"}[photo["license_code"]],
        })
        if len(out) == BIRDS_PER_PLACE:
            break
    return out


def run_birds(places, limit):
    cache = load(BIRD_CACHE)
    todo = [p for p in places if p["id"] not in cache and
            (p["cat"] == "lake" or re.search(r"lake|kere|tank", p["name"].lower()))]
    print(f"{len(todo)} lakes to check")
    found = 0
    for n, p in enumerate(todo[:limit], 1):
        try:
            cache[p["id"]] = birds_near(p)
        except Exception as e:  # network hiccup: retry on the next run
            print("skip", p["id"], e)
            continue
        found += bool(cache[p["id"]])
        time.sleep(1.1)  # iNaturalist asks for at most one request a second
        if n % 25 == 0:
            save(BIRD_CACHE, cache)
            print(f"  {n} checked, {found} with birds")
    save(BIRD_CACHE, cache)
    print(f"done: {found} lakes with birds. Cache has {sum(1 for v in cache.values() if v)}.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source", choices=["openverse", "birds"])
    ap.add_argument("--limit", type=int, default=100000)
    args = ap.parse_args()
    places = json.loads(PLACES.read_text(encoding="utf-8"))["places"]
    (run_openverse if args.source == "openverse" else run_birds)(places, args.limit)


if __name__ == "__main__":
    main()
