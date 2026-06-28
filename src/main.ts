import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { buildStyle } from "./style.ts";
import { addElevationLayers, applyRamp } from "./elevation.ts";
import { PALETTES, getPalette, type Palette } from "./colorRamps.ts";
import { ViewportStats, type ElevationRange } from "./viewportStats.ts";
import { UI } from "./ui.ts";
import {
  readUrlState,
  writePalette,
  writeFlatSea,
  writeLocked,
} from "./urlState.ts";
import { maaametWcsProtocol, WCS_MAX_ZOOM } from "./wcsProtocol.ts";
import type { DemConfig } from "./config.ts";
import type { Bookmark } from "./ui.ts";

const ESTONIA_CENTER: [number, number] = [25.5, 58.6];
const INITIAL_RANGE: ElevationRange = [-2, 320];

/**
 * Bookmarks shown in the side panel. Each `url` just needs a
 * `#map=zoom/lat/lng` hash (copy it straight from the address bar); the
 * center and zoom are parsed out on click.
 */
const BOOKMARKS: Bookmark[] = [
  { name: "Eesti", url: "http://localhost:5173/#map=7.18/58.776/25.087&sea=0" },
  { name: "Tallinn", url: "http://localhost:5173/#map=13.64/59.43398/24.74786&sea=0" },
  { name: "Tartu", url: "http://localhost:5173/#map=14.1/58.38445/26.71889&sea=0" },
  { name: "Viljandi", url: "http://localhost:5173/#map=13.99/58.36027/25.60067&sea=0" },
  { name: "Kohtla-Järve", url: "http://localhost:5173/#map=13.68/59.39285/27.24287&sea=0" },
  { name: "Narva", url: "http://localhost:5173/#map=14.31/59.37728/28.19851&sea=0" },
  { name: "Otepää", url: "http://localhost:5173/#map=13.59/58.04705/26.50506&sea=0" },
  { name: "Suur Munamägi", url: "http://localhost:5173/#map=13.94/57.71494/27.05909&sea=0" },
  { name: "Kuressaare", url: "http://localhost:5173/#map=14.47/58.24657/22.48205&sea=0" },
  { name: "Kaali", url: "http://localhost:5173/#map=15.09/58.37078/22.6705&sea=0" },
  { name: "Hinni kanjon", url: "http://localhost:5173/#map=14.58/57.7642/26.87724&sea=0" },
  { name: "Taevaskoja", url: "http://localhost:5173/#map=14.22/58.10929/27.05283&sea=0" },
];

/**
 * Average zoom level across the city-scale bookmarks, used as the default
 * zoom when navigating to typed coordinates. The country-wide "Eesti"
 * bookmark is excluded as an outlier so the average reflects a useful
 * close-up level (~14).
 */
const AVG_BOOKMARK_ZOOM = (() => {
  const zooms = BOOKMARKS.map((b) => parseBookmark(b.url)?.zoom).filter(
    (z): z is number => typeof z === "number" && z >= 10,
  );
  if (!zooms.length) return 14;
  return zooms.reduce((a, b) => a + b, 0) / zooms.length;
})();

/** Parse a `#map=zoom/lat/lng` hash from a bookmark URL. */
function parseBookmark(
  url: string,
): { center: [number, number]; zoom: number } | null {
  const m = url.match(/[#&]map=([\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)/);
  if (!m) return null;
  const zoom = parseFloat(m[1]!);
  const lat = parseFloat(m[2]!);
  const lng = parseFloat(m[3]!);
  if (Number.isNaN(zoom) || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { center: [lng, lat], zoom };
}

/** Live Maa-amet WCS 1 m DTM — fetches tiles on demand from the browser. */
const WCS_DEM: DemConfig = {
  tileUrl: "maamet-wcs://{z}/{x}/{y}",
  encoding: "mapbox",
  maxZoom: WCS_MAX_ZOOM,
  attribution:
    '<a href="https://geoportaal.maaamet.ee/" target="_blank">Maa-amet 1 m DTM (WCS)</a>',
};

maplibregl.addProtocol("maamet-wcs", maaametWcsProtocol);

/** Tile loader for ViewportStats — calls the WCS protocol handler directly. */
async function wcsTileLoader(url: string): Promise<ImageData | null> {
  try {
    const ac = new AbortController();
    const { data } = await maaametWcsProtocol({ url }, ac);
    const bitmap = await createImageBitmap(new Blob([data], { type: "image/png" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  } catch {
    return null;
  }
}

const map = new maplibregl.Map({
  container: "map",
  style: buildStyle(),
  center: ESTONIA_CENTER,
  zoom: 6.5,
  minZoom: 5,
  maxZoom: 18,
  maxBounds: [
    [19.0, 56.0],
    [31.0, 61.5],
  ],
  // Sync the map position (z/lat/lng/bearing/pitch) to the URL hash under the
  // `map` key. MapLibre throttles this and uses history.replaceState, so it is
  // cheap and never pollutes the back button.
  hash: "map",
});

map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-right");

const DEFAULT_PALETTE = PALETTES[0]!;
const DEFAULT_FLAT_SEA = false;
const DEFAULT_LOCKED = false;

const urlState = readUrlState();
let palette: Palette = urlState.palette
  ? getPalette(urlState.palette)
  : DEFAULT_PALETTE;
let flatSea = urlState.flatSea ?? DEFAULT_FLAT_SEA;
const initialLocked = urlState.locked ?? DEFAULT_LOCKED;

map.on("load", () => {
  addElevationLayers(map, WCS_DEM, palette, INITIAL_RANGE, flatSea);

  const stats = new ViewportStats(map, {
    tileUrl: "maamet-wcs://{z}/{x}/{y}",
    encoding: "mapbox",
    sourceMaxZoom: WCS_MAX_ZOOM,
    tileLoader: wcsTileLoader,
    onRange: (range) => {
      ui.setRange(range);
      applyRamp(map, palette, range, flatSea);
    },
  });

  if (initialLocked) stats.setLocked(true);

  const ui = new UI({
    map,
    stats,
    initialPalette: palette,
    initialFlatSea: flatSea,
    initialLocked,
    demMaxZoom: WCS_MAX_ZOOM,
    onPaletteChange: (p) => {
      palette = p;
      const range = stats.getCurrentRange() ?? INITIAL_RANGE;
      applyRamp(map, p, range, flatSea);
      writePalette(p.id, DEFAULT_PALETTE.id);
    },
    onLockToggle: (locked) => {
      stats.setLocked(locked);
      writeLocked(locked, DEFAULT_LOCKED);
    },
    onFlatSeaToggle: (fs) => {
      flatSea = fs;
      const range = stats.getCurrentRange() ?? INITIAL_RANGE;
      applyRamp(map, palette, range, fs);
      writeFlatSea(fs, DEFAULT_FLAT_SEA);
    },
    bookmarks: BOOKMARKS,
    onBookmark: (bookmark) => {
      const target = parseBookmark(bookmark.url);
      if (target) {
        map.flyTo({ center: target.center, zoom: target.zoom, duration: 1600 });
      }
    },
    onNavigate: (lat, lng) => {
      map.flyTo({ center: [lng, lat], zoom: AVG_BOOKMARK_ZOOM, duration: 1600 });
    },
  });
});
