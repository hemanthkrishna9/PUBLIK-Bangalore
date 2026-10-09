# Google Maps timings run, 2026-10-09

Status: **running (4 shards started 2026-10-09 15:30 IST, interim report)**. No CAPTCHA or unusual-traffic page was seen.

Script: `scripts/scrape_google.py` (Playwright, headless Chromium, 4 parallel workers, 5 to 10 s random wait per place, cache saved after every place). Output `raw/google.json` (not in git). Merged by `scripts/build_data.py`.

## Numbers

| | Count |
|---|---|
| Places in places.json | 1801 |
| Places tried | 44 |
| Not yet tried | 1757 |
| Matched (Google place within 250 m and of the right type) | 31 |
| of which found by the category-word fallback search | 28 |
| Matched with weekly timings | 25 |
| of which new timings (place had none before) | 25 |
| Matched with a rating and review count | 31 |
| Permanently closed on Google (dropped by build_data) | 0 |
| No match: nearest result more than 250 m away | 11 |
| No match: nearby result is a different kind of place (office, school, shop) | 2 |
| No result at all | 0 |
| Errors (timeouts, odd pages) | 0 |

## By category

| Category | Tried | Matched | With timings | With rating |
|---|---|---|---|---|
| park | 41 | 29 | 23 | 29 |
| playground | 1 | 1 | 1 | 1 |
| lake | 1 | 0 | 0 | 0 |
| library | 1 | 1 | 1 | 1 |
| toilet | 0 | 0 | 0 | 0 |

## Method notes

- The `?api=1&query=<name> <lat>,<lng>` URL treats the coordinates as search text. A test for a toilet in Indiranagar returned toilets in Tirupati, 300 km away. The script uses `/maps/search/<name>/@<lat>,<lng>,17z` instead, which centres the map on our point so Google ranks nearby results first.
- Distance alone is not enough. In the first 20-place test, two 'matches' within 250 m were a BBMP ward office and a school, because BBMP park names are addresses ('Ward No-174 HSR Layout 24th Cross Park'). The script now also requires Google's category label (Park, Public toilet, Public library, Public bathroom, ...) to fit our category. Otherwise it records `wrongtype`.
- When the name search fails, the script searches once more for the bare category word ('park', 'public toilet', 'lake', 'library', 'playground') at zoom 18 around our point and accepts the nearest result within 250 m of the right type. Such records carry `"via": "category"` and keep the failed first attempt under `first` for auditing.
- When Google shows a result list, the nearest of the first six results is opened, not the first.
- Hours come from the expanded weekly table (`td` text), one row per day. Only the first table is used; a second table on some pages describes a sub-area such as a fountain. Rating and review count come from aria-labels like `4.3 stars` and `1,062 reviews` inside the main panel.
- Collected per place: Google Maps URL, Google name and category, distance, status, rating, review count, weekly hours. No photos, review text or reviewer names.

## Hand check

Five matches were re-opened by their Google Maps URL in a separate browser session and compared with the cache. Name, category, rating and review count agreed for all five. Open these in a normal browser to confirm:

- `bbmp-150` Ward No-175 Btm Layout 4Th Stage, 1St Block (Nightingal Scho -> Raja Ram Mohan Roy Park (Park, 35 m, rating 4.2, 3265 reviews, Friday [['05:00', '10:30'], ['16:00', '20:00']]): https://www.google.com/maps/place/Raja+Ram+Mohan+Roy+Park/data=!4m7!3m6!1s0x3bae14dbdc2b7085:0x27ca7bd21095ed2a!8m2!3d12.8929954!4d77.6142307!16s%2Fg%2F1tf6_cs3!19sChIJhXAr3NsUrjsRKu2VENJ7yic?authuser=0&hl=en&rclk=1
- `osm-w224445485` E-Library -> Basavanagudi MLA Office and E-Library (Public library, 4 m, rating 4.1, 89 reviews, Friday [['08:30', '20:30']]): https://www.google.com/maps/place/Basavanagudi+MLA+Office+and+E-Library/data=!4m7!3m6!1s0x3bae3e26d4b90d29:0x602eeec10766453!8m2!3d12.9372113!4d77.5588664!16s%2Fg%2F124ylf13h!19sChIJKQ251CY-rjsRU2R2EOzuAgY?authuser=0&hl=en&rclk=1
- `osm-w360101201` Childrens play area -> Wood Park Indiranagar (Park, 60 m, rating 4.3, 2114 reviews, Friday [['05:00', '22:00']]): https://www.google.com/maps/place/Wood+Park+Indiranagar/data=!4m7!3m6!1s0x3bae16a35b0635cd:0xb6778ca77a2b0603!8m2!3d12.9795962!4d77.6358929!16s%2Fg%2F124ynds19!19sChIJzTUGW6MWrjsRAwYreqeMd7Y?authuser=0&hl=en&rclk=1
- `bbmp-123` Ward No-174 H S R Layout Sector-1 25Th Main 11Th Crosspark.. -> Twin Park (Park, 24 m, rating 4.3, 1062 reviews, Friday [['05:00', '10:00'], ['16:00', '21:00']]): https://www.google.com/maps/place/Twin+Park/data=!4m7!3m6!1s0x3bae1490c903db67:0x517f5ab19a976544!8m2!3d12.9077615!4d77.640522!16s%2Fg%2F11c4_wncc9!19sChIJZ9sDyZAUrjsRRGWXmrFaf1E?authuser=0&hl=en&rclk=1
- `bbmp-135` Ward No-174 H.S.R Layout Sector-6,7Th Main 15Th Cross Bomana -> Park (Park, 7 m, rating 4.1, 94 reviews, Friday [['06:00', '10:00'], ['16:00', '19:00']]): https://www.google.com/maps/place/Park/data=!4m7!3m6!1s0x3bae149d766422b3:0x3ab6f13a91672250!8m2!3d12.9107962!4d77.652603!16s%2Fg%2F11dxbhpqrw!19sChIJsyJkdp0UrjsRUCJnkTrxtjo?authuser=0&hl=en&rclk=1

## Known limits

- Scraping Google Maps is against Google's terms. The owner accepted this; the run was done on a personal Mac.
- Running four workers at once from one IP raises the chance of a block compared with one worker. The script stops at the first CAPTCHA.
- Timings are what Google shows on the day of the run. Google's hours for small parks are often user-submitted and may be wrong.
- Many BBMP points are rough, so 250 m may exclude correct parks (`nomatch` between 250 and 500 m is worth a second look).
