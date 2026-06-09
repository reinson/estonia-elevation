import type {
  ExpressionSpecification,
  Map as MaplibreMap,
  RasterDEMSourceSpecification,
} from "maplibre-gl";
import type { Palette } from "./colorRamps.ts";
import type { DemConfig } from "./config.ts";

export const DEM_SOURCE_ID = "dem";
export const RELIEF_LAYER_ID = "color-relief";
export const HILLSHADE_LAYER_ID = "hillshade";
export const BOUNDS_SOURCE_ID = "dem-bounds";
export const BOUNDS_LAYER_ID = "dem-bounds-outline";

/** Constant color used for the sea in "flat sea" mode. */
export const FLAT_SEA_COLOR = "#7da8c9";

export type ElevationRange = readonly [number, number];

/**
 * Build a color-relief paint expression from a palette + elevation range.
 *
 * When `flatSea` is true, any elevation below 0 m is painted as a single
 * constant color (`FLAT_SEA_COLOR`) instead of being part of the gradient,
 * and the palette is stretched across the land range `[0, maxM]`.
 */
export function buildColorReliefExpression(
  palette: Palette,
  range: ElevationRange,
  flatSea = false,
): ExpressionSpecification {
  const [minM, maxM] = range;

  if (flatSea) {
    const landMin = 0;
    const landMax = Math.max(landMin + 1, maxM);
    const span = landMax - landMin;

    const args: Array<number | string> = [
      "interpolate",
      ["linear"],
      ["elevation"],
    ] as never;
    // Two stops below sea level pin the ocean to a single constant color;
    // the second stop sits just below 0 so the transition to land is sharp.
    args.push(-12000, FLAT_SEA_COLOR);
    args.push(-0.001, FLAT_SEA_COLOR);
    for (const [t, color] of palette.stops) {
      args.push(landMin + t * span, color);
    }
    return args as unknown as ExpressionSpecification;
  }

  const span = Math.max(maxM - minM, 1);
  const args: Array<number | string> = ["interpolate", ["linear"], ["elevation"]] as never;
  for (const [t, color] of palette.stops) {
    args.push(minM + t * span, color);
  }
  return args as unknown as ExpressionSpecification;
}

/** Add the DEM source + color-relief + hillshade layers to the map. */
export function addElevationLayers(
  map: MaplibreMap,
  dem: DemConfig,
  palette: Palette,
  initialRange: ElevationRange,
  flatSea = false,
): void {
  if (!map.getSource(DEM_SOURCE_ID)) {
    const source: RasterDEMSourceSpecification = {
      type: "raster-dem",
      tiles: [dem.tileUrl],
      tileSize: 256,
      maxzoom: dem.maxZoom,
      encoding: dem.encoding,
      attribution: dem.attribution,
    };
    if (dem.bounds) source.bounds = dem.bounds;
    map.addSource(DEM_SOURCE_ID, source);
  }

  const labelsLayerId = map.getLayer("labels") ? "labels" : undefined;

  if (!map.getLayer(RELIEF_LAYER_ID)) {
    map.addLayer(
      {
        id: RELIEF_LAYER_ID,
        type: "color-relief",
        source: DEM_SOURCE_ID,
        paint: {
          "color-relief-color": buildColorReliefExpression(
            palette,
            initialRange,
            flatSea,
          ),
          "color-relief-opacity": 0.85,
        },
      },
      labelsLayerId,
    );
  }

  if (!map.getLayer(HILLSHADE_LAYER_ID)) {
    map.addLayer(
      {
        id: HILLSHADE_LAYER_ID,
        type: "hillshade",
        source: DEM_SOURCE_ID,
        paint: {
          "hillshade-method": "multidirectional",
          "hillshade-exaggeration": 0.55,
          "hillshade-shadow-color": "#1c1b18",
          "hillshade-highlight-color": "#ffffff",
          "hillshade-accent-color": "#000000",
          "hillshade-illumination-direction": [315, 225, 45],
          "hillshade-illumination-altitude": [45, 60, 60],
        },
      },
      labelsLayerId,
    );
  }

  if (dem.bounds && !map.getSource(BOUNDS_SOURCE_ID)) {
    const [w, s, e, n] = dem.bounds;
    map.addSource(BOUNDS_SOURCE_ID, {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [
            [w, s],
            [e, s],
            [e, n],
            [w, n],
            [w, s],
          ],
        },
      },
    });
    map.addLayer({
      id: BOUNDS_LAYER_ID,
      type: "line",
      source: BOUNDS_SOURCE_ID,
      paint: {
        "line-color": "#ff4d2e",
        "line-width": 1.5,
        "line-dasharray": [3, 2],
      },
    });
  }
}

/**
 * Tear down existing DEM layers/source and replace with a new DemConfig.
 * Safe to call after the map has loaded.
 */
export function switchDemSource(
  map: MaplibreMap,
  dem: DemConfig,
  palette: Palette,
  range: ElevationRange,
  flatSea = false,
): void {
  for (const id of [HILLSHADE_LAYER_ID, RELIEF_LAYER_ID, BOUNDS_LAYER_ID]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of [BOUNDS_SOURCE_ID, DEM_SOURCE_ID]) {
    if (map.getSource(id)) map.removeSource(id);
  }
  addElevationLayers(map, dem, palette, range, flatSea);
}

/** Apply a new ramp + range to the color-relief layer. */
export function applyRamp(
  map: MaplibreMap,
  palette: Palette,
  range: ElevationRange,
  flatSea = false,
): void {
  if (!map.getLayer(RELIEF_LAYER_ID)) return;
  map.setPaintProperty(
    RELIEF_LAYER_ID,
    "color-relief-color",
    buildColorReliefExpression(palette, range, flatSea),
  );
}
