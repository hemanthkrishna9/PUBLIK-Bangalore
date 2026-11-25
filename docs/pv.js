// PUBLIK page counts: one beacon per page view, and one per tap on a link marked data-ev.
// Sends only the kind of page, the event and where the visit came from. No cookies, no ids, no page address.
(function () {
  if (navigator.webdriver) return;
  var p = location.pathname;
  var k = p === "/" || p === "/index.html" ? "home"
    : /^\/place\//.test(p) ? "place"
    : /^\/area\//.test(p) ? "area"
    : /^\/(parks|playgrounds|lakes|libraries|public-toilets)\//.test(p) ? "cat"
    : /^\/best\//.test(p) ? "list"
    : /^\/techies\//.test(p) ? "techies" : "other";
  var r = "";
  try { r = document.referrer ? new URL(document.referrer).hostname : ""; } catch (e) {}
  var f = !r ? "direct"
    : r === location.hostname ? "publik"
    : /(^|\.)google\./.test(r) ? "google"
    : /(^|\.)bing\.com$/.test(r) ? "bing"
    : /duckduckgo|yahoo|yandex|ecosia|brave/.test(r) ? "other_search"
    : /whatsapp/.test(r) ? "whatsapp"
    : /reddit/.test(r) ? "reddit"
    : /instagram/.test(r) ? "instagram"
    : /(^|\.)t\.me$|telegram/.test(r) ? "telegram"
    : /facebook|fb\.|twitter|(^|\.)x\.com$|t\.co$|linkedin|threads/.test(r) ? "social" : "other";
  function send(e) {
    var body = JSON.stringify({ k: k, e: e, f: f });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon("/api/pv", new Blob([body], { type: "text/plain" }))) return;
      fetch("/api/pv", { method: "POST", body: body, keepalive: true });
    } catch (x) {}
  }
  send("view");
  document.addEventListener("click", function (ev) {
    var a = ev.target.closest && ev.target.closest("[data-ev]");
    if (a) send(a.getAttribute("data-ev"));
  }, true);
})();
