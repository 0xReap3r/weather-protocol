// Spanish (Phase 11). The app is written in English; in Spanish mode this module translates what
// lands on screen, so feature code stays simple and anything not yet translated falls back to
// English instead of breaking:
//   - text nodes and a few attributes (aria-label, title, placeholder, alt) are swapped through the
//     dictionary in i18n/es.js as they are added or changed (a MutationObserver)
//   - numbers inside a sentence are matched as {0}, {1}… so "3 lakes are above full" needs one entry
//   - sentences with names in them use the regex list in i18n/es.js
//   - map labels and NWS event names are translated where they're built, with t() and eventName()
// Official alert text from the National Weather Service stays in English (labeled as such).
// Elements marked translate="no" (place names, user input) are left alone.
import { ES, ES_PATTERNS, ES_EVENTS } from "./i18n/es.js";

const KEY = "stormline.lang.v1";
const read = () => { try { return localStorage.getItem(KEY); } catch (_) { return null; } };
export const LANG = read() || ((navigator.language || "").toLowerCase().startsWith("es") ? "es" : "en");
export const isEs = LANG === "es";
export const LOCALE = isEs ? "es-US" : "en-US";

export function setLang(lang) {
  try { localStorage.setItem(KEY, lang); } catch (_) {}
  location.reload();
}

const NUM = /\d+(?:[.,:]\d+)*/g;
// Translate one string; unknown strings come back unchanged (English).
export function t(s, vars) {
  let out = s;
  if (isEs && s) {
    const core = String(s).trim();
    if (core) {
      const hit = lookup(core);
      if (hit != null) out = String(s).replace(core, hit);
      else misses?.add(core);
    }
  }
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return out;
}
function lookup(core) {
  if (core in ES) return ES[core];
  // Same sentence with different numbers: "12 lakes…" -> "{0} lakes…"
  const nums = core.match(NUM);
  if (nums) {
    let i = 0;
    const key = core.replace(NUM, () => `{${i++}}`);
    if (key in ES) return ES[key].replace(/\{(\d+)\}/g, (m, k) => nums[+k] ?? m);
  }
  for (const [re, rep] of ES_PATTERNS) {
    const m = core.match(re);
    if (m) return typeof rep === "function" ? rep(m) : core.replace(re, rep);
  }
  return null;
}

// NWS event names in the NWS's own Spanish ("Aviso de Inundación Repentina").
export function eventName(ev) {
  if (!isEs || !ev) return ev;
  const demo = / \(demo\)$/.test(ev) ? " (demostración)" : "";
  const base = ev.replace(/ \(demo\)$/, "");
  return (ES_EVENTS[base] || lookup(base) || base) + demo;
}

// Missing strings, for filling the dictionary: stormlineI18n.misses() in the console (Spanish mode).
const misses = isEs ? new Set() : null;

// Dates and numbers: calls that pass no locale ([] or undefined) follow the app's language.
if (isEs) {
  const wrap = (proto, name) => {
    const orig = proto[name];
    proto[name] = function (loc, opts) { return orig.call(this, loc == null || (Array.isArray(loc) && !loc.length) ? LOCALE : loc, opts); };
  };
  wrap(Date.prototype, "toLocaleString");
  wrap(Date.prototype, "toLocaleDateString");
  wrap(Date.prototype, "toLocaleTimeString");
  wrap(Number.prototype, "toLocaleString");
}

/* ---------- Translating the page ---------- */
const ATTRS = ["aria-label", "title", "placeholder", "alt"];
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "svg", "SVG", "CODE"]);
const skipEl = (el) => !el || SKIP.has(el.nodeName) || el.closest?.('[translate="no"], .maplibregl-ctrl-attrib, .maplibregl-canvas-container');

function doText(node) {
  const v = node.nodeValue;
  if (!v || !/[A-Za-z]/.test(v)) return;
  const nv = t(v);
  if (nv !== v) node.nodeValue = nv;
}
function doEl(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute?.(a);
    if (v && /[A-Za-z]/.test(v)) { const nv = t(v); if (nv !== v) el.setAttribute(a, nv); }
  }
}
function walk(root) {
  if (root.nodeType === 3) { if (!skipEl(root.parentElement)) doText(root); return; }
  if (root.nodeType !== 1 || skipEl(root)) return;
  doEl(root);
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeType === 1 && skipEl(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = tw.nextNode(); n; n = tw.nextNode()) (n.nodeType === 3 ? doText(n) : doEl(n));
}

if (isEs) {
  document.documentElement.lang = "es";
  walk(document.body);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "characterData") { if (!skipEl(m.target.parentElement)) doText(m.target); }
      else if (m.type === "attributes") { if (!skipEl(m.target)) doEl(m.target); }
      else m.addedNodes.forEach(walk);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  const ttl = () => { const nt = t(document.title); if (nt !== document.title) document.title = nt; };
  ttl();
}

window.stormlineI18n = { lang: LANG, setLang, misses: () => [...(misses || [])].sort(), t };
