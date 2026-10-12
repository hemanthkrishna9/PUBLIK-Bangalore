# PUBLIK progress

Last updated: 2026-10-12

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

## Update 2026-10-10 ("I went here")

- New section on every place card except toilets: "Going for the first time?". It shows what past visitors said, for people who are anxious about a first visit. The idea came from Arka: "activate a public space" for people who never go.
- A visitor taps "I went here" and answers up to three questions with taps: "Could you just walk in?", "How did it feel?" and "Easy for a first-timer?". The card shows the most common answer per question, for example "Anyone can walk in (4 of 5)".
- API: `GET /api/visits?place=` and `POST /api/visit` in `src/worker.js`, table `visits` in `src/schema.sql`. Limits: one visit per visitor per place a day, 20 per place a day, 1,000 a day in total. Rows are kept 365 days. Visitor keys use the same daily-salted hash as reports and are cleared after 24 hours.
- No photos yet. If people use this, the next step is an optional photo with a no-faces rule and manual approval.
- Fix: buttons with the `hidden` attribute now hide (this also affects "Show 50 more").
- The `visits` table was created on the remote database with `wrangler d1 execute publik --remote --command "<SQL>"`, because `--file` fails behind Zscaler.
- Deployed 2026-10-10 (version 892f06ae), commit 4f183b6. Not yet checked on a phone.
- Why taps and not photos first: the anxiety is about not knowing what happens inside (ID, silence, staring), and a photo does not answer that. Photos of parks and playgrounds show children and faces, so they need a no-faces rule and manual approval under the DPDP Act. Taps take 5 seconds, so they test cheaply whether people will post at all. The one-line version was sent to Arka.

## Update 2026-10-10 (Bengawalk outreach)

- Arka suggested contacting Bengawalk (bengawalk.com), a Bengaluru team of designers and filmmakers. Their work overlaps with PUBLIK: parks for children, public seating, lakes, Namma Raste and a Living Lab.
- Their site lists no email. Contact options: Instagram DM (instagram.com/bengawalk), X (x.com/bengawalk) or their project form. The owner chose an Instagram DM. A casual draft that credits Arka is ready.
- The expected outcome is feedback or a share, not a joint build.

### Open items

- [ ] Owner: tap "I went here" on one or two known places from a phone, so the section is not empty when Bengawalk looks.
- [ ] Owner: send the Bengawalk Instagram DM, then note any reply here.
- [ ] Watch "I went here" use for two weeks (until 2026-10-24). If people use it, plan the optional photo step. If not, rethink the questions or the placement on the card.
- [ ] The open items from the soft launch section still apply (saved-report message, privacy note, analytics) before any wide post.

## Update 2026-10-10 (map view)

- A Reddit commenter on the r/bangalore post (19 upvotes, about 4K views) asked for a map view "or both views". There is now a List and Map switch above the results. List stays the default, and the choice is remembered on that device.
- The map uses the same search, category and filters as the list. Nearby pins group into numbered circles. Tapping a pin opens the usual place card. With location on, a blue dot shows the visitor.
- Leaflet 1.9.4 and Leaflet.markercluster 1.5.3 load from cdnjs only when someone opens the map.
- Tiles: tile.openstreetmap.org, with no API key and no bill. Its usage policy allows only light use. CARTO tiles now return "API key required" (checked 2026-10-10). If traffic grows, move to OpenFreeMap or a paid tile host. Dark mode darkens the light tiles with a CSS filter.
- Why not a Google map: it needs an API key on a billing account, and charges after the free monthly quota. The place card map and Directions still use Google.
- Fix: the "I went here" answer buttons used the class `chip`, which the category chips also use. Picking a category changed them too. They now use `pick`.
- Above the map, a hint says "Numbers are groups of places. Tap one to zoom in.", with a color key. Each group has a ring split by the categories inside it.
- Next from feedback: Arka's "live activity" carousel on the home page. It must hide itself when there are fewer than about five recent items.

## Update 2026-10-10 (Happening around Bengaluru)

- Arka asked for "live view of most recent activity in public spaces", in cards or a carousel, as the first thing visitors see, for stickiness. He gave the wording: "Someone marked Doddanekundi as clean 2 mins back".
- The home page now has a sideways row of cards under Surprise me. Each card is one sentence, for example "Someone checked into RT Nagar Public Library and marked it crowded", with the time and area. Tapping a card opens the place.
- API: `GET /api/activity` in `src/worker.js`. It merges fresh one-tap reports (same visible times as the place card, "Closed now" only after two reports) with the newest "I went here" visit per place from the last 7 days. It returns at most 15 items. The row hides when there are none.
- Owner and Arka: ask SBA friends to tap when they really visit a place, so the row has real content.

## Update 2026-10-10 (traffic)

- `scripts/traffic.py` reads Cloudflare analytics and splits out bots (link previews, crawlers, scanners). The command is at the top of the file. The free plan keeps only about 3 days of this data.
- First two days: about 200 people (distinct IPs, bots removed), 157 from India. Peaks: the SBA WhatsApp post (9 Oct, 2 pm IST) and the Reddit post (9 Oct, 10 pm IST). 222 place cards opened, but only 12 one-tap reports and 4 "I went here". The gap between looking and tapping is the main problem now.
- About 350 "Not found" requests are automated hacking scans (`/.env`, `/.git`, `phpinfo.php`, `/CLAUDE.md`). Nothing sensitive is served.
- Missing `favicon.ico` and `apple-touch-icon.png`: phones ask for them, so add them.
- Arka's open ideas (not built): day-trip and cycling collections, tour operators and invites, a donate button with GBA, an Instagram page. Also check the "PUBLIK" name, because publikhq.com is an unrelated software company with the same name.

## Update 2026-10-10 (Google Maps style card and locate button)

