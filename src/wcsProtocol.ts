/**
 * Custom MapLibre protocol `maamet-wcs://` that serves Mapbox Terrain-RGB tiles
 * from two backends depending on zoom level:
 *
 *   z < WCS_MIN_ZOOM  →  AWS Terrarium tiles (transcoded to Mapbox encoding)
 *   z ≥ WCS_MIN_ZOOM  →  Maa-amet WCS dtm-1 (1 m LiDAR, parsed from GeoTIFF)
 *
 * Register once with:
 *   maplibregl.addProtocol("maamet-wcs", maaametWcsProtocol);
 *
 * Use as tile URL:
 *   maamet-wcs://{z}/{x}/{y}
 */

import { fromArrayBuffer } from "geotiff";

/** Switch to WCS at this zoom. Below this, fall back to AWS 30 m tiles. */
export const WCS_MIN_ZOOM = 15;

/** Max zoom the WCS source is useful (1 m data, ~1.2 m/px at 59°N). */
export const WCS_MAX_ZOOM = 17;

const TERRARIUM_URL = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

const WCS_BASE =
  "https://teenus.maaamet.ee/ows/wcs-dtm?SERVICE=WCS&VERSION=2.0.1" +
  "&REQUEST=GetCoverage&CoverageId=dtm-1&format=image/tiff" +
  "&SUBSETTINGCRS=EPSG:4326&OUTPUTCRS=EPSG:4326";

const ESTONIA = { west: 21.5, south: 57.3, east: 28.3, north: 59.9 };

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

function tileToLngLatBounds(x: number, y: number, z: number) {
  const n = Math.pow(2, z);
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const north =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const south =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
  return { west, east, north, south };
}

function intersectsEstonia(b: ReturnType<typeof tileToLngLatBounds>) {
  return (
    b.east > ESTONIA.west &&
    b.west < ESTONIA.east &&
    b.north > ESTONIA.south &&
    b.south < ESTONIA.north
  );
}

function parseTileUrl(url: string): [number, number, number] {
  // URL looks like: maamet-wcs://15/18234/9876
  const m = url.match(/maamet-wcs:\/\/(\d+)\/(\d+)\/(\d+)/);
  if (!m) throw new Error(`Cannot parse tile URL: ${url}`);
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

// ---------------------------------------------------------------------------
// Elevation array helpers
// ---------------------------------------------------------------------------

/** Decode Terrarium-encoded PNG pixels to float32 elevation (metres). */
async function decodeTerrariumPng(
  buf: ArrayBuffer,
): Promise<{ data: Float32Array; width: number; height: number }> {
  const bitmap = await createImageBitmap(new Blob([buf], { type: "image/png" }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const px = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  const elev = new Float32Array(bitmap.width * bitmap.height);
  for (let i = 0; i < elev.length; i++) {
    elev[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
  }
  return { data: elev, width: bitmap.width, height: bitmap.height };
}

/**
 * Encode a float32 elevation grid (srcW × srcH) into a 256×256
 * Mapbox Terrain-RGB PNG. Nearest-neighbour resampling.
 */
async function encodeMapboxTile(
  src: Float32Array,
  srcW: number,
  srcH: number,
): Promise<ArrayBuffer> {
  const SIZE = 256;
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(SIZE, SIZE);

  for (let dy = 0; dy < SIZE; dy++) {
    for (let dx = 0; dx < SIZE; dx++) {
      const sx = Math.min(Math.round((dx * srcW) / SIZE), srcW - 1);
      const sy = Math.min(Math.round((dy * srcH) / SIZE), srcH - 1);
      const e = src[sy * srcW + sx];
      // Mapbox encoding: encoded = (elev + 10000) × 10
      const enc = Math.max(0, Math.min(0xffffff, Math.round((e + 10000) * 10)));
      const i = (dy * SIZE + dx) * 4;
      img.data[i] = (enc >> 16) & 0xff;
      img.data[i + 1] = (enc >> 8) & 0xff;
      img.data[i + 2] = enc & 0xff;
      img.data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return blob.arrayBuffer();
}

/** Return a flat 0 m tile — used outside Estonia bounds. */
async function zeroTile(): Promise<ArrayBuffer> {
  return encodeMapboxTile(new Float32Array(256 * 256), 256, 256);
}

// ---------------------------------------------------------------------------
// WCS fetch
// ---------------------------------------------------------------------------

async function fetchWcsTile(
  bounds: ReturnType<typeof tileToLngLatBounds>,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const { west, east, north, south } = bounds;
  // Clamp to Estonia to avoid huge responses at the boundary
  const w = Math.max(west, ESTONIA.west).toFixed(6);
  const e = Math.min(east, ESTONIA.east).toFixed(6);
  const s = Math.max(south, ESTONIA.south).toFixed(6);
  const n = Math.min(north, ESTONIA.north).toFixed(6);

  const url =
    `${WCS_BASE}&subset=Lat(${s},${n})&subset=Long(${w},${e})`;

  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`WCS HTTP ${resp.status}`);

  const buf = await resp.arrayBuffer();
  const tiff = await fromArrayBuffer(buf);
  const image = await tiff.getImage();
  const rasters = await image.readRasters();
  const raw = rasters[0] as Float32Array;
  const srcW = image.getWidth();
  const srcH = image.getHeight();

  // Replace nodata (-9999 and below, or 0 outside coverage) with 0 m
  const nodata = (image.getGDALNoData() as number | null) ?? -9999;
  for (let i = 0; i < raw.length; i++) {
    if (!isFinite(raw[i]) || raw[i] <= nodata + 1) raw[i] = 0;
  }

  return encodeMapboxTile(raw, srcW, srcH);
}

// ---------------------------------------------------------------------------
// Protocol handler (registered with maplibregl.addProtocol)
// ---------------------------------------------------------------------------

export async function maaametWcsProtocol(
  params: { url: string },
  abortController: AbortController,
): Promise<{ data: ArrayBuffer }> {
  const [z, x, y] = parseTileUrl(params.url);
  const bounds = tileToLngLatBounds(x, y, z);
  const signal = abortController.signal;

  try {
    if (z < WCS_MIN_ZOOM) {
      // Low zoom: transcode AWS Terrarium → Mapbox encoding
      const resp = await fetch(TERRARIUM_URL(z, x, y), { signal });
      if (!resp.ok) return { data: await zeroTile() };
      const { data, width, height } = await decodeTerrariumPng(
        await resp.arrayBuffer(),
      );
      return { data: await encodeMapboxTile(data, width, height) };
    }

    if (!intersectsEstonia(bounds)) {
      return { data: await zeroTile() };
    }

    return { data: await fetchWcsTile(bounds, signal) };
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    console.warn("[maamet-wcs] tile error:", err);
    return { data: await zeroTile() };
  }
}
