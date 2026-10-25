// Road names for neighbor reports, read from the basemap's own vector tiles (CARTO, OpenStreetMap data).
// Reports keep only a block-sized hexagon, so we look up the nearest named street to its center.
// One z14 tile per lookup, cached per hexagon on this device. No extra service, no keys.

const Z = 14;
const KINDS = new Set(["highway", "major_road", "medium_road", "minor_road"]);
const MAX_M = 90; // a hexagon center sits within ~66 m of any road through it
const CACHE_KEY = "stormline.roadnames.v1";

let cache = {};
try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch (_) {}
const saveCache = () => {
  const keys = Object.keys(cache);
  if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete cache[k];
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (_) {}
};

/* ---------- Minimal protobuf / Mapbox Vector Tile reader (only what we need) ---------- */
function reader(buf) {
  let pos = 0;
  const varint = () => {
    let v = 0, shift = 0, b;
    do { b = buf[pos++]; v += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80);
    return v;
  };
  return {
    get pos() { return pos; },
    set pos(p) { pos = p; },
    end: buf.length,
    varint,
    bytes() { const n = varint(); const s = buf.subarray(pos, pos + n); pos += n; return s; },
    skip(wire) {
      if (wire === 0) varint();
      else if (wire === 1) pos += 8;
      else if (wire === 2) pos += varint();
      else if (wire === 5) pos += 4;
      else throw new Error("bad wire type");
    },
  };
}
const utf8 = new TextDecoder();
const packed = (bytes) => { const r = reader(bytes), out = []; while (r.pos < r.end) out.push(r.varint()); return out; };
const zz = (n) => (n % 2 ? -(n + 1) / 2 : n / 2);

function readValue(bytes) {
  const r = reader(bytes);
  while (r.pos < r.end) {
    const tag = r.varint(), f = tag >> 3, w = tag & 7;
    if (f === 1) return utf8.decode(r.bytes());
    if (f === 4 || f === 5) return r.varint();
    if (f === 6) return zz(r.varint());
    if (f === 7) return !!r.varint();
    r.skip(w); // floats aren't needed here
  }
  return null;
}

// Returns [{ props, lines: [[[x,y],...], ...] }] for one layer, in tile units (0..extent).
function readLayer(buf, wanted) {
  const tile = reader(buf);
  while (tile.pos < tile.end) {
    const tag = tile.varint();
    if (tag >> 3 !== 3) { tile.skip(tag & 7); continue; }
    const lr = reader(tile.bytes());
    let name = null, extent = 4096;
    const keys = [], values = [], feats = [];
    while (lr.pos < lr.end) {
      const t = lr.varint(), f = t >> 3;
      if (f === 1) name = utf8.decode(lr.bytes());
      else if (f === 2) feats.push(lr.bytes());
      else if (f === 3) keys.push(utf8.decode(lr.bytes()));
      else if (f === 4) values.push(readValue(lr.bytes()));
      else if (f === 5) extent = lr.varint();
      else lr.skip(t & 7);
    }
    if (name !== wanted) continue;
    return { extent, features: feats.map((fb) => readFeature(fb, keys, values)).filter(Boolean) };
  }
  return { extent: 4096, features: [] };
}

function readFeature(bytes, keys, values) {
  const r = reader(bytes);
  let tags = [], geom = [], type = 0;
  while (r.pos < r.end) {
    const t = r.varint(), f = t >> 3;
    if (f === 2) tags = packed(r.bytes());
    else if (f === 3) type = r.varint();
    else if (f === 4) geom = packed(r.bytes());
    else r.skip(t & 7);
  }
  if (type !== 2) return null; // lines only
  const props = {};
  for (let i = 0; i < tags.length; i += 2) props[keys[tags[i]]] = values[tags[i + 1]];
  if (!props.name && !props.ref) return null;
  const lines = [];
  let x = 0, y = 0, line = null;
  for (let i = 0; i < geom.length; ) {
    const cmd = geom[i] & 7, count = geom[i] >> 3;
    i++;
    if (cmd === 7) continue;
    for (let k = 0; k < count; k++) {
      x += zz(geom[i++]); y += zz(geom[i++]);
      if (cmd === 1) { line = [[x, y]]; lines.push(line); } else line?.push([x, y]);
    }
  }
  return { props, lines };
}

/* ---------- Lookup ---------- */
const tilePromises = new Map();
function getTile(url) {
  if (!tilePromises.has(url)) {
    tilePromises.set(url, (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`tile ${res.status}`);
      let buf = new Uint8Array(await res.arrayBuffer());
      if (buf[0] === 0x1f && buf[1] === 0x8b && "DecompressionStream" in window) {
        const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
        buf = new Uint8Array(await new Response(s).arrayBuffer());
      }
      return readLayer(buf, "roads");
    })().catch((e) => { tilePromises.delete(url); throw e; }));
  }
  return tilePromises.get(url);
}

function segDist2([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  const cx = ax + t * dx - px, cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

const tidy = (s) => String(s).replace(/^(I|US|SH|FM|TX|Loop|Spur) (\d)/, (m, a, b) => `${a === "TX" ? "SH" : a}-${b}`);

// tileUrl: the basemap's {z}/{x}/{y} template. Resolves to a street name or null.
export async function roadNameAt(tileUrl, cell, [lng, lat]) {
  if (cell in cache) return cache[cell];
  const n = 2 ** Z;
  const fx = ((lng + 180) / 360) * n;
  const latR = (lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
  const tx = Math.floor(fx), ty = Math.floor(fy);
  const url = tileUrl.replace("{z}", Z).replace("{x}", tx).replace("{y}", ty);
  const { extent, features } = await getTile(url);
  const p = [(fx - tx) * extent, (fy - ty) * extent];
  const metersPerUnit = (40075016.7 * Math.cos(latR)) / n / extent;
  let best = null, bestD = Infinity;
  for (const f of features) {
    if (f.props.kind && !KINDS.has(f.props.kind)) continue;
    for (const line of f.lines) for (let i = 1; i < line.length; i++) {
      const d = segDist2(p, line[i - 1], line[i]);
      if (d < bestD) { bestD = d; best = f; }
    }
  }
  const meters = Math.sqrt(bestD) * metersPerUnit;
  const name = best && meters <= MAX_M ? tidy(best.props.name || best.props.ref) : null;
  cache[cell] = name;
  saveCache();
  return name;
}
