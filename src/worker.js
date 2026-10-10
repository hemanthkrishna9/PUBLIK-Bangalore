// PUBLIK API: anonymous one-tap reports and "I went here" visits. Every other path is served from ./docs.
const HOUR = 3600 * 1000;
// How long each kind of report stays visible, in hours.
const KINDS = { clean: 48, dirty: 48, crowded: 3, quiet: 3, open: 3, closed: 3 };
const LIMITS = { global24h: 2000, place24h: 50, who1h: 60, sameGap: 30 * 60 * 1000 };
const ID_RE = /^[\w.-]{1,40}$/;
// "I went here" answers. Every question is optional, but a visit needs at least one answer.
const VISIT_Q = {
  entry: ["walkin", "id", "member"],
  feel: ["quiet", "lively", "crowded"],
  first: ["yes", "okay", "no"],
};
const VISIT_LIMITS = { global24h: 1000, place24h: 20, days: 365 };

let placeIds = null; // cached per isolate

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});

async function knownPlace(id, req, env) {
  if (!placeIds) {
    const res = await env.ASSETS.fetch(new URL("/data/places.json", req.url));
    placeIds = new Set((await res.json()).places.map((p) => p.id));
  }
  return placeIds.has(id);
}

async function dailySalt(env) {
  const day = new Date().toISOString().slice(0, 10);
  let row = await env.DB.prepare("SELECT salt FROM salts WHERE day = ?").bind(day).first();
  if (!row) {
    const salt = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)").bind(day, salt),
      env.DB.prepare("DELETE FROM salts WHERE day <> ?").bind(day),
    ]);
    row = await env.DB.prepare("SELECT salt FROM salts WHERE day = ?").bind(day).first();
  }
  return row.salt;
}

async function visitorKey(req, env) {
  const ip = req.headers.get("cf-connecting-ip") || "unknown";
  const data = new TextEncoder().encode(ip + "|" + (await dailySalt(env)));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...hash.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getReports(url, env) {
  const place = url.searchParams.get("place") || "";
  if (!ID_RE.test(place)) return json({ error: "Bad place id." }, 400);
  const now = Date.now();
  const { results } = await env.DB.prepare(
    "SELECT kind, ts FROM reports WHERE place = ? AND ts > ? ORDER BY ts DESC LIMIT 500",
  ).bind(place, now - 48 * HOUR).all();
  const by = {};
  for (const r of results) {
    if (now - r.ts > KINDS[r.kind] * HOUR) continue;
    const b = (by[r.kind] ||= { kind: r.kind, n: 0, last: r.ts });
    b.n++;
  }
  // One "Closed now" report is too easy to fake, so show it only when two people agree.
  const reports = Object.values(by).filter((r) => r.kind !== "closed" || r.n >= 2).sort((a, b) => b.last - a.last);
  return json({ reports });
}

async function postReport(req, env, ctx) {
  if (+(req.headers.get("content-length") || 0) > 300) return json({ error: "Request too large." }, 413);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
  const { place, kind } = body || {};
  if (!(kind in KINDS) || typeof place !== "string" || !ID_RE.test(place)) return json({ error: "Bad request." }, 400);
  if (!(await knownPlace(place, req, env))) return json({ error: "Unknown place." }, 404);

  const now = Date.now();
  const who = await visitorKey(req, env);
  const count = (sql, ...args) => env.DB.prepare(`SELECT COUNT(*) AS n FROM reports WHERE ${sql}`).bind(...args);
  const [all, plc, same, mine] = (await env.DB.batch([
    count("ts > ?", now - 24 * HOUR),
    count("place = ? AND ts > ?", place, now - 24 * HOUR),
    count("who = ? AND place = ? AND kind = ? AND ts > ?", who, place, kind, now - LIMITS.sameGap),
    count("who = ? AND ts > ?", who, now - HOUR),
  ])).map((r) => r.results[0].n);
  if (all >= LIMITS.global24h) return json({ error: "Reports are paused for today. Try again tomorrow." }, 503);
  if (plc >= LIMITS.place24h) return json({ error: "This place has enough reports for today." }, 429);
  if (same > 0) return json({ error: "You already reported this. Try again in 30 minutes." }, 429);
  if (mine >= LIMITS.who1h) return json({ error: "Too many reports. Try again in an hour." }, 429);

  await env.DB.prepare("INSERT INTO reports (place, kind, ts, who) VALUES (?, ?, ?, ?)").bind(place, kind, now, who).run();

  // Housekeeping on about 1 in 20 writes: forget visitor keys after a day, rows after 30 days.
  if (Math.random() < 0.05) {
    ctx.waitUntil(env.DB.batch([
      env.DB.prepare("UPDATE reports SET who = NULL WHERE who IS NOT NULL AND ts < ?").bind(now - 24 * HOUR),
      env.DB.prepare("DELETE FROM reports WHERE ts < ?").bind(now - 30 * 24 * HOUR),
    ]));
  }
  return json({ ok: true });
}

// Summary of the last 365 days: visit count, last visit, and a tally per answer.
async function getVisits(url, env) {
  const place = url.searchParams.get("place") || "";
  if (!ID_RE.test(place)) return json({ error: "Bad place id." }, 400);
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n, MAX(ts) AS last FROM visits WHERE place = ? AND ts > ?",
  ).bind(place, Date.now() - VISIT_LIMITS.days * 24 * HOUR).first();
  const tally = {};
  for (const q of Object.keys(VISIT_Q)) {
    const { results } = await env.DB.prepare(
      `SELECT ${q} AS a, COUNT(*) AS n FROM visits WHERE place = ? AND ts > ? AND ${q} IS NOT NULL GROUP BY ${q}`,
    ).bind(place, Date.now() - VISIT_LIMITS.days * 24 * HOUR).all();
    tally[q] = Object.fromEntries(results.map((r) => [r.a, r.n]));
  }
  return json({ n: row.n, last: row.last, tally });
}

