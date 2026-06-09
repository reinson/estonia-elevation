import type { LngLatBounds, Map as MaplibreMap } from "maplibre-gl";
import type { DemEncoding } from "./config.ts";

/**
 * Viewport-adaptive elevation statistics.
 *
 * Fetches the same Terrarium DEM tiles MapLibre uses, samples a 16x16
 * grid per tile in JS, and reports p02/p98 of all visible samples on
 * every moveend. The result is EMA-smoothed to avoid jumpy ramps during
 * panning.
 *
 * This intentionally re-fetches tiles instead of poking MapLibre's
 * private DEM tile cache. The browser disk cache makes the cost
 * negligible after the first viewport.
 */

const SAMPLE_GRID = 16;
const CACHE_LIMIT = 512;
const EMA_ALPHA = 0.45;
/** Floor on ramp width so a tiny window over a flat peat bog doesn't make sensor noise look like terrain. */
const MIN_WINDOW = 6;
/** Discard decoded samples below this value — nodata pixels encode as RGB(0,0,0) → −10000 in Mapbox format. */
const MIN_VALID_ELEVATION = -500;
/** The colour ramp low end should never drop below sea level. */
const RANGE_FLOOR = 0;

export type ElevationRange = readonly [number, number];
export type RangeListener = (range: ElevationRange) => void;

type TileSamples = Float32Array;

function tileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}

function lngToTileX(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}

function latToTileYFloat(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z
  );
}

function latToTileY(lat: number, z: number): number {
  return Math.floor(latToTileYFloat(lat, z));
}

function tileBounds(
  z: number,
  x: number,
  y: number,
): { west: number; north: number; east: number; south: number } {
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const nLat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const sLat =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
  return { west, north: nLat, east, south: sLat };
}

type Decoder = (r: number, g: number, b: number) => number;

const DECODERS: Record<DemEncoding, Decoder> = {
  terrarium: (r, g, b) => r * 256 + g + b / 256 - 32768,
  mapbox: (r, g, b) => -10000 + (r * 65536 + g * 256 + b) * 0.1,
  custom: (r, g, b) => -10000 + (r * 65536 + g * 256 + b) * 0.1,
};

async function loadTileImage(url: string): Promise<ImageData | null> {
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, img.width, img.height);
  } catch {
    return null;
  }
}

function sampleImageData(img: ImageData, decode: Decoder): TileSamples {
  const out = new Float32Array(SAMPLE_GRID * SAMPLE_GRID);
  const stride = Math.max(1, Math.floor(img.width / SAMPLE_GRID));
  let i = 0;
  for (let gy = 0; gy < SAMPLE_GRID; gy++) {
    const py = Math.min(gy * stride, img.height - 1);
    for (let gx = 0; gx < SAMPLE_GRID; gx++) {
      const px = Math.min(gx * stride, img.width - 1);
      const idx = (py * img.width + px) * 4;
      out[i++] = decode(img.data[idx]!, img.data[idx + 1]!, img.data[idx + 2]!);
    }
  }
  return out;
}

export type ViewportStatsOptions = {
  onRange: RangeListener;
  tileUrl: string;
  encoding: DemEncoding;
  /** Maximum zoom for which DEM tiles exist. */
  sourceMaxZoom?: number;
  /**
   * Optional custom tile loader. When provided, called instead of the default
   * `<img>` fetch for every tile URL. Useful for custom protocols (e.g. WCS)
   * that the browser cannot load as a plain image.
   */
  tileLoader?: (url: string) => Promise<ImageData | null>;
};

export class ViewportStats {
  private map: MaplibreMap;
  private listener: RangeListener;
  private tileUrl: string;
  private decode: Decoder;
  private sourceMaxZoom: number;
  private tileLoader: ((url: string) => Promise<ImageData | null>) | undefined;
  private cache = new Map<string, TileSamples>();
  private imageCache = new Map<string, ImageData>();
  private inflight = new Map<string, Promise<TileSamples | null>>();
  private current: [number, number] | null = null;
  private locked = false;
  private generation = 0;

  constructor(map: MaplibreMap, opts: ViewportStatsOptions) {
    this.map = map;
    this.listener = opts.onRange;
    this.tileUrl = opts.tileUrl;
    this.decode = DECODERS[opts.encoding];
    this.sourceMaxZoom = opts.sourceMaxZoom ?? 14;
    this.tileLoader = opts.tileLoader;
    this.handleMoveEnd = this.handleMoveEnd.bind(this);
    this.map.on("moveend", this.handleMoveEnd);
    queueMicrotask(() => this.refresh());
  }

  destroy(): void {
    this.map.off("moveend", this.handleMoveEnd);
  }

  setSource(
    tileUrl: string,
    encoding: DemEncoding,
    sourceMaxZoom: number,
    tileLoader?: (url: string) => Promise<ImageData | null>,
  ): void {
    this.tileUrl = tileUrl;
    this.decode = DECODERS[encoding];
    this.sourceMaxZoom = sourceMaxZoom;
    this.tileLoader = tileLoader;
    this.cache.clear();
    this.imageCache.clear();
    this.inflight.clear();
    this.current = null;
    this.generation++;
    void this.refresh();
  }

  setLocked(locked: boolean): void {
    this.locked = locked;
  }

  isLocked(): boolean {
    return this.locked;
  }

  getCurrentRange(): ElevationRange | null {
    return this.current;
  }

  forceCurrentRange(range: ElevationRange): void {
    this.current = [range[0], range[1]];
    this.listener(this.current);
  }

