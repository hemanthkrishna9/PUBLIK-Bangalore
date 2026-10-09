"""Find free, credited photos on Wikimedia Commons for places in docs/data/places.json.

A photo is accepted only if its file title contains the distinctive words of the
place name (for example "Madiwala" for "Madiwala Lake") and it was taken within
RADIUS_M of the place. The site loads the image from Wikimedia's servers, so
PUBLIK serves no image files. Results are cached in raw/photos.json.

Usage: python scripts/wikimedia_photos.py [--limit N]
"""
import argparse
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLACES = ROOT / "docs" / "data" / "places.json"
CACHE = ROOT / "raw" / "photos.json"
API = "https://commons.wikimedia.org/w/api.php"
UA = "PUBLIK-Bengaluru/0.1 (https://github.com/hemanthkrishna9/PUBLIK-Bangalore)"
RADIUS_M = 500
# Words that do not identify a place on their own.
GENERIC = set("""park parks garden lake kere tank playground play ground library public toilet toilets
layout stage block main cross road nagar nagara the of and near opp bbmp ward sector phase
bengaluru bangalore new old big small children childrens city central branch""".split())


CAT_WORDS = re.compile(r"lake|kere|tank|park|garden|udyana|vana|library|playground")


def api(params):
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json"})
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def key_words(name):
    words = re.findall(r"[a-z]{4,}", name.lower())
    return [w for w in words if w not in GENERIC]


def find_photo(p):
    words = key_words(p["name"])
    if not words:
        return None
    res = api({"action": "query", "list": "geosearch", "gscoord": f"{p['lat']}|{p['lng']}",
               "gsradius": RADIUS_M, "gsnamespace": 6, "gslimit": 50})
    for g in sorted(res.get("query", {}).get("geosearch", []), key=lambda g: g["dist"]):
        title = g["title"].lower()
        if not re.search(r"\.(jpe?g|png|webp)$", title):
            continue
        # The title must name the place and say what it is, so photos of a
        # village temple or a bus stop with the same village name are rejected.
        if all(w in title for w in words[:2]) and CAT_WORDS.search(title):
            return g["title"]
    return None


def photo_info(title):
    res = api({"action": "query", "titles": title, "prop": "imageinfo",
               "iiprop": "url|extmetadata", "iiurlwidth": 720})
    page = next(iter(res["query"]["pages"].values()))
    ii = page["imageinfo"][0]
    meta = ii.get("extmetadata", {})
    artist = re.sub(r"<[^>]+>", "", meta.get("Artist", {}).get("value", "")).strip() or "Unknown"
    return {
        "src": ii["thumburl"],
        "page": ii["descriptionurl"],
        "author": artist[:80],
        "license": meta.get("LicenseShortName", {}).get("value", ""),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=100000)
    args = ap.parse_args()
    places = json.loads(PLACES.read_text(encoding="utf-8"))["places"]
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    todo = [p for p in places if p["id"] not in cache and p["cat"] != "toilet" and key_words(p["name"])]
    order = {"lake": 0, "library": 1, "playground": 3}
    todo.sort(key=lambda p: (order.get(p["cat"], 2 if p["src"] == "osm" else 4)))
    print(f"{len(todo)} places to check")
    found = 0
    for n, p in enumerate(todo[: args.limit], 1):
        try:
            title = find_photo(p)
            cache[p["id"]] = photo_info(title) if title else {}
            found += bool(title)
        except Exception as e:  # network hiccup: skip, retry on the next run
            print("skip", p["id"], e)
        time.sleep(0.5)
        if n % 50 == 0:
            CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
            print(f"  {n} checked, {found} photos")
    CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    print(f"done: {found} photos found. Cache has {sum(1 for v in cache.values() if v)} photos.")


if __name__ == "__main__":
    main()
