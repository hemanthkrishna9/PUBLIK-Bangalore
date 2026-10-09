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

## Update 2026-10-09 (late night)

- New look: black header, five-color category stripe, flat cards, line pictograms, Kannada category names. Share image, canonical, Open Graph, JSON-LD, robots.txt and sitemap.xml added.
- Surprise me: picks a well-rated place that is open now, near you when location is on. Toilets are left out unless the Toilets filter is on.
- One-tap reports (Clean, Dirty, Crowded, Quiet, Open now, Closed now) through `src/worker.js` and the D1 database `publik` (schema in `src/schema.sql`). Open, Closed, Crowded and Quiet show for 3 hours, Clean and Dirty for 48 hours. "Closed now" shows only after 2 reports. Limits: 2,000 reports a day in total, 50 per place a day, one per kind per place every 30 minutes per visitor.
- Privacy: the visitor key is a hash of the IP with a random salt that changes every day. Old salts are deleted, and keys are cleared after 24 hours. No raw IPs are stored.
- On this laptop, `wrangler d1 execute --file` fails behind Zscaler. Use `--command` with the SQL instead.

## Update 2026-10-09 (BBMP 2016 parks)

- Added 281 parks from "BBMP Parks 2016" (OpenCity, data.opencity.in/dataset/bangalore-parks-and-playgrounds, no license stated). Total: 1,886 places.
- Check: 62% of the 1,272 points in the 2016 file land on or within 40 m of a park mapped in OpenStreetMap, against 69% for the current BBMP list. Only points on a mapped park that PUBLIK does not list yet were added. 478 were off any mapped park, and 513 were already listed.
- The file is in git (`raw/bbmp_parks_2016.csv`, no phone numbers). The park shapes are not: run `python -I scripts/fetch_park_shapes.py` before a full build, or the full build leaves out the 2016 parks.
- This laptop has no `raw/google.json`, so the parks were added with `python -I scripts/build_data.py --append-2016`, which keeps the Google data. The new parks have no Google timings yet. Run the Google scrape on the Mac for ids that start with `bbmp16-`.
- The other two OpenCity files only count parks and playgrounds per ward, with no locations.

## Update 2026-10-09 (soft launch)

- The owner posted PUBLIK in the SBA WhatsApp group on 2026-10-09, with a short personal note and credit to Arka for the idea. This is a soft launch to collect feedback before a wider post (for example r/bangalore).
- The idea came from Arka in the St. Broseph Indiranagar chapter WhatsApp group. A Reddit post for r/bangalore is drafted (casual, credits that group, honest about rough data). The owner posts it from their own account after checking the subreddit rules.
- Before the Reddit post, do the first three open items (saved-report message, privacy note, analytics), because Reddit can bring far more visitors.
- Next step: wait for suggestions from the group. If none come, continue with the open items below.

### Open items

- [ ] Make the report message name what was saved ("Saved: Clean") and add space between the tap buttons. One "Clean" tap at Doddanekundi Lake Park was stored as "Quiet", most likely a mis-tap.
- [ ] Turn on Worker request logs (`observability`) so lost reports can be traced.
- [ ] Add a one-line privacy note under the report buttons (anonymous, no IP addresses stored).
- [ ] Add Cloudflare Web Analytics (free, no cookies) to measure visits.
- [ ] Clean up repeated and address-like names (for example two "Childrens play area" rows in Indiranagar).
- [ ] Owner: open the five hand-check links in `scripts/google_run_report.md`.
- [ ] Mac: run the Google scrape for the 281 `bbmp16-` parks; run `scripts/fetch_park_shapes.py` before any full rebuild.
- [ ] Possible new tap buttons from Arka's reading list: "Well lit", "Feels safe", "Step-free".
- [ ] Read the r/bangalore thread "Bangalore needs more public spaces" (Reddit blocks the work laptop; needs screenshots) and the "Evolution of public spaces of Bengaluru" paper (needs the PDF).
- [ ] Later: verified-neighbor profiles and community events (Nextdoor model), never live location of people.


## Update 2026-10-10 (session end)

- New look deployed: green header, category icons, card rows, status badges, Plus Jakarta Sans font.
- Photos: `scripts/wikimedia_photos.py` finds free Wikimedia Commons photos (title must name the place and include a category word, within 500 m). 56 places have a photo, loaded from Wikimedia's servers with credit. Results are in `raw/photos.json`.
- Every place card has a "See photos and reviews on Google Maps" link. It uses the Google URL from the scrape when there is one.
- Google timings: the Mac session runs `scripts/scrape_google.py` (interim: 44 tried, 31 matched, 25 new timings, no CAPTCHA). It must `git pull --rebase` before its final build, then push `docs/data/places.json`. After that push, pull here and run `npx wrangler deploy`.
- Deploys are done with `npx wrangler deploy` from the work laptop. Git auto-deploy is still not connected.

Next session:
1. Pull the Mac results, check `scripts/google_run_report.md`, and deploy.
2. Recover the 671 BBMP parks without coordinates (`scripts/geocode_bbmp.py` exists, but only accept leisure/park matches).
3. A report form that needs no GitHub account.
4. Decide whether to remove the Cloudflare account ID from git history (commit d33a926).
