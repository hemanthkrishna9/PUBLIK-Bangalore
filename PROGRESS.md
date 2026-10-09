# PUBLIK progress

Last updated: 2026-10-09

## Status

Version 1 is live at https://publik.nxtduo.com. It was deployed with `wrangler deploy` from the work laptop on 2026-10-09. Auto-deploy on push is not on yet. The Cloudflare project must be connected to the repo one time (see the checklist). Until then, run `npx wrangler deploy` after each push.

| Item | State |
|---|---|
| Static site (list, search, category filter, near me, open now, place card, map, directions, report link) | Done |
| Data build script (`scripts/build_data.py`) | Done |
| GitHub repo (github.com/hemanthkrishna9/PUBLIK-Bangalore) | Done |
| Cloudflare configuration (`wrangler.jsonc`, route publik.nxtduo.com) | Done |
| Cloudflare project connected to the repo (auto-deploy on push) | Open |
| Site live at https://publik.nxtduo.com | Done (DNS resolves to Cloudflare; office Zscaler blocks it, so check from a phone) |
| Embedded map tested on a real phone | Open |
| Daily timings, Google rating, sort switch (Timings known / Nearest / Most popular) | Done, deployed |
| Google Maps timings scrape (`scripts/scrape_google.py`, run on the Mac) | Done, deployed 2026-10-09 (see `scripts/google_run_report.md`) |

## Data in version 1

| Category | Places | With timings |
|---|---|---|
| Parks | 995 | 398 |
| Playgrounds | 66 | 0 |
| Lakes | 188 | 1 |
| Libraries | 97 | 2 |
| Public toilets | 455 | 3 |
| Total | 1,801 | 404 |

Sources: the BBMP park list (OpenCity KML) and OpenStreetMap (Overpass export, 2026-10-09).

Known data problems:

- The BBMP list has 1,282 parks, but only 496 have usable coordinates. 671 rows have missing or wrong coordinates, and 115 rows share placeholder points. The script drops these rows.
- BBMP timings can be out of date. A 2024 order set 5 am to 10 pm, but reports say that most parks did not follow it. Lalbagh and Cubbon Park are under the Horticulture department and are not in the list.
- OpenStreetMap has almost no timings for Bengaluru (4% of parks, 8% of libraries).
- Some BBMP park names are long or messy, because the source names describe maintenance work.

## Decisions

- 2026-10-09: The Google Places API is not used as the catalogue. Google's terms forbid use "in a listings or directory service" and forbid point-in-polygon analysis on Places coordinates. An Opus planner and an Opus critic reviewed this. The text of the terms was checked.
- 2026-10-09: The owner plans to add timings scraped from Google Maps later. The owner accepts the risk. Scraping must run from a personal machine, not the work laptop. Scraped data must use the `make_place()` record shape. No Google photos and no Google reviews will be copied.
- 2026-10-09: The owner wants Google timings and review counts now, through the Places API (`scripts/google_hours.py`). Google timings fill only places without timings. Review counts drive the Most popular sort. BBMP park size is the fallback.
- 2026-10-09: No pictures in version 1. Later options: Wikimedia Commons (with credit), own photos, user uploads.
- 2026-10-09: The raw BBMP file stays out of git, because it contains contractor names and phone numbers.
- 2026-10-09: The site is hosted as a Cloudflare Worker with static assets at publik.nxtduo.com, the same pattern as nxtduo.com.

## Checklist

### Turn on auto-deploy (one time, in the Cloudflare dashboard)

1. Open Workers & Pages, then the `publik` Worker, then Settings, then Builds, then Connect.
2. Select the repo `hemanthkrishna9/PUBLIK-Bangalore`.
3. Select the branch `main`. Leave the build command empty. Keep the deploy command `npx wrangler deploy`.
4. Save, then push a small change and make sure that the GitHub commit gets a check mark.

### Next work

- [ ] Recover the 671 BBMP parks without coordinates (match by name and ward to OpenStreetMap).
- [ ] Clean up long BBMP park names.
- [ ] Add timings for the most used parks, libraries and toilets.
- [ ] Retry the 18 Google scrape errors, and review the `nomatch` places between 250 m and 500 m.
- [ ] Decide whether to rewrite git history to remove `.wrangler/cache/wrangler-account.json` (Cloudflare account ID and account name) from commit d33a926. It is no longer tracked.
- [ ] Share the site with the friend and collect changes.
- [ ] Look at the BBMP lakes and parks apps as competitors.
- [ ] Later: crowd signal ("busy / quiet" taps), photos, Kannada.

## Update 2026-10-09 (evening)

- Deployed fixes from a site review: the Back button closes the card, "tomorrow" appears in closed status, Free and Accessible filters, and better dark-mode contrast.
- Data: 1,613 places. BBMP parks that shared a point with another park are dropped (349), because their pins were wrong. Parks with timings went from 398 to 228 as a result.
- Every place now has its nearest neighbourhood as its area (1,336 filled). Unnamed toilets are named "Public toilet, <area>".
- The OpenStreetMap timings parser handles 53 of 57 formats.
- Open: Google timings through the Mac session (prompt given to the owner), recovering 671 BBMP parks without coordinates, and a report form that needs no GitHub account.

## Update 2026-10-09 (night)

- The Mac session scraped Google Maps for all 1,801 places (commit 62c9f00). 1,099 records merged into places.json. 766 places now have timings and 1,089 have a Google rating.
- Deployed with `wrangler deploy` from the work laptop (version 975a77d3). Wrangler needs `NODE_OPTIONS=--use-system-ca` here because of the Zscaler certificate.
- The owner must open the five hand-check links in `scripts/google_run_report.md` in a normal browser.