- The Reddit commenter tested the map and asked for two things: show the user's location, and copy the Google Maps card with three states (minimized, half, full).
- The map has a labeled "My location" button at the bottom right (an unlabeled icon was easy to miss). It shows a blue dot and centers on you, using the same location as "Near me". If the visitor already allowed location, the dot appears by itself when the map opens.
- The place card has three heights: peek (name, status and a Directions button), half and full. Drag the top part of the card, or tap the handle. On the map, a pin opens the card at half height with no dark backdrop, and the map pans so the pin stays visible. Tapping another pin swaps the card. In the list, the card opens at full height, and dragging it down closes it. On desktop, the list card stays a centered dialog.
- Fixes: with location on, a search on the map stayed on you instead of moving to the result. With cluster animation on, a pin could stay hidden after a one-level zoom, so the animation is off. After the phone Back button closed a card, the next card closed with X kept its #id in the URL. That is now cleared.
- Must be checked on a real phone: the drag feel on Android and iPhone.

## Update 2026-10-11 (playgrounds for parents of toddlers)

- A mother of a toddler on the r/bangalore post asked for three things: a way to say a playground is under maintenance, safety of the equipment and the ground for toddlers, and indoor playgrounds.
- "Under repair" and "Repair done" taps on parks and playgrounds. "Under repair" lasts 14 days and shows only after two reports, as a brick-red notice at the top of the card (it shows in the small strip too). A newer "Repair done" clears it.
- Playgrounds and parks with a play area (66 + 124) ask "Good for toddlers?", "How is the equipment?" and "What is the ground?" in "I went here", under the heading "For little kids". The card shows three tiles with the most common answer, colored good, care or bad. On a tie, it shows the more careful answer. Ground answers have material swatches (sand, grass, rubber mat, hard or rubble).
- Database: `visits` has three new columns (equip, ground, toddler), added to the live database on 2026-10-11.
- Indoor playgrounds are not added. Most are paid, and PUBLIK is about free places. Possible later with a "Paid" tag, if OpenStreetMap has enough of them (not checked).
- Playgrounds are the weakest data (66 places, no timings). Improve them if parents become a core audience.

## Update 2026-10-11 (traffic and session end)

- People per day (distinct IPs, bots removed): about 165 on 10 Oct, the day after the Reddit post, and 97 on 11 Oct by 9:37 pm IST. The 11 Oct peak was 6 pm IST. The drop is normal after one Reddit post. Mobile networks share IP addresses, so these counts are a little low.
- Last 24 hours at 9:37 pm IST: 184 place cards opened, 14 one-tap reports, 4 "I went here", 156 activity row loads. Visitors open about two cards each.
- Live database, all time: 31 one-tap reports and 11 "I went here" answers. Nobody used the playground questions or "Under repair" yet. No new "I went here" answer came in on 11 Oct.
- 404 requests stay at 150 to 300 a day. They are the same automated scans as before.
- Arka asked what the backend is. He got this answer: a Cloudflare Worker and a D1 (SQLite) database, with no logins and places from OpenStreetMap. He wants to meet for coffee and keep contributing.
- The scheduled traffic check (3 times a day) stops when this session closes. To run it again, use the command at the top of `scripts/traffic.py`.
- Next: reply to the toddler mother on Reddit, then Arka's Instagram post, the Bengawalk message and apartment or parents' WhatsApp groups. Without a new push, traffic will keep falling.

## Update 2026-10-12 (photo strip)

- Arka said that the landing page needs images to catch attention, and that people should be able to post a photo with any text (a poem, an experience, a dirty spot).
- Decision: photos on the landing page now, user photo posts later. Open uploads need a review step before posts appear, and with about 100 visitors a day a post wall stays empty. A future post must belong to one place and must hide faces and photo location data.
- Done: a "Places to see" strip under the hero. It shows 18 well-known places with Wikimedia Commons photos, in a random order on each visit. Each photo shows the author and license. A tap opens the place card. The list of places is `PICS` in `docs/app.js`.
- Left out on purpose: photos that do not match the place (Christ University Library shows a lake, Doddabommasandra shows a sewage plant, Iblur shows pollution).

## Update 2026-10-12 (more photo sources)

- New script `scripts/open_photos.py` with two sources. All four APIs (Openverse, iNaturalist, Flickr, Mapillary) answer through Zscaler.
- Openverse (Flickr and other open collections, no key): only CC BY, CC BY-SA, CC0 and public domain. It has no location search, so the title must name the place, its kind and Bangalore. Titles that name a neighbourhood more than 4 km away are rejected, because that is a same-name place (two Puttenahalli lakes).
- Run 1 checked 450 places and found 12 photos, because most famous places already had a Wikimedia photo. Five were wrong (Manyata tech park, a juice glass, a post office, two other parks) and were removed by hand. Park titles must now hold the full park name, and office, shop, temple and similar titles are rejected. 7 photos are live: Begur Lake, Begur Kere, Anchepalya, Sompura, Varthur, Bellandur, National Military Memorial.
- iNaturalist birds: research-grade bird photos (CC BY, CC BY-SA, CC0) within 600 m of each lake. 64 lakes and lake parks with 2 or more birds now show "Birds seen here" on the card. Hebbal has none, because its center is far from the shore.
- Merge with `python scripts/build_data.py --photos` (no full rebuild). Caches are `raw/photos_openverse.json` and `raw/birds.json`.
- Not done: Mapillary (needs a free token from a Mapillary login), the rest of the Openverse list (about 790 places, run with `open_photos.py openverse`), and a larger bird radius for big lakes.
- Session closed 2026-10-12. Next: get a Mapillary token if wanted, finish the Openverse run, then push the site again (Reddit, Instagram, WhatsApp). User photo posts stay on hold until traffic grows.
