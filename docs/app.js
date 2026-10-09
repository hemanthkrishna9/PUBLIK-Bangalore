(() => {
  const REPO = "https://github.com/hemanthkrishna9/PUBLIK-Bangalore";
  const PAGE = 50;
  const CATS = [
    ["all", "All"], ["park", "Parks"], ["playground", "Playgrounds"],
    ["lake", "Lakes"], ["library", "Libraries"], ["toilet", "Toilets"],
  ];
  const CAT_LABEL = { park: "Park", playground: "Playground", lake: "Lake", library: "Library", toilet: "Public toilet" };
  const SRC_LABEL = { bbmp: "BBMP park list", osm: "OpenStreetMap" };

  const $ = (id) => document.getElementById(id);
  const state = { places: [], cat: "all", q: "", openOnly: false, freeOnly: false, accessOnly: false, here: null, shown: PAGE, sort: "default" };
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const ROW_TAGS = ["Free", "Paid", "Wheelchair access"];
  const hasFeat = (p, f) => !!p.feat && p.feat.includes(f);

  // Formatters are costly to build, so make them once.
  const HM_FMT = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
  const WD_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "long" });

  // Current minutes since midnight in Bengaluru, whatever the viewer's timezone.
  function nowMinutes(d) {
    const parts = HM_FMT.formatToParts(d);
    const h = +parts.find((p) => p.type === "hour").value % 24;
    const m = +parts.find((p) => p.type === "minute").value;
    return h * 60 + m;
  }
  // Day of week in Bengaluru, 0 = Sunday (same numbering as Google).
  const today = (d) => DAYS.indexOf(WD_FMT.format(d));

  // Clock read once per render or card open, not once per place.
  let clock = { now: 0, day: 0 };
  function tick() { const d = new Date(); clock = { now: nowMinutes(d), day: today(d) }; }

  // Opening ranges for a day, [] if closed all day, null if unknown.
  function dayRanges(p, day) {
    if (p.hours) return p.hours;
    if (p.week) return p.week[day] || [];
    return null;
  }
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

  function status(p) {
    const ranges = dayRanges(p, clock.day);
    if (!ranges) return { cls: "unknown", text: "Timings not known" };
    if (!ranges.length) return { cls: "closed", text: "Closed today" };
    const now = clock.now;
    for (const [a, b] of ranges) {
      if (now >= toMin(a) && now < toMin(b)) return { cls: "open", text: `Open till ${fmt(b)}` };
    }
    const next = ranges.map(([a]) => toMin(a)).filter((a) => a > now).sort((x, y) => x - y)[0];
    if (next !== undefined) return { cls: "closed", text: `Closed, opens ${fmt(minToT(next))}` };
    // Done for today: find the next day that has opening hours.
    for (let i = 1; i <= 7; i++) {
      const day = (clock.day + i) % 7;
      const rs = dayRanges(p, day);
      if (rs && rs.length) {
        const when = i === 1 ? "tomorrow" : `on ${DAYS[day]}`;
        return { cls: "closed", text: `Closed, opens ${fmt(rs[0][0])} ${when}` };
      }
    }
    return { cls: "closed", text: "Closed" };
  }
  const minToT = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  function fmt(t) {
    if (t === "24:00") return "midnight";
    let [h, m] = t.split(":").map(Number);
    const ap = h >= 12 ? "pm" : "am";
    h = h % 12 || 12;
    return m ? `${h}:${String(m).padStart(2, "0")} ${ap}` : `${h} ${ap}`;
  }

  function distKm(p) {
    if (!state.here) return null;
    const R = 6371, rad = Math.PI / 180;
    const dLat = (p.lat - state.here.lat) * rad, dLng = (p.lng - state.here.lng) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(state.here.lat * rad) * Math.cos(p.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  const fmtDist = (d) => (d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`);

  function filtered() {
    const q = state.q.trim().toLowerCase();
    let out = state.places.filter((p) =>
      (state.cat === "all" || p.cat === state.cat) &&
      (!q || p.name.toLowerCase().includes(q) || (p.area || "").toLowerCase().includes(q)) &&
      (!state.freeOnly || hasFeat(p, "Free")) &&
      (!state.accessOnly || hasFeat(p, "Wheelchair access")) &&
      (!state.openOnly || status(p).cls === "open"));
    if (state.here) out.forEach((p) => (p._d = distKm(p)));
    const known = (p) => !!(p.hours || p.week);
    if (state.sort === "near" && state.here) {
      out.sort((a, b) => a._d - b._d);
    } else if (state.sort === "popular") {
      // Google review count first, then park size from the BBMP list.
      out.sort((a, b) => (b.reviews || 0) - (a.reviews || 0) || (b.sqm || 0) - (a.sqm || 0) || a.name.localeCompare(b.name));
    } else {
      // Places with known timings first, then by name.
      out.sort((a, b) => (known(b) - known(a)) || a.name.localeCompare(b.name));
    }
    return out;
  }

  function render() {
    tick();
    const items = filtered();
    $("count").textContent = `${items.length} places`;
    $("empty").hidden = items.length > 0;
    const list = $("list");
    list.replaceChildren(...items.slice(0, state.shown).map(row));
    $("more").hidden = items.length <= state.shown;
  }

  function row(p) {
    const li = document.createElement("li");
    li.className = "item";
    li.tabIndex = 0;
    li.dataset.id = p.id;
    const s = status(p);
    li.innerHTML = `<span class="name"></span><span class="dist"></span>
      <span class="meta"><span class="cat"></span> <span class="pill ${s.cls}"></span></span>`;
    const tags = (p.feat || []).filter((f) => ROW_TAGS.includes(f));
    if (tags.length) {
      const t = document.createElement("span");
      t.className = "tags";
      t.textContent = tags.join(" · ");
      li.append(t);
    }
    li.querySelector(".name").textContent = p.name;
    li.querySelector(".dist").textContent = p._d != null && state.here ? fmtDist(p._d) : "";
    li.querySelector(".cat").textContent = CAT_LABEL[p.cat] + (p.area ? ` · ${p.area}` : "") +
      (p.reviews ? ` · ${ratingText(p)}` : "") + " ·";
    li.querySelector(".pill").textContent = s.text;
    li.addEventListener("click", () => open(p));
    li.addEventListener("keydown", (e) => { if (e.key === "Enter") open(p); });
    return li;
  }

  const ratingText = (p) => `★ ${p.rating ? p.rating.toFixed(1) : "-"} (${p.reviews.toLocaleString("en-IN")})`;

  // History: a card opened by a tap pushes #id, so phone Back closes it.
  let openId = null;   // id of the place in the open card
  let pushed = false;  // true when open() added the history entry
  let opener = null;   // element to refocus on close

  function open(p, fromHistory) {
    tick();
    if (openId === null) opener = document.activeElement;
    openId = p.id;
    $("d-cat").textContent = CAT_LABEL[p.cat];
    $("d-name").textContent = p.name;
    $("d-area").textContent = [p.area, p._d != null && state.here ? fmtDist(p._d) + " away" : ""].filter(Boolean).join(" · ");
    const s = status(p);
    $("d-status").innerHTML = `<span class="pill ${s.cls}"></span>`;
    $("d-status").firstChild.textContent = s.text;

    const hours = $("d-hours");
    hours.replaceChildren();
    const line = (text, bold) => {
      const d = document.createElement("p");
      d.className = "hours-line" + (bold ? " today" : "");
      d.textContent = text;
      hours.append(d);
    };
    const rangesText = (rs) => !rs || !rs.length ? "Closed"
      : rs.map(([a, b]) => (a === "00:00" && b === "24:00" ? "Open 24 hours" : `${fmt(a)} to ${fmt(b)}`)).join(", ");
    if (p.hours) {
      line(rangesText(p.hours) + " (every day)");
    } else if (p.week) {
      const t = clock.day;
      for (let i = 0; i < 7; i++) {
        const d = (i + 1) % 7; // Monday first
        line(`${DAYS[d]}: ${rangesText(p.week[d])}`, d === t);
      }
    } else {
      const d = document.createElement("p");
      d.className = "hours-line";
      d.textContent = p.hoursText ? p.hoursText : "We do not know the timings yet. Tap Open in Google Maps to check, or report them below.";
      hours.append(d);
    }
    const src = document.createElement("p");
    src.className = "src";
    src.textContent = p.hoursSrc === "BBMP park list" ? "Official BBMP timings, not checked on site."
      : `Source: ${p.hoursSrc || SRC_LABEL[p.src]}. Timings can change, so check at the place.`;
    hours.append(src);

    $("d-rating").textContent = p.reviews ? `${ratingText(p)} on Google Maps` : "";
    $("d-feat").replaceChildren(...(p.feat || []).map((f) => { const s = document.createElement("span"); s.textContent = f; return s; }));

    const ll = `${p.lat},${p.lng}`;
    $("d-map").src = `https://maps.google.com/maps?q=${ll}&z=16&output=embed`;
    $("d-dir").href = `https://www.google.com/maps/dir/?api=1&destination=${ll}`;
    $("d-gmap").href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}%20${ll}`;
    const title = encodeURIComponent(`Wrong info: ${p.name} (${p.id})`);
    const body = encodeURIComponent(`Place: ${p.name}\nID: ${p.id}\nLocation: ${ll}\n\nWhat is wrong (timings, closed, not public, wrong place)?\n`);
    $("d-report").href = `${REPO}/issues/new?title=${title}&body=${body}`;

    $("sheet").hidden = false;
    document.body.style.overflow = "hidden";
    if (!fromHistory && location.hash !== `#${p.id}`) {
      history.pushState({ place: p.id }, "", `#${p.id}`);
      pushed = true;
    }
    $("sheet").querySelector(".close").focus();
  }

  // fromHistory: the URL already changed (Back, or a #id link), so leave history alone.
  function close(fromHistory) {
    if (openId === null) return;
    const id = openId;
    openId = null;
    $("sheet").hidden = true;
    $("d-map").src = "about:blank";
    document.body.style.overflow = "";
    if (!fromHistory) {
      if (pushed) history.back(); // the popstate that follows finds no open card and does nothing
      else history.replaceState(null, "", location.pathname + location.search);
    }
    pushed = false;
    const back = opener && opener.isConnected ? opener : $("list").querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (back) back.focus();
    opener = null;
  }

  // Back/Forward and #id links: show the card the URL names, or none.
  function syncHash() {
    const hash = decodeURIComponent(location.hash.slice(1));
    const p = hash && state.places.find((x) => x.id === hash);
    if (p) { if (openId !== p.id) { pushed = false; open(p, true); } }
    else close(true);
  }

  function setupChips() {
    $("chips").replaceChildren(...CATS.map(([k, label]) => {
      const b = document.createElement("button");
      b.className = "chip";
      b.type = "button";
      b.textContent = label;
      b.setAttribute("aria-pressed", k === state.cat);
      b.addEventListener("click", () => {
        state.cat = k; state.shown = PAGE;
        document.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", c === b));
        render();
      });
      return b;
    }));
  }

  // Nearest sort needs a location; drop back to the default sort without one.
  function resetSort() {
    if (state.sort !== "near" || state.here) return;
    state.sort = "default";
    $("sort").value = "default";
    render();
  }

  function nearMe() {
    const btn = $("near");
    if (!navigator.geolocation) { btn.textContent = "Location not available"; resetSort(); return; }
    btn.textContent = "Finding you...";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        state.shown = PAGE;
        state.sort = "near";
        $("sort").value = "near";
        btn.textContent = "Location on";
        render();
      },
      () => { btn.textContent = "Location blocked. Try again"; resetSort(); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }

  async function init() {
    setupChips();
    $("q").addEventListener("input", (e) => { state.q = e.target.value; state.shown = PAGE; render(); });
    $("openNow").addEventListener("change", (e) => { state.openOnly = e.target.checked; state.shown = PAGE; render(); });
    $("freeOnly").addEventListener("change", (e) => { state.freeOnly = e.target.checked; state.shown = PAGE; render(); });
    $("accessOnly").addEventListener("change", (e) => { state.accessOnly = e.target.checked; state.shown = PAGE; render(); });
    $("near").addEventListener("click", () => nearMe());
    $("sort").addEventListener("change", (e) => {
      state.sort = e.target.value; state.shown = PAGE;
      if (state.sort === "near" && !state.here) nearMe(); else render();
    });
    $("more").addEventListener("click", () => { state.shown += PAGE; render(); });
    $("sheet").addEventListener("click", (e) => { if (e.target.hasAttribute("data-close")) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sheet").hidden) close(); });
    // Both fire for a #id link; syncHash does nothing the second time.
    window.addEventListener("popstate", syncHash);
    window.addEventListener("hashchange", syncHash);

    const res = await fetch("data/places.json");
    const data = await res.json();
    state.places = data.places;
    $("built").textContent = `Data updated ${data.built}.`;
    render();
    syncHash();
  }

  init().catch((e) => { $("count").textContent = "Could not load places. Refresh the page."; console.error(e); });
})();
