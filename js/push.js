// Push alerts for My places (Phase 7). The phone subscribes with the browser's push service; our
// Worker stores the subscription with the saved places (rounded to ~100 m) and checks NWS every
// minute. Shown inside the My places sheet.
import { APP } from "./config.js";
import { loadCounties } from "./data/counties.js";
import { contains } from "./near.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const API = /workers\.dev$|^stormline/.test(location.hostname) ? "/api/push" : `${APP.apiBase}/api/push`;
const KEY = "stormline.push.v1"; // { on, kinds }
export const PUSH_KINDS = [
  ["tornado", "Tornado and extreme wind warnings", true],
  ["flood", "Flash flood and flood warnings", true],
  ["severe", "Severe thunderstorm warnings", false],
  ["winter", "Winter storm, ice and extreme cold warnings", false],
];

const b64ToBytes = (s) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

export function initPush({ metro, getPlaces, toast }) {
  let st = { on: false, kinds: PUSH_KINDS.filter((k) => k[2]).map((k) => k[0]) };
  try { st = { ...st, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch (_) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (_) {} };
  let busy = false, note = "";

  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  async function placesWithCounty() {
    let counties = [];
    try { counties = await loadCounties(metro); } catch (_) {}
    return getPlaces().map((p) => ({ name: p.name, at: p.at, county: counties.find((c) => contains(c.geometry, p.at))?.name || null }));
  }
  async function subscription(create) {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub && create) {
      const { key } = await (await fetch(`${API}/key`)).json();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
    }
    return sub;
  }
  async function post(path, body) {
    const r = await fetch(`${API}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Server error (${r.status})`);
    return j;
  }

  async function turnOn() {
    busy = true; note = ""; render();
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Notifications are blocked. Allow them for this site in your browser or phone settings.");
      const sub = await subscription(true);
      await post("/subscribe", { subscription: sub.toJSON(), places: await placesWithCounty(), kinds: st.kinds });
      st.on = true; save();
      toast("Alerts are on for your places.");
    } catch (e) { note = e.message || "Couldn't turn on alerts."; }
    busy = false; render();
  }
  async function turnOff() {
    busy = true; render();
    try {
      const sub = await subscription(false);
      if (sub) { await post("/unsubscribe", { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
    } catch (_) {}
    st.on = false; save(); busy = false; render();
    toast("Alerts are off on this device.");
  }
  // Keep the server's copy of places and kinds in step with this device.
  async function sync() {
    if (!st.on || !supported) return;
    try {
      const sub = await subscription(false);
      if (!sub) { st.on = false; save(); return render(); }
      await post("/subscribe", { subscription: sub.toJSON(), places: await placesWithCounty(), kinds: st.kinds });
    } catch (_) { /* tried again on the next change */ }
  }
  async function test() {
    busy = true; note = ""; render();
    try { const sub = await subscription(false); await post("/test", { endpoint: sub.endpoint }); note = "Test sent. It should arrive in a few seconds."; }
    catch (e) { note = e.message; }
    busy = false; render();
  }

  let root = null;
  function render() {
    root = document.getElementById("push-card");
    if (!root) return;
    const n = getPlaces().length;
    if (!supported) {
      root.innerHTML = `<h3 class="near-h">Alerts on this device</h3>
        <p class="near-note">${isIOS && !standalone ? "On iPhone, alerts need the app on your Home Screen: tap Share, then Add to Home Screen, then open Stormline from there." : "This browser can't get push alerts. Try Chrome, Edge, Firefox or Safari."}</p>`;
      return;
    }
    const denied = Notification.permission === "denied";
    root.innerHTML = `
      <h3 class="near-h">Alerts on this device <span class="near-h-note">${st.on ? "on" : "off"}</span></h3>
      <p class="near-note">${st.on ? `We'll notify this device when an NWS warning you picked covers ${n ? `one of your ${n} place${n > 1 ? "s" : ""}` : "a saved place (save one above)"}.` : "Get a notification when an NWS warning covers one of your places, even with the map closed."}</p>
      <div class="push-kinds">${PUSH_KINDS.map(([id, label]) => `<label class="push-kind"><input type="checkbox" data-push-kind="${id}" ${st.kinds.includes(id) ? "checked" : ""}> ${esc(label)}</label>`).join("")}</div>
      <div class="near-actions">
        ${st.on
          ? `<button type="button" class="near-btn" data-push-test ${busy ? "disabled" : ""}>Send a test</button><button type="button" class="near-btn" data-push-off ${busy ? "disabled" : ""}>Turn off</button>`
          : `<button type="button" class="near-btn rp-open" data-push-on ${busy || denied ? "disabled" : ""}>${busy ? "Turning on…" : "Turn on alerts"}</button>`}
      </div>
      ${denied ? `<p class="near-note">Notifications are blocked for this site. Allow them in your browser or phone settings, then come back.</p>` : ""}
      ${note ? `<p class="near-note">${esc(note)}</p>` : ""}
      <p class="sheet-small">Your saved places are stored on our server, rounded to about a block, only to match warnings. Turning alerts off deletes them. Alerts can be late or fail: keep Wireless Emergency Alerts on.${isIOS ? " On iPhone, add Stormline to your Home Screen first." : ""}</p>`;
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-push-on]")) return turnOn();
    if (e.target.closest("[data-push-off]")) return turnOff();
    if (e.target.closest("[data-push-test]")) return test();
  });
  document.addEventListener("change", (e) => {
    const k = e.target.closest("[data-push-kind]");
    if (!k) return;
    const id = k.dataset.pushKind;
    st.kinds = k.checked ? [...new Set([...st.kinds, id])] : st.kinds.filter((x) => x !== id);
    save(); sync();
  });

  return { render, sync, state: () => st };
}
