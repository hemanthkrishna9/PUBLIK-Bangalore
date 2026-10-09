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
  const state = { places: [], cat: "all", q: "", openOnly: false, here: null, shown: PAGE, sort: "default" };
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Current minutes since midnight in Bengaluru, whatever the viewer's timezone.
  function nowMinutes() {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(new Date());
    const h = +parts.find((p) => p.type === "hour").value % 24;
    const m = +parts.find((p) => p.type === "minute").value;
    return h * 60 + m;
  }
  // Day of week in Bengaluru, 0 = Sunday (same numbering as Google).
  function today() {
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "long" }).format(new Date());
    return DAYS.indexOf(wd);
  }
  // Opening ranges for today, [] if closed all day, null if unknown.
  function todayRanges(p) {
    if (p.hours) return p.hours;
    if (p.week) return p.week[today()] || [];
    return null;
  }
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

  function status(p) {
    const ranges = todayRanges(p);
    if (!ranges) return { cls: "unknown", text: "Timings not known" };
    if (!ranges.length) return { cls: "closed", text: "Closed today" };
    const now = nowMinutes();
    for (const [a, b] of ranges) {
      if (now >= toMin(a) && now < toMin(b)) return { cls: "open", text: `Open till ${fmt(b)}` };
    }
    const next = ranges.map(([a]) => toMin(a)).filter((a) => a > now).sort((x, y) => x - y)[0];
    const first = ranges[0][0];
    return { cls: "closed", text: next !== undefined ? `Closed, opens ${fmt(minToT(next))}` : `Closed, opens ${fmt(first)}` };
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
    const s = status(p);
    li.innerHTML = `<span class="name"></span><span class="dist"></span>
      <span class="meta"><span class="cat"></span> <span class="pill ${s.cls}"></span></span>`;
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

  function open(p) {
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
      const t = today();
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
    src.textContent = `Source: ${p.hoursSrc || SRC_LABEL[p.src]}. Timings can change, so check at the place.`;
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
    history.replaceState(null, "", `#${p.id}`);
  }

  function close() {
    $("sheet").hidden = true;
    $("d-map").src = "about:blank";
    document.body.style.overflow = "";
    history.replaceState(null, "", location.pathname + location.search);
  }

  function setupChips() {
    $("chips").replaceChildren(...CATS.map(([k, label]) => {
      const b = document.createElement("button");
      b.className = "chip";
      b.role = "tab";
      b.textContent = label;
      b.setAttribute("aria-selected", k === state.cat);
      b.addEventListener("click", () => {
        state.cat = k; state.shown = PAGE;
        document.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-selected", c === b));
        render();
      });
      return b;
    }));
  }

  function nearMe() {
    const btn = $("near");
    if (!navigator.geolocation) { btn.textContent = "Location not available"; return; }
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
      () => { btn.textContent = "Location blocked. Try again"; },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }

  async function init() {
    setupChips();
    $("q").addEventListener("input", (e) => { state.q = e.target.value; state.shown = PAGE; render(); });
    $("openNow").addEventListener("change", (e) => { state.openOnly = e.target.checked; state.shown = PAGE; render(); });
    $("near").addEventListener("click", () => nearMe());
    $("sort").addEventListener("change", (e) => {
      state.sort = e.target.value; state.shown = PAGE;
      if (state.sort === "near" && !state.here) nearMe(); else render();
    });
    $("more").addEventListener("click", () => { state.shown += PAGE; render(); });
    $("sheet").addEventListener("click", (e) => { if (e.target.hasAttribute("data-close")) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sheet").hidden) close(); });

    const res = await fetch("data/places.json");
    const data = await res.json();
    state.places = data.places;
    $("built").textContent = `Data updated ${data.built}.`;
    render();
    const hash = location.hash.slice(1);
    const linked = hash && state.places.find((p) => p.id === hash);
    if (linked) open(linked);
  }

  init().catch((e) => { $("count").textContent = "Could not load places. Refresh the page."; console.error(e); });
})();
