// PUBLIK API: anonymous one-tap reports, "I went here" visits and user photos. Every other path is served from ./docs.
import { checkPhoto } from "./photocheck.js";
const HOUR = 3600 * 1000;
// How long each kind of report stays visible, in hours.
// "Under repair" lasts two weeks, because repairs take that long. "Repair done" clears it.
const KINDS = { clean: 48, dirty: 48, crowded: 3, quiet: 3, open: 3, closed: 3, repair: 336, fixed: 48 };
const MAX_HOURS = Math.max(...Object.values(KINDS));
// One wrong tap must not mark a place closed or under repair, so these show only when two people agree.
const NEED_TWO = new Set(["closed", "repair"]);

// Drop reports that other reports overrule, and the ones that still need a second person.
function visibleReports(by) {
  if (by.repair && by.fixed && by.fixed.last > by.repair.last) delete by.repair;
  return Object.values(by).filter((r) => !NEED_TWO.has(r.kind) || r.n >= 2);
}
const LIMITS = { global24h: 2000, place24h: 50, who1h: 60, sameGap: 30 * 60 * 1000 };
const ID_RE = /^[\w.-]{1,40}$/;
// "I went here" answers. Every question is optional, but a visit needs at least one answer.
const VISIT_Q = {
  entry: ["walkin", "id", "member"],
  feel: ["quiet", "lively", "crowded"],
  first: ["yes", "okay", "no"],
  // Playgrounds and parks with a play area: safety for small children.
  equip: ["good", "broken", "unsafe"],
  ground: ["sand", "grass", "rubber", "hard"],
  toddler: ["yes", "care", "no"],
};
const VISIT_LIMITS = { global24h: 1000, place24h: 20, days: 365 };

let places = null; // id -> { name, cat }, cached per isolate

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});

async function placeOf(id, req, env) {
  if (!places) {
    const res = await env.ASSETS.fetch(new URL("/data/places.json", req.url));
    places = new Map((await res.json()).places.map((p) => [p.id, { name: p.name, cat: p.cat }]));
  }
  return places.get(id) || null;
}
const knownPlace = async (id, req, env) => !!(await placeOf(id, req, env));

async function dailySalt(env) {
  const day = new Date().toISOString().slice(0, 10);
  let row = await env.DB.prepare("SELECT salt FROM salts WHERE day = ?").bind(day).first();
  if (!row) {
    const salt = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)").bind(day, salt),
      env.DB.prepare("DELETE FROM salts WHERE day < ?").bind(new Date(Date.now() - 24 * HOUR).toISOString().slice(0, 10)),
    ]);
    row = await env.DB.prepare("SELECT salt FROM salts WHERE day = ?").bind(day).first();
  }
  return row.salt;
}

// The network part of an address: the whole IPv4 address, or the /64 prefix of an IPv6 address.
// A phone can rotate inside its /64 at will, so only the prefix says who is behind it.
function netOf(raw, groups = 4) {
  const ip = raw.split("%")[0].toLowerCase();
  if (!ip.includes(":")) return ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return mapped[1];
  const [h, t] = ip.split("::");
  const head = h ? h.split(":") : [];
  const tail = t ? t.split(":") : [];
  const fill = t === undefined ? 0 : Math.max(8 - head.length - tail.length, 0);
  return [...head, ...Array(fill).fill("0"), ...tail].slice(0, groups).map((x) => x.padStart(4, "0")).join(":");
}

