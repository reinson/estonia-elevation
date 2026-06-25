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

const ESTONIA_CENTER: [number, number] = [25.5, 58.6];
const INITIAL_RANGE: ElevationRange = [-2, 320];

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
const DEFAULT_FLAT_SEA = true;
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
  });
});