  /** Decode the exact elevation under a [lng, lat] point, fetching the tile if needed. */
  async elevationAt(lng: number, lat: number): Promise<number | null> {
    const z = this.statsZoom();
    const x = lngToTileX(lng, z);
    const y = latToTileY(lat, z);
    const key = tileKey(z, x, y);
    let img = this.imageCache.get(key);
    if (!img) {
      const url = this.tileUrlFor(z, x, y);
      img = (await this.loadTile(url)) ?? undefined;
      if (!img) return null;
      this.imageCache.set(key, img);
      this.evictImages();
    }
    const b = tileBounds(z, x, y);
    const fx = ((lng - b.west) / (b.east - b.west)) * img.width;
    const fy = (latToTileYFloat(lat, z) - y) * img.height;
    const px = Math.min(img.width - 1, Math.max(0, Math.floor(fx)));
    const py = Math.min(img.height - 1, Math.max(0, Math.floor(fy)));
    const idx = (py * img.width + px) * 4;
    return this.decode(img.data[idx]!, img.data[idx + 1]!, img.data[idx + 2]!);
  }

  private handleMoveEnd(): void {
    if (this.locked) return;
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    const gen = ++this.generation;
    const z = this.statsZoom();
    const bounds = this.map.getBounds();
    const keys = this.tilesCovering(bounds, z);
    if (keys.length === 0) return;

    this.recompute(keys, gen);

    const pending: Promise<unknown>[] = [];
    for (const key of keys) {
      if (this.cache.has(key)) continue;
      let p = this.inflight.get(key);
      if (!p) {
        const [tz, tx, ty] = key.split("/").map(Number) as [number, number, number];
        const url = this.tileUrlFor(tz, tx, ty);
        p = this.loadTile(url).then((img) => {
          this.inflight.delete(key);
          if (!img) return null;
          this.imageCache.set(key, img);
          this.evictImages();
          const samples = sampleImageData(img, this.decode);
          this.cache.set(key, samples);
          this.evictSamples();
          return samples;
        });
        this.inflight.set(key, p);
      }
      pending.push(p);
    }

    if (pending.length === 0) return;
    await Promise.all(pending);
    this.recompute(keys, gen);
  }

  private recompute(keys: string[], gen: number): void {
    if (gen !== this.generation || this.locked) return;
    let count = 0;
    for (const k of keys) {
      const ts = this.cache.get(k);
      if (ts) count += ts.length;
    }
    if (count < 64) return;

    const samples = new Float32Array(count);
    let off = 0;
    for (const k of keys) {
      const ts = this.cache.get(k);
      if (!ts) continue;
      samples.set(ts, off);
      off += ts.length;
    }

    samples.sort();

    // Find the first index with a valid (non-nodata) elevation value.
    let validStart = 0;
    while (validStart < samples.length && samples[validStart]! < MIN_VALID_ELEVATION) {
      validStart++;
    }
    const valid = validStart === 0 ? samples : samples.subarray(validStart);
    if (valid.length < 64) return;

    let p02 = valid[Math.floor(valid.length * 0.02)]!;
    let p98 = valid[Math.floor(valid.length * 0.98)]!;

    p02 = Math.max(RANGE_FLOOR, p02);

    if (p98 - p02 < MIN_WINDOW) {
      const mid = (p02 + p98) / 2;
      p02 = Math.max(RANGE_FLOOR, mid - MIN_WINDOW / 2);
      p98 = mid + MIN_WINDOW / 2;
    }

    let next: [number, number] = [p02, p98];
    if (this.current) {
      next = [
        this.current[0] * (1 - EMA_ALPHA) + next[0] * EMA_ALPHA,
        this.current[1] * (1 - EMA_ALPHA) + next[1] * EMA_ALPHA,
      ];
    }
    this.current = next;
    this.listener(next);
  }

  private statsZoom(): number {
    const z = Math.floor(this.map.getZoom() + 0.5);
    return Math.max(5, Math.min(this.sourceMaxZoom, z));
  }

  private tilesCovering(bounds: LngLatBounds, z: number): string[] {
    const x0 = lngToTileX(bounds.getWest(), z);
    const x1 = lngToTileX(bounds.getEast(), z);
    const y0 = latToTileY(bounds.getNorth(), z);
    const y1 = latToTileY(bounds.getSouth(), z);
    const max = 2 ** z - 1;
    const out: string[] = [];
    for (let y = Math.max(0, y0); y <= Math.min(max, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(max, x1); x++) {
        out.push(tileKey(z, x, y));
      }
    }
    return out;
  }

  private loadTile(url: string): Promise<ImageData | null> {
    if (this.tileLoader) return this.tileLoader(url);
    return loadTileImage(url);
  }

  private tileUrlFor(z: number, x: number, y: number): string {
    return this.tileUrl
      .replace("{z}", String(z))
      .replace("{x}", String(x))
      .replace("{y}", String(y));
  }

  private evictSamples(): void {
    if (this.cache.size <= CACHE_LIMIT) return;
    const drop = this.cache.size - CACHE_LIMIT;
    let i = 0;
    for (const k of this.cache.keys()) {
      if (i++ >= drop) break;
      this.cache.delete(k);
    }
  }

  private evictImages(): void {
    const limit = 64;
    if (this.imageCache.size <= limit) return;
    const drop = this.imageCache.size - limit;
    let i = 0;
    for (const k of this.imageCache.keys()) {
      if (i++ >= drop) break;
      this.imageCache.delete(k);
    }
  }
}
