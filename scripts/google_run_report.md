# Google Maps timings run, 2026-10-09

Status: **finished. Four shards ran 2026-10-09 15:30 to 20:10 IST and tried every place**. No CAPTCHA or unusual-traffic page was seen.

Script: `scripts/scrape_google.py` (Playwright, headless Chromium, 4 parallel workers, 5 to 10 s random wait per place, cache saved after every place). Output `raw/google.json` (not in git). Merged by `scripts/build_data.py`.

## Numbers

| | Count |
|---|---|
| Places in the catalogue the scrape ran against (build of 62b8c63) | 1801 |
| Places tried | 1801 |
| Not tried | 0 |
| Places in places.json after the current build (269215f drops BBMP parks at shared points) | 1605 |
| Matches whose place is no longer in places.json | 207 |
| Records merged into places.json by build_data.py (`google records merged`) | 1099 |
| Matched (Google place within 250 m and of the right type) | 1357 |
| of which found by the category-word fallback search | 465 |
| Matched with weekly timings | 805 |
| of which new timings (place had none before) | 562 |
| Matched with a rating and review count | 1285 |
| Permanently closed on Google (dropped by build_data) | 8 |
| No match: nearest result more than 250 m away | 313 |
| No match: nearby result is a different kind of place (office, school, shop) | 111 |
| No result at all | 2 |
| Errors (timeouts, odd pages) | 18 |

## By category

| Category | Tried | Matched | With timings | With rating |
|---|---|---|---|---|
| park | 995 | 806 | 553 | 764 |
| playground | 66 | 48 | 26 | 43 |
| lake | 188 | 110 | 8 | 106 |
| library | 97 | 64 | 54 | 61 |
| toilet | 455 | 329 | 164 | 311 |

## Method notes

- The `?api=1&query=<name> <lat>,<lng>` URL treats the coordinates as search text. A test for a toilet in Indiranagar returned toilets in Tirupati, 300 km away. The script uses `/maps/search/<name>/@<lat>,<lng>,17z` instead, which centres the map on our point so Google ranks nearby results first.
- Distance alone is not enough. In the first 20-place test, two 'matches' within 250 m were a BBMP ward office and a school, because BBMP park names are addresses ('Ward No-174 HSR Layout 24th Cross Park'). The script now also requires Google's category label (Park, Public toilet, Public library, Public bathroom, ...) to fit our category. Otherwise it records `wrongtype`.
- When the name search fails, the script searches once more for the bare category word ('park', 'public toilet', 'lake', 'library', 'playground') at zoom 18 around our point and accepts the nearest result within 250 m of the right type. Such records carry `"via": "category"` and keep the failed first attempt under `first` for auditing.
- When Google shows a result list, the nearest of the first six results is opened, not the first.
- Hours come from the expanded weekly table (`td` text), one row per day. Only the first table is used; a second table on some pages describes a sub-area such as a fountain. Rating and review count come from aria-labels like `4.3 stars` and `1,062 reviews` inside the main panel.
- Collected per place: Google Maps URL, Google name and category, distance, status, rating, review count, weekly hours. No photos, review text or reviewer names.

## Hand check

Seven matches were re-opened by their Google Maps URL in a separate headless browser session and compared with the cache: the five below plus `bbmp-123` (Twin Park) and `bbmp-135` (Park, HSR Sector 6), which the current build drops. Name, category, rating and review count agreed for all seven. The owner should still open these five in a normal browser to confirm:

- `bbmp-150` Ward No-175 Btm Layout 4Th Stage, 1St Block (Nightingal Scho -> Raja Ram Mohan Roy Park (Park, 35 m, rating 4.2, 3265 reviews, Friday [['05:00', '10:30'], ['16:00', '20:00']]): https://www.google.com/maps/place/Raja+Ram+Mohan+Roy+Park/data=!4m7!3m6!1s0x3bae14dbdc2b7085:0x27ca7bd21095ed2a!8m2!3d12.8929954!4d77.6142307!16s%2Fg%2F1tf6_cs3!19sChIJhXAr3NsUrjsRKu2VENJ7yic?authuser=0&hl=en&rclk=1
- `osm-w224445485` E-Library -> Basavanagudi MLA Office and E-Library (Public library, 4 m, rating 4.1, 89 reviews, Friday [['08:30', '20:30']]): https://www.google.com/maps/place/Basavanagudi+MLA+Office+and+E-Library/data=!4m7!3m6!1s0x3bae3e26d4b90d29:0x602eeec10766453!8m2!3d12.9372113!4d77.5588664!16s%2Fg%2F124ylf13h!19sChIJKQ251CY-rjsRU2R2EOzuAgY?authuser=0&hl=en&rclk=1
- `osm-w360101201` Childrens play area -> Wood Park Indiranagar (Park, 60 m, rating 4.3, 2114 reviews, Friday [['05:00', '22:00']]): https://www.google.com/maps/place/Wood+Park+Indiranagar/data=!4m7!3m6!1s0x3bae16a35b0635cd:0xb6778ca77a2b0603!8m2!3d12.9795962!4d77.6358929!16s%2Fg%2F124ynds19!19sChIJzTUGW6MWrjsRAwYreqeMd7Y?authuser=0&hl=en&rclk=1
- `bbmp-153` Ward-175 Bommanahalli B.T.M. Layout 4Th Stage And 1Nd And 2N -> Car Park (Park, 6 m, rating 4.4, 3723 reviews, Friday [['05:00', '09:00'], ['17:00', '20:00']]): https://www.google.com/maps/place/Car+Park/data=!4m7!3m6!1s0x3bae14d7aa87dded:0xa92093440d6dbed1!8m2!3d12.8866295!4d77.6113952!16s%2Fg%2F11d_77cvkq!19sChIJ7d2HqtcUrjsR0b5tDUSTIKk?authuser=0&hl=en&rclk=1
- `bbmp-154` Ward No-175 Bommanahalli Btm Layout 4Th Stage Opposite Rto O -> Bande Park (Park, 3 m, rating 4.4, 1614 reviews, Friday [['05:00', '10:00'], ['16:30', '20:00']]): https://www.google.com/maps/place/Bande+Park/data=!4m7!3m6!1s0x3bae14d13e346c3f:0xcd833c89e2ed79dc!8m2!3d12.8843162!4d77.6180035!16s%2Fg%2F11hbv3fgck!19sChIJP2w0PtEUrjsR3Hnt4ok8g80?authuser=0&hl=en&rclk=1

## Known limits

- Scraping Google Maps is against Google's terms. The owner accepted this; the run was done on a personal Mac.
- Running four workers at once from one IP raises the chance of a block compared with one worker. The script stops at the first CAPTCHA.
- Timings are what Google shows on the day of the run. Google's hours for small parks are often user-submitted and may be wrong.
- Many BBMP points are rough, so 250 m may exclude correct parks (`nomatch` between 250 and 500 m is worth a second look).
- The 18 error records are places where Google's page did not settle into a recognised state within 25 s. Retry them with `python3 scripts/scrape_google.py --ids <id> ...` after deleting their entries from raw/google.json.
- 207 matched places are not in places.json because the build from commit 269215f drops BBMP parks that share a point. Their records stay in raw/google.json and will merge if those parks come back with better coordinates.
- The rebuild on this Mac used raw/photos.json reconstructed from the photos already in places.json (56), since wikimedia_photos.py was not run here.
