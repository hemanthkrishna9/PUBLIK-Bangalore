#!/usr/bin/env python3
"""Check the generated pages: one canonical, one h1, unique titles, valid JSON-LD, description length."""
import html, json, re, sys
from pathlib import Path
DOCS = Path(__file__).resolve().parent.parent / "docs"
files = [DOCS / d / "index.html" for d in ("parks", "playgrounds", "lakes", "libraries", "public-toilets")]
files += sorted((DOCS / "area").glob("*/index.html")) + sorted((DOCS / "place").glob("*/index.html"))
files.append(DOCS / "404.html")
titles, bad, size, noidx = {}, [], 0, 0
for f in files:
    t = f.read_text(encoding="utf-8"); size += f.stat().st_size
    rel = f.relative_to(DOCS).as_posix()
    is404 = rel == "404.html"
    if len(re.findall(r'<link rel="canonical"', t)) != (0 if is404 else 1): bad.append((rel, "canonical"))
    if len(re.findall(r"<h1[ >]", t)) != 1: bad.append((rel, "h1"))
    m = re.search(r"<title>(.*?)</title>", t); ti = html.unescape(m.group(1)) if m else ""
    if not ti or len(ti) >= 60: bad.append((rel, f"title len {len(ti)}"))
    if ti in titles: bad.append((rel, f"dup title with {titles[ti]}"))
    titles[ti] = rel
    d = re.search(r'<meta name="description" content="(.*?)">', t)
    dl = len(html.unescape(d.group(1))) if d else 0
    if not 140 <= dl <= 160: bad.append((rel, f"desc len {dl}"))
    for j in re.findall(r'<script type="application/ld\+json">(.*?)</script>', t, re.S):
        try: json.loads(j)
        except Exception as e: bad.append((rel, f"jsonld {e}"))
    if "breadcrumb" not in t.lower() and not is404: bad.append((rel, "no breadcrumb"))
    if 'name="robots"' in t: noidx += 1
    for tag in ("og:title", "og:image", "twitter:card"):
        if tag not in t: bad.append((rel, "missing " + tag))
print(f"files={len(files)} bytes={size} robots_meta={noidx} problems={len(bad)}")
for b in bad[:40]: print(b)
sys.exit(1 if bad else 0)
