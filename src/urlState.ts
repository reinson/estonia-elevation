/**
 * App state persisted in the URL hash, coexisting with MapLibre's built-in
 * `hash: "map"` position key.
 *
 * MapLibre owns the `map=z/lat/lng/bearing/pitch` key and rewrites the hash
 * (throttled, via `history.replaceState`) as the user pans/zooms. We only ever
 * touch our own keys here and preserve everything else, so the two writers
 * never clobber each other.
 */

export type AppUrlState = {
  palette: string | null;
  flatSea: boolean | null;
  locked: boolean | null;
};

const PALETTE_KEY = "palette";
const SEA_KEY = "sea";
const LOCK_KEY = "lock";

function parseHash(): Map<string, string> {
  const params = new Map<string, string>();
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw) return params;
  for (const part of raw.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) params.set(part, "");
    else params.set(part.slice(0, eq), part.slice(eq + 1));
  }
  return params;
}

function writeHash(params: Map<string, string>): void {
  const parts: string[] = [];
  for (const [k, v] of params) parts.push(v === "" ? k : `${k}=${v}`);
  const hash = parts.length ? `#${parts.join("&")}` : "";
  const { pathname, search } = window.location;
  history.replaceState(history.state, "", `${pathname}${search}${hash}`);
}

function setKey(key: string, value: string | null): void {
  const params = parseHash();
  if (value === null) {
    if (!params.has(key)) return;
    params.delete(key);
  } else {
    if (params.get(key) === value) return;
    params.set(key, value);
  }
  writeHash(params);
}

/** Reads our app keys from the URL hash. Missing keys come back as `null`. */
export function readUrlState(): AppUrlState {
  const params = parseHash();
  const sea = params.get(SEA_KEY);
  const lock = params.get(LOCK_KEY);
  return {
    palette: params.get(PALETTE_KEY) ?? null,
    flatSea: sea === undefined ? null : sea === "1",
    locked: lock === undefined ? null : lock === "1",
  };
}

/** Writes the palette id, or removes the key when it matches the default. */
export function writePalette(id: string, defaultId: string): void {
  setKey(PALETTE_KEY, id === defaultId ? null : id);
}

/** Writes the flat-sea flag, or removes the key when it matches the default. */
export function writeFlatSea(flatSea: boolean, defaultFlatSea: boolean): void {
  setKey(SEA_KEY, flatSea === defaultFlatSea ? null : flatSea ? "1" : "0");
}

/** Writes the lock flag, or removes the key when it matches the default. */
export function writeLocked(locked: boolean, defaultLocked: boolean): void {
  setKey(LOCK_KEY, locked === defaultLocked ? null : locked ? "1" : "0");
}
