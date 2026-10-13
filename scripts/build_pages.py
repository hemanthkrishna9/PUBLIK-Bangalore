#!/usr/bin/env python3
"""Build the static search-engine pages for PUBLIK from docs/data/places.json.

Writes (all under docs/):
  parks/ playgrounds/ lakes/ libraries/ public-toilets/   one page per category
  area/<slug>/                                            one page per area with enough places
  place/<slug>/                                           one page per place
  404.html, pages.css, sitemap.xml, llms.txt
and refreshes the link block between the seo-links markers in docs/index.html.

Plain Python 3, standard library only. The same data gives the same files:
no clock, no random. Run:  python scripts/build_pages.py
"""
import hashlib
import html
import json
import math
import re
import shutil
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
SITE = "https://publik.nxtduo.com"
MIN_AREA_PLACES = 4      # an area gets its own page from this many places
TOP_AREAS_HOME = 30
NEARBY_PLACES = 5
NEARBY_AREAS = 6
PHOTO_RULES_LASTMOD = "2026-10-12"

# cat id -> (slug, singular, plural, schema.org type)
CATS = {
    "park": ("parks", "park", "Parks", "Park"),
    "playground": ("playgrounds", "playground", "Playgrounds", "Playground"),
    "lake": ("lakes", "lake", "Lakes", "LakeBodyOfWater"),
    "library": ("libraries", "library", "Libraries", "Library"),
    "toilet": ("public-toilets", "public toilet", "Public toilets", "PublicToilet"),
}
CAT_ORDER = ["park", "playground", "lake", "library", "toilet"]
SRC_LABEL = {"bbmp": "BBMP park list", "bbmp16": "BBMP park list 2016", "osm": "OpenStreetMap"}
DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
MON_FIRST = [1, 2, 3, 4, 5, 6, 0]

# Area names that are one place written two ways. Spelling variants only, nothing guessed.
ALIAS = {"btm": "btmlayout", "bagalakunte": "bagalagunte", "banaswadi": "banasavadi", "begur": "beguru"}
DISPLAY = {"hsrlayout": "HSR Layout", "krpuram": "KR Puram", "btmlayout": "BTM Layout"}
SUB_RE = re.compile(r"^(.*?)\s+\d+(?:st|nd|rd|th)\s+(?:Block|Stage|Phase)$")

FILLERS = [
    "Timings can change, so check at the place.",
    "Free to browse, with directions on PUBLIK.",
    "Find directions and nearby places.",
    "Details come from public sources.",
    "Check before you go.",
    "Get directions.",
    "See nearby places.",
    "Details are on PUBLIK.",
    "Times come from public lists.",
    "Free to use, no sign-in.",
    "Open the map for more.",
    "A free guide to public places in Bengaluru.",
    "Check the timings at the place before you travel.",
]


# ---------- small helpers ----------

def esc(s):
    return html.escape(str(s), quote=True)


def slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii").lower()
    s = s.replace("'", "").replace("’", "")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    if len(s) > 70:
        s = s[:70].rsplit("-", 1)[0] or s[:70]
    return s or "place"


