// fetch() with a timeout and a clear error, shared by every data layer.
export async function fetchJSON(url, { timeout = 10000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/geo+json, application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
    return await res.json();
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`Timed out reaching ${new URL(url).host}`);
    throw err;
  } finally {
    clearTimeout(t);
  }
}