async function postVisit(req, env, ctx) {
  if (+(req.headers.get("content-length") || 0) > 300) return json({ error: "Request too large." }, 413);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
  const { place } = body || {};
  if (typeof place !== "string" || !ID_RE.test(place)) return json({ error: "Bad request." }, 400);
  const ans = {};
  for (const [q, allowed] of Object.entries(VISIT_Q)) {
    const a = body[q];
    if (a == null || a === "") { ans[q] = null; continue; }
    if (!allowed.includes(a)) return json({ error: "Bad request." }, 400);
    ans[q] = a;
  }
  if (!ans.entry && !ans.feel && !ans.first) return json({ error: "Pick at least one answer." }, 400);
  if (!(await knownPlace(place, req, env))) return json({ error: "Unknown place." }, 404);

  const now = Date.now();
  const who = await visitorKey(req, env);
  const count = (sql, ...args) => env.DB.prepare(`SELECT COUNT(*) AS n FROM visits WHERE ${sql}`).bind(...args);
  const [all, plc, same] = (await env.DB.batch([
    count("ts > ?", now - 24 * HOUR),
    count("place = ? AND ts > ?", place, now - 24 * HOUR),
    count("who = ? AND place = ? AND ts > ?", who, place, now - 24 * HOUR),
  ])).map((r) => r.results[0].n);
  if (all >= VISIT_LIMITS.global24h) return json({ error: "Visits are paused for today. Try again tomorrow." }, 503);
  if (plc >= VISIT_LIMITS.place24h) return json({ error: "This place has enough visits for today." }, 429);
  if (same > 0) return json({ error: "You already told us about this place today. Thanks." }, 429);

  await env.DB.prepare("INSERT INTO visits (place, ts, who, entry, feel, first) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(place, now, who, ans.entry, ans.feel, ans.first).run();

  if (Math.random() < 0.05) {
    ctx.waitUntil(env.DB.batch([
      env.DB.prepare("UPDATE visits SET who = NULL WHERE who IS NOT NULL AND ts < ?").bind(now - 24 * HOUR),
      env.DB.prepare("DELETE FROM visits WHERE ts < ?").bind(now - VISIT_LIMITS.days * 24 * HOUR),
    ]));
  }
  return json({ ok: true });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/api/reports" && req.method === "GET") return await getReports(url, env);
      if (url.pathname === "/api/report" && req.method === "POST") return await postReport(req, env, ctx);
      if (url.pathname === "/api/visits" && req.method === "GET") return await getVisits(url, env);
      if (url.pathname === "/api/visit" && req.method === "POST") return await postVisit(req, env, ctx);
      return json({ error: "Not found." }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: "Something went wrong. Try again later." }, 500);
    }
  },
};