def akey(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def km(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def dist_text(d):
    return f"{round(d * 1000)} m" if d < 1 else f"{d:.1f} km"


def num(n):
    return f"{n:,}"


def fmt_t(t):
    if t == "24:00":
        return "midnight"
    h, m = (int(x) for x in t.split(":"))
    ap = "pm" if h >= 12 else "am"
    h = h % 12 or 12
    return f"{h}:{m:02d} {ap}" if m else f"{h} {ap}"


def ranges_text(rs):
    if not rs:
        return "Closed"
    return ", ".join("Open 24 hours" if (a, b) == ("00:00", "24:00") else f"{fmt_t(a)} to {fmt_t(b)}" for a, b in rs)


def has_times(p):
    return bool(p.get("hours") or p.get("week"))


def day_ranges(p):
    """7 range lists indexed by day (0 = Sunday), or None. Same rules as app.js."""
    if p.get("hours"):
        return [p["hours"]] * 7
    if p.get("week"):
        return [p["week"].get(str(d)) or [] for d in range(7)]
    return None


def day_groups(p, short=False):
    """[(label, ranges, [day numbers])] with equal days merged, Monday first."""
    dr = day_ranges(p)
    if dr is None:
        return None
    names = [d[:3] for d in DAYS] if short else DAYS
    if all(dr[d] == dr[0] for d in range(7)):
        return [("Every day", dr[0], list(range(7)))]
    by_sig, order = {}, []
    for d in MON_FIRST:
        sig = json.dumps(dr[d])
        if sig not in by_sig:
            by_sig[sig] = (dr[d], [])
            order.append(sig)
        by_sig[sig][1].append(d)
    out = []
    for sig in order:
        rs, days = by_sig[sig]
        pos = sorted(MON_FIRST.index(d) for d in days)
        runs, cur = [], [pos[0]]
        for x in pos[1:]:
            if x == cur[-1] + 1:
                cur.append(x)
            else:
                runs.append(cur)
                cur = [x]
        runs.append(cur)
        parts = []
        for r in runs:
            if len(r) >= 3:
                parts.append(f"{names[MON_FIRST[r[0]]]} to {names[MON_FIRST[r[-1]]]}")
            else:
                parts.extend(names[MON_FIRST[i]] for i in r)
        out.append((", ".join(parts), rs, days))
    return out


def hours_summary(p, limit=70):
    g = day_groups(p, short=True)
    if g is None:
        if p.get("hoursText"):
            t = p["hoursText"]
            return "Listed as: " + (t if len(t) <= limit else t[: limit - 3].rsplit(" ", 1)[0] + "...")
        return "Timings not known"
    if len(g) == 1:
        return ranges_text(g[0][1])
    return "; ".join(f"{lab} {ranges_text(rs)}" for lab, rs, _ in g)


def fit_desc(parts, fillers=FILLERS, lo=140, hi=160):
    """Join sentences until the text is between lo and hi characters."""
    parts = [x for x in parts if x]
    cur = parts[0]
    if len(cur) > hi:
        return cur[: hi - 3].rsplit(" ", 1)[0].rstrip(",;:") + "..."
    for s in parts[1:]:
        if len(cur) + 1 + len(s) <= hi:
            cur += " " + s
    pool = [f for f in fillers if f not in cur]
    while len(cur) < lo:
        # take the longest filler that still fits; shorter ones close small gaps
        fit = [f for f in pool if len(cur) + 1 + len(f) <= hi]
        if not fit:
            break
        best = max(fit, key=lambda f: (len(f), f))
        cur += " " + best
        pool.remove(best)
    return cur


def pick_title(cands, mx=59, tail=" | PUBLIK"):
    for c in cands:
        if len(c) <= mx:
            return c
    c = cands[-1]
    room = mx - len(tail) - 3
    return c[: len(c) - len(tail)][:room].rsplit(" ", 1)[0].rstrip(",;:-( ") + "..." + tail


# ---------- areas ----------

def normalise_areas(places):
    """Set p['_area'] (merged area name or None) and p['_sub'] (original label when it differs)."""
    keyed = {}
    for p in places:
        raw = re.sub(r"\s+", " ", (p.get("area") or "").strip())
        if not raw:
            p["_ak"] = None
            continue
        m = SUB_RE.match(raw)
        base = m.group(1) if m and len(m.group(1)) >= 3 and not m.group(1)[0].isdigit() else raw
        k = akey(base)
        k = ALIAS.get(k, k)
        p["_ak"], p["_raw"] = k, raw
        keyed.setdefault(k, Counter())[base] += 1
    names = {k: DISPLAY.get(k) or sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[0][0] for k, c in keyed.items()}
    for p in places:
        if p["_ak"]:
            p["_area"] = names[p["_ak"]]
            p["_sub"] = p["_raw"] if p["_raw"] != p["_area"] else None
        else:
            p["_area"] = p["_sub"] = None


def area_page_ok(name):
    return not (name[0].isdigit() or name.lower().startswith("sector") or len(name) < 3)


# ---------- page shell ----------

def head(title, desc, canon, css_ver, robots=None, jsonld=()):
    ld = "".join(
        '<script type="application/ld+json">'
        + json.dumps(j, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
        + "</script>\n" for j in jsonld)
    rb = f'<meta name="robots" content="{robots}">\n' if robots else ""
    cn = f'<link rel="canonical" href="{esc(canon)}">\n' if canon else ""
    return f"""<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
{rb}<meta name="theme-color" content="#e4e7e3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0e1712" media="(prefers-color-scheme: dark)">
{cn}<meta property="og:type" content="website">
<meta property="og:site_name" content="PUBLIK">
<meta property="og:locale" content="en_IN">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{esc(canon or SITE + '/')}">
<meta property="og:image" content="{SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="PUBLIK, free public spaces in Bengaluru">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(title)}">
<meta name="twitter:description" content="{esc(desc)}">
<meta name="twitter:image" content="{SITE}/og.png">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/pages.css?v={css_ver}">
{ld}</head>
"""


def crumbs_ld(items):
    return {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": SITE + u} for i, (n, u) in enumerate(items)]}


def crumbs_html(items):
    out = []
    for i, (n, u) in enumerate(items):
        if i == len(items) - 1:
            out.append(f'<li aria-current="page">{esc(n)}</li>')
        else:
            out.append(f'<li><a href="{esc(u)}">{esc(n)}</a></li>')
    return '<nav class="crumbs" aria-label="Breadcrumb"><ol>' + "".join(out) + "</ol></nav>"


HEADER = ('<header class="site"><a class="brand" href="/"><b>PUBLIK</b> <span>Bengaluru</span></a>'
          '<a class="open-app" href="/">Open the map</a></header>')


def shell(top, body, built):
    return top + f"""<body>
{HEADER}
<main>
{body}
</main>
<footer class="site">
<p>Timings come from the BBMP park list, OpenStreetMap and Google Maps. They can be out of date, so check at the place before you travel.</p>
<p>Data: BBMP via <a href="https://data.opencity.in/dataset/bbmp-parks" rel="noopener">OpenCity</a>, &copy; <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap contributors</a>. Data built {esc(built)}.</p>
<p>PUBLIK is an independent project. It is not linked to BBMP, BMRCL or Google. <a href="/">Home</a> &middot; <a href="/photo-rules">Photo rules</a></p>
</footer>
</body>
</html>
"""


def write(rel, text):
    path = DOCS / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


# ---------- main ----------

def main():
    data = json.loads((DOCS / "data" / "places.json").read_text(encoding="utf-8"))
    built = data["built"]
    places = sorted(data["places"], key=lambda p: (p["name"].lower(), p["id"]))
    normalise_areas(places)

    css_ver = hashlib.md5(PAGES_CSS.encode("utf-8")).hexdigest()[:8]
    write("pages.css", PAGES_CSS)

    # clean the folders this script owns, so a rerun leaves no stale pages
    for d in [c[0] for c in CATS.values()] + ["area", "place"]:
        shutil.rmtree(DOCS / d, ignore_errors=True)

    by_area = defaultdict(list)
    for p in places:
        if p["_area"]:
            by_area[p["_area"]].append(p)
    area_pages, used = {}, set()
    for name in sorted(by_area, key=lambda n: (-len(by_area[n]), n)):
        if len(by_area[name]) >= MIN_AREA_PLACES and area_page_ok(name):
            s = slugify(name)
            while s in used:
                s += "-2"
            used.add(s)
            area_pages[name] = s
    centers = {n: (sum(p["lat"] for p in ps) / len(ps), sum(p["lng"] for p in ps) / len(ps)) for n, ps in by_area.items()}

    GENERIC = re.compile(r"^(public toilets?|bbmp park|park|playground|toilet|bda park)", re.I)
    NOT_PUBLIC = re.compile(r"just ?books|universit|college|institute|school|club|wipro|iim", re.I)

    def indexable(p):
        # Thin pages stay noindex: generic names ("Public toilet, X"), toilets without timings,
        # and libraries that are not free public ones. Price chips (Free/Paid) are not content.
        if GENERIC.match(p["name"]) or NOT_PUBLIC.search(p["name"]):
            return False
        if p["cat"] == "toilet" and not (has_times(p) or p.get("hoursText")):
            return False
        feat = [f for f in (p.get("feat") or []) if f.lower() not in ("free", "paid")]
        return bool(has_times(p) or p.get("hoursText") or feat or p.get("birds"))

    used = set()
    for p in places:
        base = slugify(p["name"])
        if p["_area"] and slugify(p["_area"]) not in base:
            base = slugify(p["name"] + " " + p["_area"])
        s, n = base, 2
        while s in used:
            s = f"{base}-{n}"
            n += 1
        used.add(s)
        p["_slug"] = s
        p["_idx"] = indexable(p)
    idx_places = [p for p in places if p["_idx"]]

    place_url = lambda p: f"/place/{p['_slug']}/"
    area_url = lambda name: f"/area/{area_pages[name]}/"
    cat_url = lambda c: f"/{CATS[c][0]}/"

    def nearest(p, pool, k):
        cand = []
        for q in pool:
            if q["id"] == p["id"] or abs(q["lat"] - p["lat"]) > 0.05 or abs(q["lng"] - p["lng"]) > 0.05:
                continue
            cand.append((km((p["lat"], p["lng"]), (q["lat"], q["lng"])), q["name"], q["id"], q))
        cand.sort(key=lambda t: t[:3])
        return [(d, q) for d, _, _, q in cand[:k]]

    def row(p):
        feats = f' <span class="tags">{esc(", ".join(p["feat"]))}</span>' if p.get("feat") else ""
        sub = f' <span class="tags">{esc(p["_sub"])}</span>' if p.get("_sub") else ""
        cls = "hrs" if (has_times(p) or p.get("hoursText")) else "hrs none"
        return f'<li><a href="{place_url(p)}">{esc(p["name"])}</a>{sub}<span class="{cls}">{esc(hours_summary(p))}</span>{feats}</li>'

    stats = Counter()
    sitemap = [("/", built), ("/photo-rules", PHOTO_RULES_LASTMOD)]

    # ===== category pages =====
    cat_info = {}
    for c in CAT_ORDER:
        slug, sing, plural, _ = CATS[c]
        ps = [p for p in places if p["cat"] == c]
        withtimes = [p for p in ps if has_times(p)]
        withtext = [p for p in ps if p.get("hoursText") and not has_times(p)]
        unknown = len(ps) - len(withtimes) - len(withtext)
        areas = Counter(p["_area"] for p in ps if p["_area"])
        ranked = sorted(areas.items(), key=lambda kv: (-kv[1], kv[0]))
        top = ranked[:3]
        featc = Counter(f for p in ps for f in p.get("feat", []))
        srcc = Counter(p.get("hoursSrc", "").split(",")[0] for p in withtimes)
        cat_info[c] = dict(n=len(ps), t=len(withtimes))
        title = pick_title([f"{plural} in Bangalore (Bengaluru): timings | PUBLIK",
                            f"{plural} in Bengaluru: timings by area | PUBLIK", f"{plural} in Bengaluru | PUBLIK"])
        topt = ", ".join(f"{a} ({n})" for a, n in top)
        desc = fit_desc([
            f"{num(len(ps))} {sing}s in Bengaluru (Bangalore), listed by area, with opening times for {num(len(withtimes))}.",
            f"Most are in {topt}." if top else "",
            "Each place has a page with a directions link."])
        intro = [
            f"PUBLIK lists {num(len(ps))} {sing}s in Bengaluru, also written Bangalore.",
            f"We have opening times for {num(len(withtimes))} of them. "
            + (f"{num(len(withtext))} more have times in a text form that we show as written. " if withtext else "")
            + f"For the other {num(unknown)} we do not know the times yet.",
        ]
        if top:
            ts = [f"{esc(a)} ({n})" for a, n in top]
            intro.append("The areas with the most are " + (", ".join(ts[:-1]) + " and " if len(ts) > 1 else "") + ts[-1] + ".")
        if featc:
            tf = sorted(featc.items(), key=lambda kv: (-kv[1], kv[0]))[:4]
            intro.append("Features listed in our data: " + ", ".join(f"{esc(f.lower())} ({n})" for f, n in tf) + ".")
        srcs = [(s, n) for s, n in sorted(srcc.items(), key=lambda kv: (-kv[1], kv[0])) if s]
        if srcs:
            intro.append("Opening times come from " + ", ".join(f"{esc(s)} ({n})" for s, n in srcs) + ".")
        groups = defaultdict(list)
        for p in ps:
            groups[p["_area"] or ""].append(p)
        keys = sorted((k for k in groups if k), key=lambda s: s.lower()) + ([""] if "" in groups else [])
        sections = []
        for k in keys:
            g = groups[k]
            h = (f'<a href="{area_url(k)}">{esc(k)}</a>' if k in area_pages else esc(k)) if k else "Area not listed"
            sections.append(f'<section><h3>{h} <span class="n">{len(g)}</span></h3><ul class="rows">' + "".join(row(p) for p in g) + "</ul></section>")
        topareas = [a for a, _ in ranked if a in area_pages][:12]
        topl = ""
        if topareas:
            topl = f"<h2>Areas with the most {esc(plural.lower())}</h2><ul class=\"chips\">" + "".join(
                f'<li><a href="{area_url(a)}">{esc(a)}</a></li>' for a in topareas) + "</ul>"
        others = "".join(f'<li><a href="{cat_url(o)}">{esc(CATS[o][2])}</a></li>' for o in CAT_ORDER if o != c)
        crumbs = [("Home", "/"), (plural, cat_url(c))]
        body = (crumbs_html(crumbs) + f"<h1>{esc(plural)} in Bengaluru (Bangalore)</h1>"
                + "".join(f"<p>{x}</p>" for x in intro)
                + f'<p><a class="btn" href="/">Open the {esc(sing)} map</a></p>'
                + topl + f"<h2>All {esc(plural.lower())} by area</h2>" + "".join(sections)
                + '<h2>Other kinds of place</h2><ul class="chips">' + others + "</ul>")
        write(f"{slug}/index.html", shell(head(title, desc, SITE + cat_url(c), css_ver, jsonld=[crumbs_ld(crumbs)]), body, built))
        stats["cat"] += 1
        sitemap.append((cat_url(c), built))

    # ===== area pages =====
    area_near = {}
    for name in area_pages:
        ds = sorted(((km(centers[name], centers[o]), o) for o in area_pages if o != name), key=lambda t: (t[0], t[1]))
        area_near[name] = ds[:NEARBY_AREAS]
    for name, slug in area_pages.items():
        ps = by_area[name]
        n = len(ps)
        cc = Counter(p["cat"] for p in ps)
        wt = sum(1 for p in ps if has_times(p))
        counts = [f"{cc[c]} {CATS[c][1] if cc[c] == 1 else CATS[c][2].lower()}" for c in CAT_ORDER if cc[c]]
        kinds = [CATS[c][2].lower() for c in CAT_ORDER if cc[c]]
        kp = kinds[0] if len(kinds) == 1 else ", ".join(kinds[:-1]) + " and " + kinds[-1]
        kp = kp[0].upper() + kp[1:]
        title = pick_title([f"{kp} in {name}, Bengaluru | PUBLIK", f"{kp} in {name} | PUBLIK",
                            f"Public places in {name} | PUBLIK", f"{name} | PUBLIK"])
        near3 = [o for _, o in area_near[name][:3]]
        desc = fit_desc([
            f"{n} public places in {name}, Bengaluru: " + ", ".join(counts) + ".",
            f"Opening times are listed for {wt}." if wt else "We do not have opening times for these yet.",
            ("Nearby areas: " + ", ".join(near3) + ".") if near3 else ""])
        intro = [f"{esc(name)} has {n} public places on PUBLIK: " + ", ".join(counts) + ".",
                 f"We have opening times for {wt} of them." if wt else "We do not have opening times for any of them yet."]
        subs = sorted({p["_sub"] for p in ps if p["_sub"]})
        if subs:
            intro.append("Some are listed under a block, stage or phase: " + ", ".join(esc(s) for s in subs[:6]) + ("." if len(subs) <= 6 else " and more."))
        secs = []
        for c in CAT_ORDER:
            g = [p for p in ps if p["cat"] == c]
            if g:
                secs.append(f'<section><h2><a href="{cat_url(c)}">{esc(CATS[c][2])}</a> in {esc(name)} <span class="n">{len(g)}</span></h2><ul class="rows">'
                            + "".join(row(p) for p in g) + "</ul></section>")
        nl = '<h2>Nearby areas</h2><ul class="chips">' + "".join(
            f'<li><a href="{area_url(o)}">{esc(o)}</a> <span class="tags">{dist_text(d)}</span></li>' for d, o in area_near[name]) + "</ul>"
        crumbs = [("Home", "/"), (name, area_url(name))]
        body = (crumbs_html(crumbs) + f"<h1>{esc(kp)} in {esc(name)}, Bengaluru</h1>"
                + "".join(f"<p>{x}</p>" for x in intro) + '<p><a class="btn" href="/">Open the map</a></p>'
                + "".join(secs) + nl)
        write(f"area/{slug}/index.html", shell(head(title, desc, SITE + area_url(name), css_ver, jsonld=[crumbs_ld(crumbs)]), body, built))
        stats["area"] += 1
        sitemap.append((area_url(name), built))

    # ===== place pages =====
    seen_titles = Counter()
    for p in places:
        c = p["cat"]
        _, sing, plural, stype = CATS[c]
        area, name = p["_area"], p["name"]
        cands = []
        if area and akey(area) not in akey(name):
            cands += [f"{name} timings, {area} | PUBLIK", f"{name}, {area} | PUBLIK"]
        cands += [f"{name} timings | PUBLIK", f"{name} | PUBLIK"]
        title = pick_title(cands)
        n = 1
        while title in seen_titles:      # same title as another page: add a number
            n += 1
            sfx = f" ({n}) | PUBLIK"
            title = pick_title([f"{name}{sfx}"], tail=sfx)
        seen_titles[title] += 1
        parts = [f"{name} is a {sing}{' in ' + area if area else ''}, Bengaluru."]
        if has_times(p):
            parts.append("Timings: " + hours_summary(p, 60) + ".")
        elif p.get("hoursText"):
            parts.append(hours_summary(p, 60) + ".")
        else:
            parts.append("We do not have its timings yet.")
        if p.get("feat"):
            parts.append("Features: " + ", ".join(f.lower() for f in p["feat"]) + ".")
        parts.append("See directions and nearby places on PUBLIK.")
        desc = fit_desc(parts)

        if has_times(p):
            hours_html = '<ul class="hours">' + "".join(
                f"<li><b>{esc(lab)}:</b> {esc(ranges_text(rs))}</li>" for lab, rs, _ in day_groups(p)) + "</ul>"
        elif p.get("hoursText"):
            hours_html = f'<p>Listed as <code>{esc(p["hoursText"])}</code> (OpenStreetMap format).</p>'
        else:
            hours_html = "<p>We do not know the timings yet. Check at the place, or open PUBLIK to see what visitors report.</p>"
        if has_times(p) or p.get("hoursText"):
            hours_html += f'<p class="muted">Source: {esc(p.get("hoursSrc") or SRC_LABEL.get(p["src"], p["src"]))}. Timings can change, so check at the place.</p>'
        feat_html = ""
        if p.get("feat"):
            feat_html = '<h2>Features</h2><ul class="chips">' + "".join(f"<li>{esc(f)}</li>" for f in p["feat"]) + "</ul>"
        extra = ""
        if p.get("sqm") and p.get("src") in ("bbmp", "bbmp16"):
            extra += f"<p>Listed area: about {num(int(p['sqm']))} square metres (BBMP park list).</p>"
        if p.get("birds"):
            bn = sorted({b["name"] for b in p["birds"] if b.get("name")})
            if bn:
                extra += "<p>Birds photographed near here on iNaturalist: " + esc(", ".join(bn)) + ".</p>"
        ll = f"{p['lat']},{p['lng']}"
        gm = f"https://www.google.com/maps/dir/?api=1&destination={ll}"
        links = [f'<a href="{cat_url(c)}">All {esc(plural.lower())} in Bengaluru</a>']
        if area in area_pages:
            links.append(f'<a href="{area_url(area)}">All places in {esc(area)}</a>')
        near = nearest(p, idx_places, NEARBY_PLACES)
        nearl = ""
        if near:
            nearl = '<h2>Nearby places</h2><ul class="rows">' + "".join(
                f'<li><a href="{place_url(q)}">{esc(q["name"])}</a> <span class="tags">{esc(CATS[q["cat"]][1])}, {dist_text(d)}</span></li>'
                for d, q in near) + "</ul>"
        crumbs = [("Home", "/"), (plural, cat_url(c))]
        if area in area_pages:
            crumbs.append((area, area_url(area)))
        crumbs.append((name, place_url(p)))
        loc = f"{sing.capitalize()} in {esc(area)}, Bengaluru" if area else f"{sing.capitalize()} in Bengaluru"
        if p.get("_sub"):
            loc += f" (listed under {esc(p['_sub'])})"
        body = (crumbs_html(crumbs) + f'<h1>{esc(name)}</h1><p class="kind">{loc}</p>'
                + "<h2>Opening hours</h2>" + hours_html + feat_html + extra
                + "<h2>Directions</h2>"
                + f'<p><a class="btn" href="{esc(gm)}" rel="noopener">Directions in Google Maps</a> <a class="btn alt" href="/#{esc(p["id"])}">Open in PUBLIK</a></p>'
                + f'<p class="muted">Location: {p["lat"]}, {p["lng"]}. PUBLIK also shows what visitors report about this place.</p>'
                + nearl + '<h2>More</h2><ul class="chips">' + "".join(f"<li>{x}</li>" for x in links) + "</ul>")
        ld = {"@context": "https://schema.org", "@type": stype, "name": name, "url": SITE + place_url(p),
              "geo": {"@type": "GeoCoordinates", "latitude": p["lat"], "longitude": p["lng"]},
              "address": {"@type": "PostalAddress", "addressLocality": "Bengaluru", "addressRegion": "Karnataka", "addressCountry": "IN"},
              "hasMap": gm}
        if area:
            ld["description"] = f"{sing.capitalize()} in {area}, Bengaluru."
        if has_times(p):
            spec = []
            for _, rs, days in day_groups(p):
                for a, b in rs:
                    spec.append({"@type": "OpeningHoursSpecification", "dayOfWeek": [DAYS[d] for d in sorted(days, key=MON_FIRST.index)],
                                 "opens": a, "closes": "23:59" if b == "24:00" else b})
            if spec:
                ld["openingHoursSpecification"] = spec
        if p.get("feat"):
            ld["amenityFeature"] = [{"@type": "LocationFeatureSpecification", "name": f, "value": True} for f in p["feat"]]
        robots = None if p["_idx"] else "noindex,follow"
        write(f"place/{p['_slug']}/index.html",
              shell(head(title, desc, SITE + place_url(p), css_ver, robots=robots, jsonld=[crumbs_ld(crumbs), ld]), body, built))
        stats["place"] += 1
        if p["_idx"]:
            stats["idx"] += 1
            sitemap.append((place_url(p), built))
        else:
            stats["noidx"] += 1

    # ===== 404 page (no canonical, noindex) =====
    write("404.html", head("Page not found | PUBLIK", "This page is not on PUBLIK. The link may be old or mistyped. Go to the home page to find parks, lakes, libraries and public toilets in Bengaluru.",
                           None, css_ver, robots="noindex")
          + f"""<body>
{HEADER}
<main>
<h1>Page not found</h1>
<p>This page is not on PUBLIK. The link may be old or mistyped.</p>
<p><a class="btn" href="/">Go to the home page</a></p>
<ul class="chips">""" + "".join(f'<li><a href="{cat_url(c)}">{esc(CATS[c][2])}</a></li>' for c in CAT_ORDER) + """</ul>
</main>
</body>
</html>
""")

    # ===== link block on the home page =====
    top_areas = sorted(area_pages, key=lambda n: (-len(by_area[n]), n))[:TOP_AREAS_HOME]
    block = ('<!-- seo-links:start (written by scripts/build_pages.py) -->\n<nav class="browse" aria-label="Browse PUBLIK pages">\n'
             "<h2>Browse by kind of place</h2>\n<ul>"
             + "".join(f'<li><a href="{cat_url(c)}">{esc(CATS[c][2])} in Bengaluru</a></li>' for c in CAT_ORDER)
             + "</ul>\n<h2>Browse by area</h2>\n<ul>"
             + "".join(f'<li><a href="{area_url(a)}">{esc(a)}</a></li>' for a in top_areas)
             + "</ul>\n</nav>\n<!-- seo-links:end -->")
    ip = DOCS / "index.html"
    txt = ip.read_text(encoding="utf-8")
    if "<!-- seo-links:start" in txt:
        txt = re.sub(r"<!-- seo-links:start.*?<!-- seo-links:end -->", lambda m: block, txt, flags=re.S)
    else:
        txt = txt.replace("<footer>\n", "<footer>\n" + block + "\n", 1)
    with open(ip, "w", encoding="utf-8", newline="\n") as f:
        f.write(txt)

    # ===== sitemap and llms.txt =====
    sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    sm += [f"  <url><loc>{SITE}{esc(u)}</loc><lastmod>{lm}</lastmod></url>" for u, lm in sitemap]
    sm.append("</urlset>")
    write("sitemap.xml", "\n".join(sm) + "\n")

    ll = [
        "# PUBLIK Bengaluru", "",
        f"> PUBLIK is a free, independent website that lists {num(len(places))} public places in Bengaluru (Bangalore): "
        "parks, playgrounds, lakes, libraries and public toilets. Each place has opening times where known, features, "
        "and a directions link. No sign-in.", "",
        "Timings come from the BBMP park list (via OpenCity), OpenStreetMap and Google Maps. They can be out of date. "
        f"Data built {built}. Not every place has timings, and the pages say so when they are not known.", "",
        "## Pages", "", f"- [Home: the map, search and open-now status]({SITE}/)"]
    for c in CAT_ORDER:
        ll.append(f"- [{CATS[c][2]} in Bengaluru]({SITE}{cat_url(c)}): {cat_info[c]['n']} places, {cat_info[c]['t']} with timings")
    ll += ["", "## Areas (largest first)", ""]
    ll += [f"- [{a}]({SITE}{area_url(a)}): {len(by_area[a])} places" for a in top_areas]
    ll += ["", "## Places", "",
           f"Each place has a page at {SITE}/place/<name-area>/ with timings, features, directions and nearby places. "
           f"The sitemap at {SITE}/sitemap.xml lists the {num(stats['idx'])} place pages that have timings or features.", "",
           "## Credits", "", "BBMP park list via OpenCity. OpenStreetMap contributors (ODbL). Google Maps for some timings.", ""]
    write("llms.txt", "\n".join(ll))

    print(f"places={len(places)} areas_total={len(by_area)} category_pages={stats['cat']} area_pages={stats['area']} "
          f"place_pages={stats['place']} indexable={stats['idx']} noindex={stats['noidx']}")
    print(f"sitemap_urls={len(sitemap)} total_html_pages={stats['cat'] + stats['area'] + stats['place'] + 1}")


PAGES_CSS = """/* PUBLIK static pages. System fonts, same colors as style.css. */
:root{--bg:#e4e7e3;--paper:#fff;--canopy:#1f5132;--ink:#142a1d;--muted:#56645b;--rule:#d3d9d4;--wash:#f1f4f1;--link:#1f5132;--btn-ink:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0e1712;--paper:#15211a;--canopy:#8fd3a5;--ink:#e6eee8;--muted:#9db0a4;--rule:#26362c;--wash:#1b2b21;--link:#8fd3a5;--btn-ink:#0e1712}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow-wrap:anywhere}
a{color:var(--link)}
a:focus-visible{outline:3px solid var(--canopy);outline-offset:2px}
header.site,main,footer.site{max-width:720px;margin:0 auto;padding-left:16px;padding-right:16px}
header.site{display:flex;justify-content:space-between;align-items:center;gap:12px;padding-top:14px;padding-bottom:6px}
.brand{text-decoration:none;color:var(--ink);font-size:1.1rem}
.brand b{color:var(--canopy);letter-spacing:.04em}
.brand span{color:var(--muted);font-size:.9rem}
.open-app{font-size:.9rem}
main{padding-top:8px;padding-bottom:24px}
h1{font-size:1.6rem;line-height:1.25;margin:.4em 0 .5em}
h2{font-size:1.2rem;margin:1.6em 0 .5em}
h3{font-size:1.02rem;margin:1.2em 0 .3em}
p{margin:0 0 .8em}
.kind{color:var(--muted);margin-top:-.2em}
.muted,.tags{color:var(--muted)}
.tags{font-size:.85rem}
.n{display:inline-block;min-width:1.6em;padding:0 .5em;border-radius:999px;background:var(--wash);border:1px solid var(--rule);color:var(--muted);font-size:.78rem;font-weight:400;text-align:center;vertical-align:middle}
.crumbs ol{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:2px 0;font-size:.85rem;color:var(--muted)}
.crumbs li+li::before{content:"/";margin:0 .5em;opacity:.6}
.btn{display:inline-block;margin:0 8px 8px 0;padding:10px 16px;border-radius:999px;background:var(--canopy);color:var(--btn-ink);text-decoration:none;font-weight:600}
.btn.alt{background:transparent;color:var(--link);border:2px solid var(--canopy);padding:8px 14px}
.rows{list-style:none;margin:0;padding:0;background:var(--paper);border:1px solid var(--rule);border-radius:12px}
.rows li{padding:9px 12px;border-top:1px solid var(--rule)}
.rows li:first-child{border-top:0}
.rows .hrs{display:block;font-size:.88rem;color:var(--muted)}
.chips{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:8px}
.chips li{padding:6px 12px;border-radius:999px;background:var(--paper);border:1px solid var(--rule)}
.hours{list-style:none;margin:0 0 .8em;padding:12px;background:var(--paper);border:1px solid var(--rule);border-radius:12px}
.hours li{padding:2px 0}
code{background:var(--wash);padding:1px 5px;border-radius:5px}
footer.site{color:var(--muted);font-size:.82rem;padding-top:8px;padding-bottom:40px}
footer.site p{margin:0 0 6px}
"""

if __name__ == "__main__":
    main()
