"""Download park, garden and playground shapes for Bengaluru from OpenStreetMap (Overpass).

build_data.py uses them to check that BBMP 2016 park points land on a real park.
Output: raw/osm_park_shapes.json (about 4.5 MB). Data (c) OpenStreetMap contributors, ODbL.

Run: python -I scripts/fetch_park_shapes.py   (from W:/apps/publik)
"""
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "raw" / "osm_park_shapes.json"
BBOX = "12.75,77.35,13.25,77.85"
QUERY = (f'[out:json][timeout:180];(way[leisure~"^(park|playground|garden|pitch|recreation_ground)$"]({BBOX});'
         f'relation[leisure~"^(park|garden)$"]({BBOX}););out geom;')

req = urllib.request.Request("https://overpass-api.de/api/interpreter",
                             data=urllib.parse.urlencode({"data": QUERY}).encode(),
                             headers={"User-Agent": "PUBLIK-Bengaluru/0.1 (https://github.com/hemanthkrishna9/PUBLIK-Bangalore)"})
OUT.write_bytes(urllib.request.urlopen(req, timeout=300).read())
print("wrote", OUT, OUT.stat().st_size, "bytes")