async function hashIp(req, salt, groups) {
  const ip = netOf(req.headers.get("cf-connecting-ip") || "unknown", groups);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + "|" + salt)));
  return [...hash.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function visitorKey(req, env) {
  return hashIp(req, await dailySalt(env));
}

// Today's key and yesterday's (null if there is no salt for yesterday). Salts live 48 hours, so a match on
// either means the same person. Photo limits and photo reports use both.
// groups: how many 16-bit IPv6 groups to keep. 4 is a /64 (upload limits), 3 is a /48 (the photo hide rule).
async function visitorKeys(req, env, groups = 4) {
  const who = await hashIp(req, await dailySalt(env), groups);
  const y = new Date(Date.now() - 24 * HOUR).toISOString().slice(0, 10);
  const row = await env.DB.prepare("SELECT salt FROM salts WHERE day = ?").bind(y).first();
  return { who, prev: row ? await hashIp(req, row.salt, groups) : null };
}

async function getReports(url, env) {
  const place = url.searchParams.get("place") || "";
  if (!ID_RE.test(place)) return json({ error: "Bad place id." }, 400);
  const now = Date.now();
  const { results } = await env.DB.prepare(
    "SELECT kind, ts FROM reports WHERE place = ? AND ts > ? ORDER BY ts DESC LIMIT 500",
  ).bind(place, now - MAX_HOURS * HOUR).all();
  const by = {};
  for (const r of results) {
    if (now - r.ts > KINDS[r.kind] * HOUR) continue;
    const b = (by[r.kind] ||= { kind: r.kind, n: 0, last: r.ts });
    b.n++;
  }
  const reports = visibleReports(by).sort((a, b) => b.last - a.last);
  return json({ reports });
}

async function postReport(req, env, ctx) {
  if (!isJson(req)) return json({ error: "Bad request." }, 415);
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

// City-wide feed for the home page: the newest reports and visits across all places.
// A report shows only while it is still fresh (KINDS), and "Closed now" only after two agree.
async function getActivity(env) {
  const now = Date.now();
  const [reps, vis] = await env.DB.batch([
    env.DB.prepare("SELECT place, kind, ts FROM reports WHERE ts > ? ORDER BY ts DESC LIMIT 300").bind(now - MAX_HOURS * HOUR),
    env.DB.prepare(`SELECT place, ts, ${Object.keys(VISIT_Q).join(", ")} FROM visits WHERE ts > ? ORDER BY ts DESC LIMIT 30`).bind(now - 7 * 24 * HOUR),
  ]);
  const byPlace = new Map();
  for (const r of reps.results) {
    if (now - r.ts > KINDS[r.kind] * HOUR) continue;
    const by = byPlace.get(r.place) || {};
    const b = (by[r.kind] ||= { type: "report", place: r.place, kind: r.kind, n: 0, last: r.ts });
    b.n++;
    byPlace.set(r.place, by);
  }
  const items = [...byPlace.values()].flatMap(visibleReports);
  const seen = new Set();
  for (const v of vis.results) {
    if (seen.has(v.place)) continue; // newest visit per place
    seen.add(v.place);
    items.push({ type: "visit", ...v, last: v.ts, ts: undefined });
  }
  items.sort((a, b) => b.last - a.last);
  return json({ items: items.slice(0, 15) });
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
  if (!isJson(req)) return json({ error: "Bad request." }, 415);
  if (+(req.headers.get("content-length") || 0) > 400) return json({ error: "Request too large." }, 413);
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
  if (!Object.values(ans).some(Boolean)) return json({ error: "Pick at least one answer." }, 400);
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

  const cols = Object.keys(VISIT_Q);
  await env.DB.prepare(`INSERT INTO visits (place, ts, who, ${cols.join(", ")}) VALUES (?, ?, ?, ${cols.map(() => "?").join(", ")})`)
    .bind(place, now, who, ...cols.map((q) => ans[q])).run();

  if (Math.random() < 0.05) {
    ctx.waitUntil(env.DB.batch([
      env.DB.prepare("UPDATE visits SET who = NULL WHERE who IS NOT NULL AND ts < ?").bind(now - 24 * HOUR),
      env.DB.prepare("DELETE FROM visits WHERE ts < ?").bind(now - VISIT_LIMITS.days * 24 * HOUR),
    ]));
  }
  return json({ ok: true });
}

// ---- User photos ----------------------------------------------------------
// Photos go live after an automatic Claude check of the stored images (src/photocheck.js).
// Two different reporters hide a live photo. Turnstile guards upload and report.
const PHOTO = {
  maxBody: 850 * 1024, full: 700 * 1024, thumb: 100 * 1024, fullSide: 1600, thumbSide: 400, text: 280,
  // Limits per 24 hours. "who" is the network (IPv4 address or IPv6 /64), so it is the per-network cap.
  device24h: 5, who24h: 10, place24h: 20, checks24h: 200, reportsWho1h: 30, hideAt: 2, perPlace: 20,
};
// Photos live in Workers KV (free plan: 1,000 writes and 1,000 deletes a day, 1 GB). An upload writes 2 keys,
// so 200 uploads a day is 400 writes, which leaves room for deletes and cleanup. New uploads pause at 900 MB.
const KV_STORE_MAX = 900 * 1024 * 1024;
const KV_DELETES_PER_RUN = 30; // 24 hourly runs stay far below the 1,000 deletes a day
const PHOTO_ID_RE = /^[a-f0-9]{16}$/;
const TYPES = { jpg: "image/jpeg", webp: "image/webp" };
const NO_PHOTO = "This photo cannot be posted. Photos must show this public place, without close-up faces, children, ads or number plates.";
const NO_NOTE = "This note cannot be posted. Please keep it about the place, without names, phone numbers, ads or abuse.";

// Only the real site may post. Local pages count only when env.DEV is set (in .dev.vars).
// lenient: the one-tap routes also accept a POST with neither header (some proxies strip both).
// A present Origin that is not ours is always refused.
function sameSite(req, env, lenient) {
  const sfs = req.headers.get("sec-fetch-site");
  if (sfs === "same-origin") return true;
  const o = req.headers.get("origin");
  if (!o) return !!lenient && !sfs;
  return o === "https://publik.nxtduo.com" || (!!env.DEV && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(o));
}
const isJson = (req) => /^application\/json\b/i.test(req.headers.get("content-type") || "");

// Cloudflare Turnstile: the browser sends a token, we ask Cloudflare if it is good. No secret means closed.
async function humanOk(req, env, token, action) {
  if (!env.TURNSTILE_SECRET || typeof token !== "string" || !token || token.length > 2100) return false;
  const body = new FormData();
  body.set("secret", env.TURNSTILE_SECRET);
  body.set("response", token);
  const ip = req.headers.get("cf-connecting-ip");
  if (ip) body.set("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(5000) });
    const j = await res.json();
    if (!j.success) return false;
    // Cloudflare's test keys answer with hostname example.com and no action, so they pass only in dev.
    if (env.DEV && j.metadata && j.metadata.result_with_testing_key) return true;
    // The token must come from our own page and from the widget for this action.
    const host = j.hostname === "publik.nxtduo.com" || (!!env.DEV && /^(localhost|127\.0\.0\.1)$/.test(j.hostname));
    return host && j.action === action;
  } catch (e) {
    console.error("turnstile check failed", String((e && e.message) || e).slice(0, 100));
    return false;
  }
}

// ---- Telegram: owner alerts with buttons ----
// Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (the only chat we accept), TELEGRAM_WEBHOOK_SECRET.
// Captions are plain text (no parse_mode) and under 1,024 characters. Errors are logged without the token.
const tgOn = (env) => !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
const tgScrub = (env, e) => String((e && e.message) || e).replaceAll(env.TELEGRAM_BOT_TOKEN || "\0", "***").slice(0, 100);

async function tgCall(env, method, body) {
  // TELEGRAM_API (a local test server) counts only when env.DEV is set.
  const base = (env.DEV && env.TELEGRAM_API) || "https://api.telegram.org";
  try {
    const res = await fetch(`${base}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST", body, signal: AbortSignal.timeout(5000),
      headers: typeof body === "string" ? { "content-type": "application/json" } : undefined,
    });
    const j = await res.json().catch(() => ({}));
    if (!j.ok) console.error("telegram", method, String(j.description || res.status).slice(0, 100));
    return j;
  } catch (e) {
    console.error("telegram", method, tgScrub(env, e));
    return {};
  }
}

// Buttons by status: a live photo can be deleted or hidden; a hidden or waiting one can be restored or deleted.
function tgKeys(id, status) {
  const b = (text, act) => ({ text, callback_data: `${act}:${id}` });
  if (status === "deleted") return { inline_keyboard: [] };
  return { inline_keyboard: [status === "live" ? [b("Delete", "del"), b("Hide", "hide")] : [b("Restore", "res"), b("Delete", "del")]] };
}

// kind: live, hidden or pending. getThumb: async function that gives the thumbnail bytes, or null for a note.
function alertTg(ctx, env, kind, p, getThumb) {
  if (!tgOn(env)) return;
  const head = { live: p.noImage ? "NEW NOTE (live)" : "NEW PHOTO (live)", hidden: "HIDDEN after reports", pending: "WAITING: the check failed" }[kind];
  const caption = [head, `${p.placeName || "?"} (${p.place})`, p.text ? `Note: ${p.text.slice(0, 300)}` : "", `Status: ${kind}`, `Check: ${p.reason || "-"}`, `Id: ${p.id.slice(0, 8)}`]
    .filter(Boolean).join("\n").slice(0, 1000);
  const reply_markup = tgKeys(p.id, kind);
  ctx.waitUntil((async () => {
    const thumb = p.noImage ? null : await getThumb().catch(() => null);
    if (!thumb) { await tgCall(env, "sendMessage", JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: caption, reply_markup })); return; }
    const form = (field) => {
      const f = new FormData();
      f.set("chat_id", String(env.TELEGRAM_CHAT_ID));
      f.set("caption", caption);
      f.set("reply_markup", JSON.stringify(reply_markup));
      if (field === "photo" && kind !== "live") f.set("has_spoiler", "true"); // hidden and waiting photos stay blurred until tapped
      f.set(field, new Blob([thumb], { type: TYPES[p.ext] || "image/webp" }), `thumb.${p.ext || "webp"}`);
      return f;
    };
    // If Telegram does not take the image as a photo, a live photo goes as a file.
    // A hidden or waiting photo never goes unblurred: send the text and buttons only.
    const sent = await tgCall(env, "sendPhoto", form("photo"));
    if (!sent.ok) {
      if (kind === "live") await tgCall(env, "sendDocument", form("document"));
      else await tgCall(env, "sendMessage", JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: caption, reply_markup }));
    }
  })());
}

// File type and pixel size from the header bytes, not from what the browser says.
// Returns null for other types. animated is true for animated WebP.
function imageInfo(b) {
  const tag = (o, s) => [...s].every((c, i) => b[o + i] === c.charCodeAt(0));
  const le = (o, n) => { let v = 0; for (let k = n - 1; k >= 0; k--) v = v * 256 + b[o + k]; return v; };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xda) return null; // image data starts, and no size was found
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { ext: "jpg", h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      }
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
    return null;
  }
  if (b.length > 30 && tag(0, "RIFF") && tag(8, "WEBP")) {
    if (tag(12, "VP8 ")) return b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a ? { ext: "webp", w: le(26, 2) & 0x3fff, h: le(28, 2) & 0x3fff } : null;
    if (tag(12, "VP8L")) { const v = le(21, 4); return b[20] === 0x2f ? { ext: "webp", w: (v & 0x3fff) + 1, h: ((v >>> 14) & 0x3fff) + 1 } : null; }
    if (tag(12, "VP8X")) return { ext: "webp", animated: !!(b[20] & 0x02), w: le(24, 3) + 1, h: le(27, 3) + 1 };
  }
  return null;
}

// KV has no head call: read the key as a stream and drop it.
async function kvHas(env, key) {
  const body = await env.PHOTOS.get(key, { type: "stream" });
  if (body) await body.cancel();
  return !!body;
}

const isFile = (f) => f && typeof f === "object" && typeof f.arrayBuffer === "function";
const photoKey = (id, size, ext) => `p/${id}/${size}.${ext}`;

async function postPhoto(req, env, ctx) {
  // The size must be known and small before we read the form.
  const len = req.headers.get("content-length");
  if (!/^\d+$/.test(len || "")) return json({ error: "Bad request." }, 411);
  if (+len > PHOTO.maxBody) return json({ error: "Photo is too large." }, 413);
  if (!/^multipart\/form-data\b/i.test(req.headers.get("content-type") || "")) return json({ error: "Bad request." }, 415);
  let form;
  try { form = await req.formData(); } catch { return json({ error: "Bad request." }, 400); }
  const place = form.get("place"), device = form.get("device");
  if (typeof place !== "string" || !ID_RE.test(place) || typeof device !== "string" || !ID_RE.test(device)) return json({ error: "Bad request." }, 400);
  let text = form.get("text") ?? "";
  if (typeof text !== "string") return json({ error: "Bad request." }, 400);
  text = text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if ([...text].length > PHOTO.text) return json({ error: `Keep the note to ${PHOTO.text} characters.` }, 400);
  const placeInfo = await placeOf(place, req, env);
  if (!placeInfo) return json({ error: "Unknown place." }, 404);

  // A note needs no photo: with no "full" file it is a text-only post, checked by the same Claude call.
  const textOnly = !isFile(form.get("full")) && !isFile(form.get("thumb"));
  if (textOnly && [...text].length < 3) return json({ error: "Add a photo, or write a short note." }, 400);

  // Size first, then the real type and pixel size from the bytes.
  const files = {};
  for (const name of textOnly ? [] : ["full", "thumb"]) {
    const f = form.get(name);
    if (!isFile(f) || !f.size) return json({ error: "Bad request." }, 400);
    if (f.size > PHOTO[name]) return json({ error: "Photo is too large." }, 413);
    const bytes = new Uint8Array(await f.arrayBuffer());
    const info = imageInfo(bytes);
    if (!info) return json({ error: "Only JPEG and WebP photos are allowed." }, 415);
    if (info.animated) return json({ error: "Animated images are not allowed." }, 415);
    const side = PHOTO[name + "Side"];
    if (!(info.w > 0 && info.h > 0) || Math.max(info.w, info.h) > side) return json({ error: `The ${name} image is too big in pixels (at most ${side}).` }, 413);
    files[name] = { bytes, ext: info.ext };
  }
  if (!textOnly && files.full.ext !== files.thumb.ext) return json({ error: "Bad request." }, 400);
  if (!(await humanOk(req, env, form.get("cf-turnstile-response"), "upload"))) return json({ error: "Could not verify that you are a person. Reload the page and try again." }, 403);

  const now = Date.now();
  const { who, prev } = await visitorKeys(req, env);
  // Limits and insert in ONE statement, so parallel uploads cannot pass together. The row goes in before the check.
  const id = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const ext = textOnly ? "none" : files.full.ext; // "none" marks a note with no stored images
  const day = now - 24 * HOUR;
  const ins = await env.DB.prepare(
    `INSERT INTO photos (id, place, who, device, text, ext, bytes, status, reason, ts)
     SELECT ?, ?, ?, ?, ?, ?, ?, 'pending', 'checking', ?
     WHERE (SELECT COUNT(*) FROM photos WHERE ts > ?) < ?
       AND (SELECT COUNT(*) FROM photos WHERE device = ? AND ts > ?) < ?
       AND (SELECT COUNT(*) FROM photos WHERE who IN (?, ?) AND ts > ?) < ?
       AND (SELECT COUNT(*) FROM photos WHERE place = ? AND ts > ?) < ?
       AND (SELECT COALESCE(SUM(bytes), 0) FROM photos WHERE ext <> '' AND status IN ('live', 'hidden', 'pending')) < ?`,
  ).bind(id, place, who, device, text || null, ext, textOnly ? 0 : files.full.bytes.length + files.thumb.bytes.length, now,
    day, PHOTO.checks24h, device, day, PHOTO.device24h, who, prev || "-", day, PHOTO.who24h, place, day, PHOTO.place24h, KV_STORE_MAX).run();
  if (!ins.meta.changes) {
    // Only to pick the message: the refusal itself was decided inside the statement.
    const count = (sql, ...args) => env.DB.prepare(`SELECT COUNT(*) AS n FROM photos WHERE ${sql}`).bind(...args);
    const [all, plc, used] = (await env.DB.batch([
      count("ts > ?", day), count("place = ? AND ts > ?", place, day),
      env.DB.prepare("SELECT COALESCE(SUM(bytes), 0) AS n FROM photos WHERE ext <> '' AND status IN ('live', 'hidden', 'pending')"),
    ])).map((r) => r.results[0].n);
    if (all >= PHOTO.checks24h || used >= KV_STORE_MAX) return json({ error: "Photo uploads are paused for today. Try again tomorrow." }, 503);
    if (plc >= PHOTO.place24h) return json({ error: "This place has enough new photos for today." }, 429);
    return json({ error: "You have added enough photos today. Try again tomorrow." }, 429);
  }
  const setStatus = (status, reason) => env.DB.prepare("UPDATE photos SET status = ?, reason = ? WHERE id = ?").bind(status, reason, id).run();
  // If one write fails, remove the other, so no half photo stays in KV.
  const store = async () => {
    if (textOnly) return; // nothing to write
    const put = (size) => env.PHOTOS.put(photoKey(id, size, ext), files[size].bytes);
    const done = await Promise.allSettled([put("full"), put("thumb")]);
    if (done.some((d) => d.status === "rejected")) {
      const gone = await Promise.allSettled([env.PHOTOS.delete(photoKey(id, "full", ext)), env.PHOTOS.delete(photoKey(id, "thumb", ext))]);
      // ext is blanked only when both keys are surely gone.
      if (gone.every((g) => g.status === "fulfilled")) await env.DB.prepare("UPDATE photos SET ext = '' WHERE id = ?").bind(id).run().catch(() => {});
      throw new Error("storage error");
    }
  };

  // Claude sees the very images that would go live: full and thumb.
  let verdict = null;
  try {
    verdict = await checkPhoto(env, textOnly ? null : files.full.bytes, textOnly ? null : files.thumb.bytes, TYPES[ext], text, placeInfo);
  } catch (e) {
    console.error("photo check failed", String((e && e.message) || e).slice(0, 200));
  }
  try {
    if (!verdict) {
      // Fail closed: keep the images, hide the photo, and let the owner look.
      await store();
      await setStatus("pending", "check failed");
      alertTg(ctx, env, "pending", { id, place, placeName: placeInfo.name, text, reason: "check failed", noImage: textOnly, ext }, async () => files.thumb.bytes);
      return json({ status: "pending" });
    }
    if (!verdict.allow) {
      // The detail stays in D1. The visitor gets a generic message.
      await setStatus("rejected", [verdict.reason, ...verdict.categories].filter(Boolean).join(" | "));
      return json({ status: "rejected", reason: textOnly ? NO_NOTE : NO_PHOTO });
    }
    await store();
    await setStatus("live", verdict.reason || "ok");
    alertTg(ctx, env, "live", { id, place, placeName: placeInfo.name, text, reason: verdict.reason || "ok", noImage: textOnly, ext }, async () => files.thumb.bytes);
  } catch (e) {
    console.error("photo store failed", String((e && e.message) || e).slice(0, 100));
    await setStatus("failed", "storage error").catch(() => {});
    return json({ error: "Something went wrong. Try again later." }, 500);
  }
  return json({ status: "live", id });
}

async function getPhotos(url, env) {
  const place = url.searchParams.get("place") || "";
  if (!ID_RE.test(place)) return json({ error: "Bad place id." }, 400);
  const { results } = await env.DB.prepare(
    "SELECT id, text, ts, ext <> 'none' AS img FROM photos WHERE place = ? AND status = 'live' ORDER BY ts DESC LIMIT ?",
  ).bind(place, PHOTO.perPlace).all();
  return json({ photos: results });
}

// Public image. Only live photos are served, checked in D1 on every request, with no shared cache.
// Browsers keep an image for 5 minutes, so a hidden photo can stay that long on a phone that already loaded it.
async function getImg(m, env) {
  const row = await env.DB.prepare("SELECT ext FROM photos WHERE id = ? AND status = 'live'").bind(m[1]).first();
  const body = row && row.ext !== "none" && await env.PHOTOS.get(photoKey(m[1], m[2], row.ext), { type: "stream" });
  if (!body) return new Response("Not found.", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(body, { headers: { "content-type": TYPES[row.ext], "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" } });
}

async function postPhotoReport(req, env, ctx) {
  const len = req.headers.get("content-length");
  if (!/^\d+$/.test(len || "")) return json({ error: "Bad request." }, 411);
  if (+len > 2400) return json({ error: "Request too large." }, 413);
  if (!isJson(req)) return json({ error: "Bad request." }, 415);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
  const id = body && body.id;
  if (typeof id !== "string" || !PHOTO_ID_RE.test(id)) return json({ error: "Bad request." }, 400);
  if (!(await humanOk(req, env, body.ts, "report"))) return json({ error: "Could not verify that you are a person. Reload the page and try again." }, 403);
  const photo = await env.DB.prepare("SELECT place, ext, text FROM photos WHERE id = ? AND status = 'live'").bind(id).first();
  if (!photo) return json({ error: "This photo is no longer shown." }, 404);

  const now = Date.now();
  // A /48 here, so one network cannot hide a photo by hopping between its /64 blocks.
  const { who, prev } = await visitorKeys(req, env, 3);
  // Today's or yesterday's key counts as the same person, so a new daily salt does not give a second report.
  const same = await env.DB.prepare("SELECT 1 AS x FROM photo_reports WHERE photo = ? AND who IN (?, ?)").bind(id, who, prev || "-").first();
  if (same) return json({ error: "You already reported this photo." }, 429);
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM photo_reports WHERE who IN (?, ?) AND ts > ?").bind(who, prev || "-", now - HOUR).first();
  if (n >= PHOTO.reportsWho1h) return json({ error: "Too many reports. Try again in an hour." }, 429);
  const ins = await env.DB.prepare("INSERT OR IGNORE INTO photo_reports (photo, who, ts) VALUES (?, ?, ?)").bind(id, who, now).run();
  if (!ins.meta.changes) return json({ error: "You already reported this photo." }, 429);
  // Two different reporters hide it. The owner can restore it.
  const row = await env.DB.prepare(
    "UPDATE photos SET reports = reports + 1, status = CASE WHEN status = 'live' AND reports + 1 >= ? THEN 'hidden' ELSE status END WHERE id = ? RETURNING status, reports",
  ).bind(PHOTO.hideAt, id).first();
  if (row && row.status === "hidden" && tgOn(env)) {
    const info = await placeOf(photo.place, req, env);
    const noImage = photo.ext === "none";
    alertTg(ctx, env, "hidden", { id, place: photo.place, placeName: info && info.name, text: photo.text, reason: `${row.reports} reports`, noImage, ext: photo.ext },
      async () => { const b = await env.PHOTOS.get(photoKey(id, "thumb", photo.ext), { type: "arrayBuffer" }); return b && new Uint8Array(b); });
  }
  return json({ ok: true });
}

// Constant-time string compare: hash both, then compare the hashes.
async function safeEq(x, y) {
  const enc = new TextEncoder();
  const [a, b] = (await Promise.all([x, y].map((v) => crypto.subtle.digest("SHA-256", enc.encode(v))))).map((v) => new Uint8Array(v));
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Owner endpoints: header "authorization: Bearer <ADMIN_TOKEN>".
async function isAdmin(req, env) {
  const m = /^Bearer (.{1,200})$/.exec(req.headers.get("authorization") || "");
  return !!m && !!env.ADMIN_TOKEN && safeEq(m[1], env.ADMIN_TOKEN);
}

// delete, hide or restore one photo. Used by the admin endpoint and the Telegram buttons.
// Returns { status } or { error, code }. A note ("none" ext) has no keys in KV.
async function photoAction(env, id, action) {
  const row = await env.DB.prepare("SELECT ext, status FROM photos WHERE id = ?").bind(id).first();
  if (!row) return { error: "No such photo.", code: 404 };
  const hasImg = !!row.ext && row.ext !== "none";
  if (action === "delete") {
    // If the KV call fails, the row stays "deleted" with its ext, and the hourly job tries again.
    let ext = row.ext;
    if (hasImg) {
      try { await Promise.all([env.PHOTOS.delete(photoKey(id, "full", ext)), env.PHOTOS.delete(photoKey(id, "thumb", ext))]); ext = ""; } catch (e) { console.error("kv delete failed", id); }
    } else ext = "";
    await env.DB.prepare("UPDATE photos SET status = 'deleted', text = NULL, ext = ? WHERE id = ?").bind(ext, id).run();
    return { status: "deleted" };
  }
  if (action === "hide") {
    if (row.status !== "live") return { error: "Only a live photo can be hidden.", code: 409 };
    await env.DB.prepare("UPDATE photos SET status = 'hidden' WHERE id = ?").bind(id).run();
    return { status: "hidden" };
  }
  // restore: only hidden and pending ones, and only if the images are still stored.
  if (!["hidden", "pending"].includes(row.status) || !row.ext || (hasImg && !(await kvHas(env, photoKey(id, "full", row.ext))))) {
    return { error: "This photo has no stored image to restore.", code: 409 };
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE photos SET status = 'live', reports = 0 WHERE id = ?").bind(id),
    env.DB.prepare("DELETE FROM photo_reports WHERE photo = ?").bind(id), // so new reports count from zero
  ]);
  return { status: "live" };
}

// Telegram webhook. Only Telegram (the secret header) and only the owner's chat are accepted.
async function postTelegram(req, env, ctx) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token") || "";
  if (!env.TELEGRAM_WEBHOOK_SECRET || !(await safeEq(secret, env.TELEGRAM_WEBHOOK_SECRET))) return json({ error: "Not allowed." }, 401);
  if (+(req.headers.get("content-length") || 0) > 20000) return json({ ok: true });
  let u;
  try { u = await req.json(); } catch { return json({ ok: true }); }
  const cb = u && u.callback_query;
  const chat = String(env.TELEGRAM_CHAT_ID || "");
  const msg = cb && cb.message;
  if (!cb || !chat || String(cb.from && cb.from.id) !== chat || String(msg && msg.chat && msg.chat.id) !== chat) return json({ ok: true });
  const m = /^(del|hide|res):([a-f0-9]{16})$/.exec(String(cb.data || ""));
  if (!m) return json({ ok: true });
  const r = await photoAction(env, m[2], { del: "delete", hide: "hide", res: "restore" }[m[1]]);
  const said = r.error || { deleted: "Deleted by owner", hidden: "Hidden by owner", live: "Restored by owner" }[r.status];
  const calls = [tgCall(env, "answerCallbackQuery", JSON.stringify({ callback_query_id: String(cb.id), text: said }))];
  if (!r.error && msg && msg.message_id && r.status === "deleted") {
    // A deleted photo leaves no copy in the chat either.
    calls.push(tgCall(env, "deleteMessage", JSON.stringify({ chat_id: chat, message_id: msg.message_id })));
  } else if (!r.error && msg && msg.message_id) {
    const old = String(msg.caption || msg.text || "");
    const edit = { chat_id: chat, message_id: msg.message_id, reply_markup: tgKeys(m[2], r.status) };
    if (msg.caption !== undefined) calls.push(tgCall(env, "editMessageCaption", JSON.stringify({ ...edit, caption: `${old}\n\n${said}`.slice(0, 1000) })));
    else calls.push(tgCall(env, "editMessageText", JSON.stringify({ ...edit, text: `${old}\n\n${said}`.slice(0, 4000) })));
  }
  ctx.waitUntil(Promise.all(calls));
  return json({ ok: true });
}

async function adminPhotos(req, url, env) {
  const m = /^\/api\/admin\/img\/([a-f0-9]{16})\/(full|thumb)$/.exec(url.pathname);
  if (m && req.method === "GET") {
    const row = await env.DB.prepare("SELECT ext FROM photos WHERE id = ?").bind(m[1]).first();
    const body = row && row.ext && row.ext !== "none" && await env.PHOTOS.get(photoKey(m[1], m[2], row.ext), { type: "stream" });
    if (!body) return json({ error: "No image." }, 404);
    return new Response(body, { headers: { "content-type": TYPES[row.ext], "cache-control": "private, no-store" } });
  }
  if (url.pathname === "/api/admin/summary" && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT status, COUNT(*) AS n FROM photos WHERE status IN ('hidden', 'pending') GROUP BY status").all();
    return json({ hidden: 0, pending: 0, ...Object.fromEntries(results.map((r) => [r.status, r.n])) });
  }
  if (url.pathname === "/api/admin/photos" && req.method === "GET") {
    const status = url.searchParams.get("status") || "pending";
    if (!["live", "hidden", "pending", "rejected", "failed", "deleted"].includes(status)) return json({ error: "Bad status." }, 400);
    const { results } = await env.DB.prepare(
      "SELECT id, place, text, status, reason, reports, bytes, ts FROM photos WHERE status = ? ORDER BY ts DESC LIMIT 100",
    ).bind(status).all();
    return json({ photos: results });
  }
  if (url.pathname === "/api/admin/photo" && req.method === "POST") {
    if (!isJson(req)) return json({ error: "Bad request." }, 415);
    let body;
    try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
    const { id, action } = body || {};
    if (typeof id !== "string" || !PHOTO_ID_RE.test(id) || !["restore", "delete", "hide"].includes(action)) return json({ error: "Bad request." }, 400);
    const r = await photoAction(env, id, action);
    if (r.error) return json({ error: r.error }, r.code);
    return json({ ok: true, status: r.status });
  }
  return json({ error: "Not found." }, 404);
}
// Hourly job (cron trigger in wrangler.jsonc): forget visitor keys, drop old rows, finish deletes.
// No KV list calls (1,000 a day on the free plan): keys are rebuilt from the row id and ext.
// At most KV_DELETES_PER_RUN KV deletes per run, so the daily delete limit cannot be passed.
async function cleanup(env) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE photos SET who = NULL, device = NULL WHERE (who IS NOT NULL OR device IS NOT NULL) AND ts < ?").bind(now - 24 * HOUR),
    // A check that never finished and left no images.
    env.DB.prepare("UPDATE photos SET status = 'failed', reason = 'timed out', ext = '' WHERE status = 'pending' AND reason = 'checking' AND ts < ?").bind(now - HOUR),
    env.DB.prepare("DELETE FROM photo_reports WHERE ts < ?").bind(now - 30 * 24 * HOUR),
  ]);
  let budget = KV_DELETES_PER_RUN;
  const dropKeys = async (r) => {
    await Promise.all([env.PHOTOS.delete(photoKey(r.id, "full", r.ext)), env.PHOTOS.delete(photoKey(r.id, "thumb", r.ext))]);
    await env.DB.prepare("UPDATE photos SET ext = '' WHERE id = ?").bind(r.id).run();
    budget -= 2;
  };
  // Deleted photos whose keys are still there (the admin delete failed): finish them first.
  const pending = await env.DB.prepare("SELECT id, ext FROM photos WHERE status = 'deleted' AND ext NOT IN ('', 'none') LIMIT ?").bind(budget / 2).all();
  for (const r of pending.results) await dropKeys(r);
  // Rows that go after 30 days. Only a 'failed' row with an ext may still have keys (a half write that could not be undone).
  const old = await env.DB.prepare(
    "SELECT id, ext, status FROM photos WHERE (status IN ('rejected', 'failed') OR (status = 'deleted' AND ext = '')) AND ts < ? LIMIT 200",
  ).bind(now - 30 * 24 * HOUR).all();
  let rows = 0;
  for (const r of old.results) {
    if (r.status === "failed" && r.ext && r.ext !== "none") {
      if (budget < 2) continue;
      await dropKeys(r);
    }
    await env.DB.prepare("DELETE FROM photos WHERE id = ?").bind(r.id).run();
    rows++;
  }
  console.log(JSON.stringify({ step: "cleanup", kv_deletes: KV_DELETES_PER_RUN - budget, removed_rows: rows }));
}

export default {
  // Cron trigger: see wrangler.jsonc.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanup(env));
  },
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      // Cross-site pages must not post for a visitor. Admin routes use the bearer token instead.
      if (req.method === "POST" && /^\/api\/(report|visit|photo|photo-report)$/.test(url.pathname) && !sameSite(req, env, url.pathname === "/api/report" || url.pathname === "/api/visit")) {
        return json({ error: "Not allowed." }, 403);
      }
      if (url.pathname === "/api/reports" && req.method === "GET") return await getReports(url, env);
      if (url.pathname === "/api/report" && req.method === "POST") return await postReport(req, env, ctx);
      if (url.pathname === "/api/visits" && req.method === "GET") return await getVisits(url, env);
      if (url.pathname === "/api/activity" && req.method === "GET") return await getActivity(env);
      if (url.pathname === "/api/visit" && req.method === "POST") return await postVisit(req, env, ctx);
      if (url.pathname === "/api/photos" && req.method === "GET") return await getPhotos(url, env);
      if (url.pathname === "/api/photo" && req.method === "POST") return await postPhoto(req, env, ctx);
      if (url.pathname === "/api/photo-report" && req.method === "POST") return await postPhotoReport(req, env, ctx);
      const img = /^\/api\/img\/([a-f0-9]{16})\/(full|thumb)$/.exec(url.pathname);
      if (img && req.method === "GET") return await getImg(img, env);
      // The Telegram webhook is exempt from the Origin rule: it is protected by its secret header and the owner's chat id.
      if (url.pathname === "/api/tg" && req.method === "POST") return await postTelegram(req, env, ctx);
      if (url.pathname.startsWith("/api/admin/")) {
        if (!(await isAdmin(req, env))) return json({ error: "Not allowed." }, 401);
        return await adminPhotos(req, url, env);
      }
      return json({ error: "Not found." }, 404);
    } catch (e) {
      console.error(String((e && e.message) || e).slice(0, 200));
      return json({ error: "Something went wrong. Try again later." }, 500);
    }
  },
};
