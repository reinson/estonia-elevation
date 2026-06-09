import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { buildStyle } from "./style.ts";
import { addElevationLayers, applyRamp } from "./elevation.ts";
import { PALETTES, type Palette } from "./colorRamps.ts";
import { ViewportStats, type ElevationRange } from "./viewportStats.ts";
import { UI } from "./ui.ts";
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
});

map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-right");

let palette: Palette = PALETTES[0]!;
let flatSea = true;

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

  const ui = new UI({
    map,
    stats,
    initialPalette: palette,
    initialFlatSea: flatSea,
    demMaxZoom: WCS_MAX_ZOOM,
    onPaletteChange: (p) => {
      palette = p;
      const range = stats.getCurrentRange() ?? INITIAL_RANGE;
      applyRamp(map, p, range, flatSea);
    },
    onLockToggle: (locked) => {
      stats.setLocked(locked);
    },
    onFlatSeaToggle: (fs) => {
      flatSea = fs;
      const range = stats.getCurrentRange() ?? INITIAL_RANGE;
      applyRamp(map, palette, range, fs);
    },
    onFlyToOverview: () => {
      map.flyTo({ center: ESTONIA_CENTER, zoom: 6.5, duration: 1600 });
    },
    onFlyToElva: () => {
      map.flyTo({ center: [26.452, 58.241], zoom: 13, duration: 1800 });
    },
    onFlyToTartu: () => {
      map.flyTo({ center: [26.729, 58.378], zoom: 13, duration: 1800 });
    },
  });
});
