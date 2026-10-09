# PUBLIK Bengaluru

PUBLIK is a free website that lists public spaces in Bengaluru with their timings and directions. It covers parks, playgrounds, lakes, libraries and public toilets.

The site is static. It has no server and no API key. All data is in one file, `docs/data/places.json`.

## Data sources

| Source | What it gives | License |
|---|---|---|
| [BBMP park list via OpenCity](https://data.opencity.in/dataset/bbmp-parks) (`Map of Parks Under BBMP` KML) | Park names, wards, timings, amenities | Check the OpenCity resource page |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) through the Overpass API | Parks, playgrounds, lakes, libraries, toilets | ODbL, attribution required |

The BBMP file has errors. About half of its rows have missing or wrong coordinates. The build script repairs two common typo patterns and drops the rows that it cannot repair. Timings in the BBMP list can be out of date, so the site shows the source next to every timing.

## Build the data

The `raw/` folder is not in git. The BBMP file contains contractor names and phone numbers, and the site does not publish them.

1. Download the BBMP parks KML into `raw/parks_under_bbmp.kml`:

   ```
   curl -o raw/parks_under_bbmp.kml https://data.opencity.in/dataset/bebaa2e8-cb85-4be2-a084-4927943513a9/resource/6f452b1e-bc2d-4fba-ad5b-c788421022ad/download/fc81d343-44f1-4adf-944d-29224f7dc19d.kml
   ```

2. Download the OpenStreetMap data into `raw/osm.json`. Use the query in `scripts/overpass_query.txt`:

   ```
   curl -A "publik" --data-urlencode data@scripts/overpass_query.txt https://overpass-api.de/api/interpreter -o raw/osm.json
   ```

   If the Overpass server is busy, it returns an error page. Run the command again after a few minutes.

3. Build the data file:

   ```
   python scripts/build_data.py
   ```

## Run the site locally

```
cd docs
python -m http.server 8000 --bind 127.0.0.1
```

Open http://127.0.0.1:8000 in a browser.

## Add a new data source

Any new source must produce records in the same shape as `make_place()` in `scripts/build_data.py`. Add the records in `main()` before the dedupe step.

## Report wrong information

Each place has a "Report wrong information" link. It opens a GitHub issue with the place ID filled in.
