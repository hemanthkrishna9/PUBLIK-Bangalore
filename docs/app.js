(() => {
  const REPO = "https://github.com/hemanthkrishna9/PUBLIK-Bangalore";
  const PAGE = 50;
  const CATS = [
    ["all", "All"], ["park", "Parks"], ["playground", "Playgrounds"],
    ["lake", "Lakes"], ["library", "Libraries"], ["toilet", "Toilets"],
  ];
  // Line pictograms, drawn in currentColor so the CSS sets their color.
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    all: svg('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>'),
    park: svg('<circle cx="12" cy="9" r="6"/><path d="M12 15v6M9 21h6"/>'),
    playground: svg('<path d="M4 21 8 4h8l4 17M10.5 4v10M13.5 4v10M9 14h6"/>'),
    lake: svg('<path d="M2 9c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/>'),
    library: svg('<path d="M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1zM12 6v14"/>'),
    toilet: svg('<text x="12" y="16.5" text-anchor="middle" font-size="11" font-weight="900" font-family="Baloo Tamma 2, sans-serif" fill="currentColor" stroke="none">WC</text>'),
  };
  const KN = { all: "ಎಲ್ಲಾ", park: "ಉದ್ಯಾನ", playground: "ಆಟದ ಮೈದಾನ", lake: "ಕೆರೆ", library: "ಗ್ರಂಥಾಲಯ", toilet: "ಶೌಚಾಲಯ" };
  const CAT_LABEL = { park: "Park", playground: "Playground", lake: "Lake", library: "Library", toilet: "Public toilet" };
  const SRC_LABEL = { bbmp: "BBMP park list", bbmp16: "BBMP park list 2016", osm: "OpenStreetMap" };

  const $ = (id) => document.getElementById(id);
  const state = { places: [], cat: "all", q: "", openOnly: false, freeOnly: false, accessOnly: false, here: null, shown: PAGE, sort: "default", view: "list" };
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const ROW_TAGS = ["Free", "Paid", "Wheelchair access"];
  const hasFeat = (p, f) => !!p.feat && p.feat.includes(f);
  const KINDS = [["clean", "Clean"], ["dirty", "Dirty"], ["crowded", "Crowded"], ["quiet", "Quiet"], ["open", "Open now"], ["closed", "Closed now"]];
  const KIND_LABEL = Object.fromEntries(KINDS);
  const TAP_GAP = 30 * 60 * 1000; // one tap per kind per place every 30 minutes
  // "I went here": [key, question, summary label, [[answer, button label, summary text], ...]].
  const VISIT_Q = [
    ["entry", "Could you just walk in?", "Entry",
      [["walkin", "Yes, walked in", "Anyone can walk in"], ["id", "Needed ID", "You need an ID"], ["member", "Members only", "Members only"]]],
    ["feel", "How did it feel?", "Feels",
      [["quiet", "Quiet", "Quiet"], ["lively", "Lively", "Lively"], ["crowded", "Crowded", "Crowded"]]],
    ["first", "Easy for a first-timer?", "First-timers",
      [["yes", "Yes", "Easy"], ["okay", "Okay", "Okay"], ["no", "Not really", "Not easy"]]],
  ];

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
      // Open now first, then places with known timings, then the most reviewed.
      const rank = (p) => (status(p).cls === "open" ? 0 : known(p) ? 1 : 2);
      out.forEach((p) => (p._r = rank(p)));
      out.sort((a, b) => a._r - b._r || (b.reviews || 0) - (a.reviews || 0) || a.name.localeCompare(b.name));
    }
    return out;
  }

  function render() {
    tick();
    const items = filtered();
    $("count").textContent = `${items.length} ${items.length === 1 ? "place" : "places"}`;
    $("empty").hidden = items.length > 0;
    if (state.view === "map") { $("more").hidden = true; drawMap(items); return; }
    const list = $("list");
    list.replaceChildren(...items.slice(0, state.shown).map(row));
    $("more").hidden = items.length <= state.shown;
  }

  // Map view. Leaflet and its cluster plugin load only when someone opens the map.
  // Tiles come from openstreetmap.org: no API key and no billing, but its usage policy allows only light use.
  // CARTO now needs an API key (checked 2026-10-10). If traffic grows, move to OpenFreeMap or a paid host.
  const LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/";
  const CLUSTER = "https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/";
  const PIN = { park: "#2e7d46", playground: "#e0a019", lake: "#2f6e9e", library: "#7a4e9c", toilet: "#2f8a8a" };
  let map = null, pins = null, meDot = null, leafletLoad = null, fitKey = "", fitHere = false;

  const addCss = (href) => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    document.head.append(l);
  };
  const addJs = (src) => new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = ok;
    s.onerror = fail;
    document.head.append(s);
  });
  function loadLeaflet() {
    if (!leafletLoad) {
      addCss(LEAFLET + "leaflet.min.css");
      addCss(CLUSTER + "MarkerCluster.min.css");
      leafletLoad = addJs(LEAFLET + "leaflet.min.js").then(() => addJs(CLUSTER + "leaflet.markercluster.min.js"));
      leafletLoad.catch(() => { leafletLoad = null; }); // allow a retry
    }
    return leafletLoad;
  }

  function makeMap() {
    map = L.map("mapbox", { renderer: L.canvas({ tolerance: 8 }) }).setView([12.9716, 77.5946], 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const Locate = L.Control.extend({
      options: { position: "bottomright" },
      onAdd() {
        const b = L.DomUtil.create("button", "locate");
        b.type = "button";
        b.innerHTML = svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/>') + "<span>My location</span>";
        L.DomEvent.disableClickPropagation(b);
        b.addEventListener("click", locateMe);
        return b;
      },
    });
    map.addControl(new Locate());
    pins = L.markerClusterGroup({
      showCoverageOnHover: false, maxClusterRadius: 45, disableClusteringAtZoom: 16,
      animate: false, // with animation on, a pin could stay hidden after a one-level zoom (seen 2026-10-10)
      iconCreateFunction: groupIcon,
    });
    map.addLayer(pins);
  }

  // A group shows its count, with a ring split by the share of each category inside it.
  function groupIcon(c) {
    const n = {};
    for (const m of c.getAllChildMarkers()) n[m.options.cat] = (n[m.options.cat] || 0) + 1;
    const total = c.getChildCount();
    let at = 0;
    const stops = Object.keys(PIN).filter((k) => n[k]).map((k) => {
      const from = at;
      at += (n[k] / total) * 360;
      return `${PIN[k]} ${from}deg ${at}deg`;
    });
    const size = total < 10 ? 36 : total < 100 ? 42 : 48;
    return L.divIcon({
      html: `<span style="background:conic-gradient(${stops.join(",")})"><b>${total}</b></span>`,
      className: "cluster", iconSize: [size, size],
    });
  }

  function drawMap(items) {
    if (!map) return;
    pins.clearLayers();
    pins.addLayers(items.map((p) => {
      const m = L.circleMarker([p.lat, p.lng], {
        radius: 8, weight: 2, color: "#ffffff", fillColor: PIN[p.cat], fillOpacity: 1, cat: p.cat,
      });
      m.bindTooltip(p.name, { direction: "top", offset: [0, -8] });
      m.on("click", () => open(p));
      return m;
    }));
    // The "you are here" dot is its own element. Drawing it on the pins' canvas erased the pins.
    if (state.here && !meDot) {
      meDot = L.marker([state.here.lat, state.here.lng], {
        icon: L.divIcon({ className: "me-dot", iconSize: [22, 22] }), interactive: false, keyboard: false, zIndexOffset: 1000,
      }).addTo(map);
      meDot.bindTooltip("You are here", { permanent: true, direction: "right", offset: [14, 0], className: "me-tip" });
    } else if (meDot && state.here) meDot.setLatLng([state.here.lat, state.here.lng]);
    // Move the map only when the filters or the location change, not on every redraw.
    // A new search or filter shows its results. Location turning on (or the map opening) centers on you.
    const key = [state.cat, state.q.trim(), state.openOnly, state.freeOnly, state.accessOnly].join("|");
    const filtersChanged = fitKey !== "" && key !== fitKey;
    if (key === fitKey && !!state.here === fitHere) return;
    fitKey = key;
    fitHere = !!state.here;
    const lb = document.querySelector(".locate");
    if (lb) { lb.classList.toggle("on", !!state.here); lb.classList.remove("busy"); }
    // No animation here: a fit still animating when the location arrives would undo the move to you.
    if (state.here && !filtersChanged) map.setView([state.here.lat, state.here.lng], ME_ZOOM, { animate: false });
    else if (items.length) map.fitBounds(L.latLngBounds(items.map((p) => [p.lat, p.lng])), { padding: [24, 24], maxZoom: 16, animate: false });
  }

  const ME_ZOOM = 16; // street level, where the groups split into single pins
  function locateMe() {
    const b = document.querySelector(".locate");
    const msg = $("map-msg");
    msg.hidden = true;
    if (state.here) { map.setView([state.here.lat, state.here.lng], ME_ZOOM); return; }
    b.classList.add("busy");
    nearMe(() => {
      b.classList.remove("busy");
      msg.textContent = "Could not get your location. Allow location for this site in your browser settings.";
      msg.hidden = false;
    });
  }

  async function setView(v, scroll) {
    state.view = v;
    try { localStorage.setItem("publik:view", v); } catch {}
    document.querySelectorAll("#viewsw button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.view === v));
    const onMap = v === "map";
    $("mapview").hidden = !onMap;
    $("list").hidden = onMap;
    if (!onMap) { render(); return; }
    const msg = $("map-msg");
    msg.hidden = true;
    try {
      await loadLeaflet();
    } catch {
      msg.textContent = "Could not load the map. Check your connection and tap Map again.";
      msg.hidden = false;
      return;
    }
    if (state.view !== "map") return;
    if (!map) makeMap();
    map.invalidateSize();
    fitKey = "";
    render();
    // If this visitor already allowed location, show their dot without asking again.
    if (!state.here && navigator.permissions) {
      navigator.permissions.query({ name: "geolocation" })
        .then((r) => { if (r.state === "granted" && !state.here) nearMe(); })
        .catch(() => {});
    }
    if (scroll) {
      // Bring the map up under the pinned search bar.
      const top = $("mapview").getBoundingClientRect().top + window.scrollY - document.querySelector(".top").offsetHeight - 12;
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }
  }

  function row(p) {
    const li = document.createElement("li");
    li.className = `item c-${p.cat}`;
    li.tabIndex = 0;
    li.dataset.id = p.id;
    const s = status(p);
    li.innerHTML = `<span class="ic" aria-hidden="true">${ICON[p.cat]}</span>
      <span class="body"><span class="name"></span><span class="meta"><span class="area"></span><span class="stars"></span></span>
      <span class="badges"><span class="pill ${s.cls}"></span></span></span><span class="dist"></span>`;
    for (const f of (p.feat || []).filter((f) => ROW_TAGS.includes(f))) {
      const t = document.createElement("span");
      t.className = "tag";
      t.textContent = f;
      li.querySelector(".badges").append(t);
    }
    li.querySelector(".name").textContent = p.name;
    li.querySelector(".dist").textContent = p._d != null && state.here ? fmtDist(p._d) : "";
    li.querySelector(".area").textContent = p.area || CAT_LABEL[p.cat];
    li.querySelector(".stars").textContent = p.reviews ? ratingText(p) : "";
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
    const wasOpen = openId !== null;
    if (!wasOpen) opener = document.activeElement;
    openId = p.id;
    const fig = $("d-photo");
    fig.hidden = !p.photo;
    if (p.photo) {
      const img = fig.querySelector("img");
      img.src = p.photo.src;
      img.alt = p.name;
      const cap = fig.querySelector("figcaption");
      cap.replaceChildren(`Photo: ${p.photo.author}, `);
      const a = document.createElement("a");
      a.href = p.photo.page; a.target = "_blank"; a.rel = "noopener";
      a.textContent = `${p.photo.license || "license"} via Wikimedia Commons`;
      cap.append(a);
    }
    $("d-cat").className = `d-cat c-${p.cat}`;
    $("d-cat").innerHTML = `<span class="ic">${ICON[p.cat]}</span><span></span><span lang="kn"></span>`;
    $("d-cat").children[1].textContent = CAT_LABEL[p.cat];
    $("d-cat").children[2].textContent = KN[p.cat];
    $("d-name").textContent = p.name;
    $("d-area").textContent = [p.area, p._d != null && state.here ? fmtDist(p._d) + " away" : ""].filter(Boolean).join(", ");
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
    loadReports(p);
    loadVisits(p);
    $("d-feat").replaceChildren(...(p.feat || []).map((f) => { const s = document.createElement("span"); s.textContent = f; return s; }));

    const ll = `${p.lat},${p.lng}`;
    $("d-map").src = `https://maps.google.com/maps?q=${ll}&z=16&output=embed`;
    $("d-dir").href = `https://www.google.com/maps/dir/?api=1&destination=${ll}`;
    $("d-dir-quick").href = $("d-dir").href;
    $("d-photos").href = p.gmap || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}%20${ll}`;
    $("d-gmap").href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}%20${ll}`;
    const title = encodeURIComponent(`Wrong info: ${p.name} (${p.id})`);
    const body = encodeURIComponent(`Place: ${p.name}\nID: ${p.id}\nLocation: ${ll}\n\nWhat is wrong (timings, closed, not public, wrong place)?\n`);
    $("d-report").href = `${REPO}/issues/new?title=${title}&body=${body}`;

    $("sheet").hidden = false;
    const onMap = state.view === "map" && !!map;
    $("sheet").classList.toggle("on-map", onMap);
    document.body.style.overflow = onMap ? "" : "hidden";
    $("sheet").querySelector(".sheet-card").scrollTop = 0;
    // On the map the card opens half way, so the pin stays in view. In the list it opens fully.
    setSheet(onMap ? (wasOpen && sheetMode !== "full" ? sheetMode : "half") : "full");
    if (onMap) keepPinVisible(p);
    if (!fromHistory && location.hash !== `#${p.id}`) {
      // Moving from pin to pin replaces the entry, so one Back still closes the card.
      if (wasOpen && pushed) history.replaceState({ place: p.id }, "", `#${p.id}`);
      else { history.pushState({ place: p.id }, "", `#${p.id}`); pushed = true; }
    }
    if (!wasOpen) $("sheet").querySelector(".close").focus({ preventScroll: true });
  }

  // The card has three heights, like Google Maps: peek (name and Directions), half and full.
  let sheetMode = "full";
  const sheetHeights = () => {
    const vh = window.innerHeight;
    return { peek: Math.min($("sheet-head").offsetHeight + 24, vh * 0.4), half: vh * 0.5, full: vh * 0.92 };
  };
  function setSheet(mode) {
    sheetMode = mode;
    const card = $("sheet").querySelector(".sheet-card");
    card.style.height = mode === "full" && !$("sheet").classList.contains("on-map") ? "" : sheetHeights()[mode] + "px";
    $("sheet").dataset.mode = mode;
    $("grab").setAttribute("aria-label", mode === "full" ? "Show less of this card" : "Show more of this card");
  }
  function keepPinVisible(p) {
    // Pan so the pin sits in the middle of the map area that the card leaves free.
    const box = $("mapbox").getBoundingClientRect();
    const free = window.innerHeight - sheetHeights()[sheetMode];
    const pt = map.latLngToContainerPoint([p.lat, p.lng]);
    const want = (Math.max(box.top, 0) + free) / 2;
    map.panBy([pt.x - box.width / 2, box.top + pt.y - want], { animate: true });
  }

  // Drag the top of the card up or down. A short tap on the handle steps to the next height.
  function setupSheetDrag() {
    const head = $("sheet-head");
    const card = $("sheet").querySelector(".sheet-card");
    let startY = 0, startH = 0, dragging = false, moved = false, onGrab = false;
    head.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("a, .close")) return;
      if (window.matchMedia("(min-width: 760px)").matches && !$("sheet").classList.contains("on-map")) return;
      dragging = true; moved = false;
      onGrab = !!e.target.closest("#grab"); // pointer capture makes later events report the head, not the handle
      startY = e.clientY; startH = card.getBoundingClientRect().height;
      card.classList.add("dragging");
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 6) moved = true;
      const h = sheetHeights();
      card.style.height = Math.max(h.peek * 0.8, Math.min(h.full, startH - dy)) + "px";
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      card.classList.remove("dragging");
      if (!moved) {
        if (onGrab) setSheet(sheetMode === "full" ? "half" : "full");
        else if (sheetMode === "peek") setSheet("half");
        else setSheet(sheetMode);
        return;
      }
      const now = card.getBoundingClientRect().height;
      const h = sheetHeights();
      // In the list there is no map behind the card, so a drag down closes it instead of peeking.
      if (!$("sheet").classList.contains("on-map")) {
        if (now < h.full * 0.75) close(); else setSheet("full");
        return;
      }
      const pick = Object.entries(h).sort((a, b) => Math.abs(a[1] - now) - Math.abs(b[1] - now))[0][0];
      setSheet(pick);
      if (pick === "full") card.scrollTop = 0;
    };
    head.addEventListener("pointerup", end);
    head.addEventListener("pointercancel", end);
  }

  // fromHistory: the URL already changed (Back, or a #id link), so leave history alone.
  function close(fromHistory) {
    if (openId === null) return;
    const id = openId;
    openId = null;
    $("sheet").hidden = true;
    $("sheet").classList.remove("on-map");
    $("sheet").querySelector(".sheet-card").style.height = "";
    sheetMode = "full";
    $("d-map").src = "about:blank";
    document.body.style.overflow = "";
    if (!fromHistory) {
      if (pushed) {
        history.back(); // the popstate that follows finds no open card and does nothing
        // After an earlier Back, Chrome sometimes ignores this back(). Clear the #id by hand then.
        setTimeout(() => {
          if (openId === null && location.hash === `#${id}`) history.replaceState(null, "", location.pathname + location.search);
        }, 400);
      }
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

  // Reports: anonymous one-tap notes from visitors. The API decides how long each kind shows.
  const ago = (ts) => {
    const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
    return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
  };
  const tapKey = (id, k) => `publik:tap:${id}:${k}`;
  const lastTap = (id, k) => { try { return +localStorage.getItem(tapKey(id, k)) || 0; } catch { return 0; } };

  function showReports(rows) {
    const box = $("d-live-list");
    if (!rows.length) { box.textContent = "No recent reports. Be the first to tell others."; return; }
    box.replaceChildren(...rows.map((r) => {
      const d = document.createElement("span");
      d.className = "rep";
      d.textContent = `${KIND_LABEL[r.kind]}, ${ago(r.last)}${r.n > 1 ? ` (${r.n})` : ""}`;
      return d;
    }));
  }

  function drawTaps(p) {
    $("d-taps").replaceChildren(...KINDS.map(([k, label]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tap";
      b.textContent = label;
      b.disabled = Date.now() - lastTap(p.id, k) < TAP_GAP;
      b.addEventListener("click", () => sendReport(p, k));
      return b;
    }));
  }

  let reportsFor = null;
  async function loadReports(p) {
    reportsFor = p.id;
    $("d-live").hidden = false;
    $("d-tap-msg").textContent = "";
    $("d-live-list").textContent = "Loading...";
    drawTaps(p);
    try {
      const res = await fetch(`/api/reports?place=${encodeURIComponent(p.id)}`);
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      if (reportsFor === p.id) { p._reports = data.reports; showReports(data.reports); }
    } catch {
      if (reportsFor === p.id) $("d-live").hidden = true; // no API, for example a local preview
    }
  }

  async function sendReport(p, kind) {
    const msg = $("d-tap-msg");
    $("d-taps").querySelectorAll("button").forEach((b) => (b.disabled = true));
    msg.textContent = "Sending...";
    try {
      const res = await fetch("/api/report", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ place: p.id, kind }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send. Try again later.");
      try { localStorage.setItem(tapKey(p.id, kind), String(Date.now())); } catch {}
      if (reportsFor !== p.id) return;
      const rows = (p._reports || []).filter((r) => r.kind !== kind);
      const old = (p._reports || []).find((r) => r.kind === kind);
      p._reports = [{ kind, n: (old ? old.n : 0) + 1, last: Date.now() }, ...rows];
      showReports(p._reports);
      loadActivity();
      msg.textContent = "Thanks. Others can see it now.";
    } catch (e) {
      if (reportsFor === p.id) msg.textContent = e.message;
    }
    if (reportsFor === p.id) drawTaps(p);
  }

  // "I went here": tap answers from past visitors, for people who have never been.
  const visitKey = (id) => `publik:visit:${id}`;
  const visitedToday = (id) => {
    try { return Date.now() - (+localStorage.getItem(visitKey(id)) || 0) < 24 * 3600 * 1000; } catch { return false; }
  };

  function showVisits(v) {
    const box = $("d-visit-sum");
    if (!v.n) {
      box.textContent = "Nobody has told us yet. If you went, tap I went here and help the next person.";
      return;
    }
    const head = document.createElement("p");
    head.className = "muted";
    head.textContent = `${v.n} ${v.n === 1 ? "visitor" : "visitors"} told us. Last one ${ago(v.last)}.`;
    const rows = [head];
    for (const [q, , short, opts] of VISIT_Q) {
      const t = v.tally[q] || {};
      const total = Object.values(t).reduce((a, b) => a + b, 0);
      if (!total) continue;
      const [best, n] = Object.entries(t).sort((a, b) => b[1] - a[1])[0];
      const label = (opts.find((o) => o[0] === best) || [])[2] || best;
      const d = document.createElement("p");
      d.className = "visit-row";
      d.innerHTML = "<span></span><b></b>";
      d.children[0].textContent = short;
      d.children[1].textContent = total > 1 ? `${label} (${n} of ${total})` : label;
      rows.push(d);
    }
    box.replaceChildren(...rows);
  }

  function drawVisitForm() {
    $("d-visit-qs").replaceChildren(...VISIT_Q.map(([q, text, , opts]) => {
      const fs = document.createElement("fieldset");
      fs.innerHTML = "<legend></legend><div class='taps'></div>";
      fs.firstChild.textContent = text;
      fs.lastChild.append(...opts.map(([a, label]) => {
        const l = document.createElement("label");
        l.className = "tap pick";
        l.innerHTML = `<input type="radio" name="${q}" value="${a}"><span></span>`;
        l.lastChild.textContent = label;
        return l;
      }));
      return fs;
    }));
  }

  function setWent(id) {
    const b = $("d-went");
    b.hidden = false;
    b.disabled = visitedToday(id);
    b.textContent = b.disabled ? "Thanks for telling us" : "I went here";
  }

  let visitsFor = null;
  async function loadVisits(p) {
    visitsFor = p.id;
    const sec = $("d-visit");
    sec.hidden = p.cat === "toilet";
    if (sec.hidden) return;
    $("d-visit-form").hidden = true;
    $("d-visit-msg").textContent = "";
    setWent(p.id);
    $("d-visit-sum").textContent = "Loading...";
    try {
      const res = await fetch(`/api/visits?place=${encodeURIComponent(p.id)}`);
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      if (visitsFor === p.id) showVisits(data);
    } catch {
      if (visitsFor === p.id) sec.hidden = true; // no API, for example a local preview
    }
  }

  $("d-went").addEventListener("click", () => {
    drawVisitForm();
    $("d-went").hidden = true;
    $("d-visit-msg").textContent = "";
    $("d-visit-form").hidden = false;
    $("d-visit-form").querySelector("input").focus();
  });
  $("d-visit-cancel").addEventListener("click", () => {
    $("d-visit-form").hidden = true;
    setWent(visitsFor);
    $("d-went").focus();
  });
  $("d-visit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = visitsFor;
    const form = $("d-visit-form");
    const msg = $("d-visit-msg");
    const body = { place: id };
    for (const [q] of VISIT_Q) body[q] = (form.querySelector(`input[name="${q}"]:checked`) || {}).value || null;
    if (!body.entry && !body.feel && !body.first) { msg.textContent = "Pick at least one answer."; return; }
    const send = form.querySelector("button[type=submit]");
    send.disabled = true;
    msg.textContent = "Sending...";
    try {
      const res = await fetch("/api/visit", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send. Try again later.");
      try { localStorage.setItem(visitKey(id), String(Date.now())); } catch {}
      if (visitsFor === id) {
        const p = state.places.find((x) => x.id === id);
        if (p) await loadVisits(p);
        if (visitsFor === id) msg.textContent = "Saved. The next first-timer will see it.";
        loadActivity();
      }
    } catch (err) {
      if (visitsFor === id) msg.textContent = err.message;
    }
    send.disabled = false;
  });

  // Home page feed: the newest taps and visits across the city. Hidden when there are none.
  // One sentence per card, for example "Someone marked <place> as clean". Returns [before, after] the place name.
  const REPORT_SAY = {
    clean: ["marked", "as clean"], dirty: ["marked", "as dirty"], crowded: ["said", "is crowded"],
    quiet: ["said", "is quiet"], open: ["found", "open"], closed: ["found", "closed"],
  };
  const VISIT_SAY = {
    feel: { quiet: "and found it quiet", lively: "and found it lively", crowded: "and marked it crowded" },
    entry: { walkin: "and walked right in", id: "and needed an ID to enter", member: "and found it members only" },
    first: { yes: "and says it is easy for first-timers", okay: "and says it is okay for first-timers", no: "and says it is not easy for first-timers" },
  };
  function activityText(it) {
    const who = it.n > 1 ? `${it.n} people` : "Someone";
    if (it.type === "report") return [`${who} ${REPORT_SAY[it.kind][0]}`, REPORT_SAY[it.kind][1]];
    for (const q of ["feel", "entry", "first"]) if (it[q] && VISIT_SAY[q][it[q]]) return ["Someone checked into", VISIT_SAY[q][it[q]]];
    return ["Someone checked into", ""];
  }

  async function loadActivity() {
    let items = [];
    try {
      const res = await fetch("/api/activity");
      if (!res.ok) throw new Error(res.status);
      items = (await res.json()).items || [];
    } catch {
      return; // no API, for example a local preview
    }
    const byId = new Map(state.places.map((p) => [p.id, p]));
    const cards = items.filter((it) => byId.has(it.place)).map((it) => {
      const p = byId.get(it.place);
      const b = document.createElement("button");
      b.type = "button";
      b.className = `live-card c-${p.cat}`;
      b.innerHTML = `<span class="ic" aria-hidden="true">${ICON[p.cat]}</span><span class="lc-body">
        <span class="lc-what"><span></span> <b></b> <span></span></span><span class="lc-when"></span></span>`;
      const [before, after] = activityText(it);
      const what = b.querySelector(".lc-what").children;
      what[0].textContent = before;
      what[1].textContent = p.name;
      what[2].textContent = after;
      b.querySelector(".lc-when").textContent = [ago(it.last), p.area].filter(Boolean).join(", ");
      b.addEventListener("click", () => open(p));
      return b;
    });
    $("live-row").replaceChildren(...cards);
    $("live").hidden = cards.length === 0;
  }

  // Surprise me: a random good place that is open now, near you if location is on.
  function surprise() {
    tick();
    const btn = $("surprise");
    const fits = (p) => status(p).cls === "open" &&
      (state.cat === "all" ? p.cat !== "toilet" : p.cat === state.cat);
    let pool = state.places.filter(fits);
    const good = pool.filter((p) => (p.rating || 0) >= 4 && (p.reviews || 0) >= 20);
    if (good.length) pool = good;
    if (state.here) {
      for (const km of [3, 6, 12]) {
        const near = pool.filter((p) => distKm(p) <= km);
        if (near.length) { pool = near; break; }
      }
      pool.forEach((p) => (p._d = distKm(p)));
    }
    if (!pool.length) { btn.textContent = "Nothing open right now"; setTimeout(() => (btn.textContent = "Surprise me"), 2500); return; }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    opener = btn;
    // One short shuffle through a few names, so the pick feels like a roll. Skipped for reduced motion.
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || pool.length < 4) { open(pick); return; }
    btn.disabled = true;
    btn.classList.add("rolling");
    let i = 0;
    const t = setInterval(() => {
      btn.textContent = pool[Math.floor(Math.random() * pool.length)].name;
      if (++i < 6) return;
      clearInterval(t);
      btn.textContent = "Surprise me";
      btn.classList.remove("rolling");
      btn.disabled = false;
      open(pick);
    }, 110);
  }

  function setupChips() {
    $("chips").replaceChildren(...CATS.map(([k, label]) => {
      const b = document.createElement("button");
      b.className = "chip";
      b.type = "button";
      b.classList.add(`c-${k}`);
      b.innerHTML = `<span class="ic">${ICON[k]}</span><span>${label}</span><span lang="kn">${KN[k]}</span>`;
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

  function nearMe(onFail) {
    const btn = $("near");
    if (!navigator.geolocation) { btn.textContent = "Location not available"; resetSort(); if (onFail) onFail(); return; }
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
      () => { btn.textContent = "Location blocked. Try again"; resetSort(); if (onFail) onFail(); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }

  async function init() {
    setupChips();
    $("q").addEventListener("input", (e) => { state.q = e.target.value; state.shown = PAGE; render(); });
    $("openNow").addEventListener("change", (e) => { state.openOnly = e.target.checked; state.shown = PAGE; render(); });
    $("freeOnly").addEventListener("change", (e) => { state.freeOnly = e.target.checked; state.shown = PAGE; render(); });
    $("accessOnly").addEventListener("change", (e) => { state.accessOnly = e.target.checked; state.shown = PAGE; render(); });
    $("near").addEventListener("click", () => nearMe());
    $("surprise").addEventListener("click", () => surprise());
    $("sort").addEventListener("change", (e) => {
      state.sort = e.target.value; state.shown = PAGE;
      if (state.sort === "near" && !state.here) nearMe(); else render();
    });
    $("more").addEventListener("click", () => { state.shown += PAGE; render(); });
    $("viewsw").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (b && b.dataset.view !== state.view) setView(b.dataset.view, true);
    });
    $("sheet").addEventListener("click", (e) => { if (e.target.hasAttribute("data-close")) close(); });
    setupSheetDrag();
    window.addEventListener("resize", () => { if (openId !== null) setSheet(sheetMode); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sheet").hidden) close(); });
    // Both fire for a #id link; syncHash does nothing the second time.
    window.addEventListener("popstate", syncHash);
    window.addEventListener("hashchange", syncHash);

    const res = await fetch("data/places.json");
    const data = await res.json();
    state.places = data.places;
    $("built").textContent = `Data updated ${data.built}.`;
    let saved = "list";
    try { saved = localStorage.getItem("publik:view") || "list"; } catch {}
    if (saved === "map") setView("map"); else render();
    syncHash();
    loadActivity();
  }

  init().catch((e) => { $("count").textContent = "Could not load places. Refresh the page."; console.error(e); });
})();
