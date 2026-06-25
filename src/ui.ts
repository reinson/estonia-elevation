import type { Map as MaplibreMap, MapMouseEvent } from "maplibre-gl";
import { PALETTES, type Palette } from "./colorRamps.ts";
import {
  FLAT_SEA_COLOR,
  HILLSHADE_LAYER_ID,
  RELIEF_LAYER_ID,
} from "./elevation.ts";
import type { ElevationRange, ViewportStats } from "./viewportStats.ts";

export type MapType = "elevation" | "hybrid" | "map";

export type Bookmark = {
  name: string;
  /** Full app URL containing a `#map=zoom/lat/lng` hash. */
  url: string;
};

export type UIOptions = {
  map: MaplibreMap;
  stats: ViewportStats;
  initialPalette: Palette;
  initialFlatSea: boolean;
  initialLocked?: boolean;
  demMaxZoom: number;
  onPaletteChange: (p: Palette) => void;
  onLockToggle: (locked: boolean) => void;
  onFlatSeaToggle: (flatSea: boolean) => void;
  bookmarks?: Bookmark[];
  onBookmark?: (bookmark: Bookmark) => void;
  onNavigate?: (lat: number, lng: number) => void;
};

export class UI {
  private opts: UIOptions;
  private palette: Palette;
  private range: ElevationRange = [0, 100];
  private locked = false;
  private flatSea: boolean;
  private demMaxZoom: number;
  private mapType: MapType = "hybrid";
  private mapTypeBtns: Record<MapType, HTMLButtonElement> =
    {} as Record<MapType, HTMLButtonElement>;

  private legendBarEl!: HTMLElement;
  private legendSeaEl!: HTMLElement;
  private legendMinEl!: HTMLElement;
  private legendMaxEl!: HTMLElement;
  private readoutEl!: HTMLElement;
  private zoomInfoEl!: HTMLElement;
  private lockBtnEl!: HTMLButtonElement;
  private flatSeaBtnEl!: HTMLButtonElement;
  private paletteSelectEl!: HTMLSelectElement;

  constructor(opts: UIOptions) {
    this.opts = opts;
    this.palette = opts.initialPalette;
    this.flatSea = opts.initialFlatSea;
    this.locked = opts.initialLocked ?? false;
    this.demMaxZoom = opts.demMaxZoom;
    this.build();
    this.bindMapEvents();
  }

  setRange(range: ElevationRange): void {
    this.range = range;
    this.renderLegend();
  }

  setPalette(palette: Palette): void {
    this.palette = palette;
    this.paletteSelectEl.value = palette.id;
    this.renderLegend();
  }

  setDemMaxZoom(maxZoom: number): void {
    this.demMaxZoom = maxZoom;
    this.updateZoomInfo();
  }

  private build(): void {
    const bookmarks = this.opts.bookmarks ?? [];
    const panel = document.createElement("div");
    panel.className = "ee-panel";
    panel.innerHTML = `
      <header>
        <div class="ee-title">Estonia Elevation</div>
        <div class="ee-subtitle">Live 1 m LiDAR · Maa-amet WCS</div>
        <div class="ee-source">DTM · zoom ≥ 15 for 1 m detail</div>
      </header>

      <div class="ee-section">
        <label for="ee-palette">Palette</label>
        <select id="ee-palette">
          ${PALETTES.map(
            (p) =>
              `<option value="${p.id}"${
                p.id === this.palette.id ? " selected" : ""
              }>${p.name}</option>`,
          ).join("")}
        </select>
      </div>

      <div class="ee-section ee-legend">
        <div class="ee-legend-stack">
          <div class="ee-legend-sea" hidden></div>
          <div class="ee-legend-bar"></div>
        </div>
        <div class="ee-legend-labels">
          <span class="ee-legend-min">0 m</span>
          <span class="ee-legend-max">100 m</span>
        </div>
      </div>

      <div class="ee-section ee-goto">
        <label for="ee-goto-input">Go to coordinates</label>
        <div class="ee-goto-row">
          <input
            id="ee-goto-input"
            class="ee-goto-input"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            spellcheck="false"
            placeholder="57.764063, 26.875972"
          />
          <button id="ee-goto-btn" class="ee-goto-btn" type="button" title="Go">Go</button>
        </div>
        <div class="ee-goto-error" hidden></div>
      </div>

      <div class="ee-section ee-toggles">
        <button id="ee-flat-sea" class="ee-toggle" type="button" aria-pressed="false">
          Flat sea
        </button>
        <button id="ee-lock" class="ee-toggle" type="button" aria-pressed="false">
          Lock range
        </button>
      </div>
${
  bookmarks.length
    ? `
      <div class="ee-section ee-bookmarks">
        <label>Bookmarks</label>
        <div class="ee-bookmark-grid">
          ${bookmarks
            .map(
              (b, i) =>
                `<button class="ee-bookmark" type="button" data-idx="${i}" title="${b.name}">${b.name}</button>`,
            )
            .join("")}
        </div>
      </div>`
    : ""
}

      <footer class="ee-attrib">
        <a href="https://geoportaal.maaamet.ee/" target="_blank" rel="noopener">Maa-amet</a> &middot;
        <a href="https://maplibre.org/" target="_blank" rel="noopener">MapLibre</a> &middot;
        <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Tilezen (low zoom)</a>
      </footer>
    `;
    document.body.appendChild(panel);
    this.legendBarEl = panel.querySelector(".ee-legend-bar")!;
    this.legendSeaEl = panel.querySelector(".ee-legend-sea")!;
    this.legendMinEl = panel.querySelector(".ee-legend-min")!;
    this.legendMaxEl = panel.querySelector(".ee-legend-max")!;
    this.lockBtnEl = panel.querySelector("#ee-lock") as HTMLButtonElement;
    this.flatSeaBtnEl = panel.querySelector("#ee-flat-sea") as HTMLButtonElement;
    this.paletteSelectEl = panel.querySelector("#ee-palette") as HTMLSelectElement;

    this.legendSeaEl.style.background = FLAT_SEA_COLOR;
    this.applyFlatSeaButtonState();
    this.applyLockButtonState();

    this.paletteSelectEl.addEventListener("change", () => {
      const next = PALETTES.find((p) => p.id === this.paletteSelectEl.value);
      if (!next) return;
      this.palette = next;
      this.renderLegend();
      this.opts.onPaletteChange(next);
    });

    const gotoInput = panel.querySelector("#ee-goto-input") as HTMLInputElement;
    const gotoBtn = panel.querySelector("#ee-goto-btn") as HTMLButtonElement;
    const gotoError = panel.querySelector(".ee-goto-error") as HTMLElement;
    const submitGoto = () => {
      const parsed = parseCoords(gotoInput.value);
      if (!parsed) {
        gotoError.textContent = "Enter coordinates as lat, lng";
        gotoError.hidden = false;
        return;
      }
      gotoError.hidden = true;
      this.opts.onNavigate?.(parsed.lat, parsed.lng);
    };
    gotoBtn.addEventListener("click", submitGoto);
    gotoInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitGoto();
      }
    });
    gotoInput.addEventListener("input", () => {
      gotoError.hidden = true;
    });

    this.lockBtnEl.addEventListener("click", () => {
      this.locked = !this.locked;
      this.applyLockButtonState();
      this.opts.onLockToggle(this.locked);
    });

    this.flatSeaBtnEl.addEventListener("click", () => {
      this.flatSea = !this.flatSea;
      this.applyFlatSeaButtonState();
      this.renderLegend();
      this.opts.onFlatSeaToggle(this.flatSea);
    });

    panel.querySelectorAll<HTMLButtonElement>(".ee-bookmark").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        const bookmark = bookmarks[idx];
        if (bookmark) this.opts.onBookmark?.(bookmark);
      });
    });

    const readout = document.createElement("div");
    readout.className = "ee-readout";
    readout.textContent = "Hover the map";
    document.body.appendChild(readout);
    this.readoutEl = readout;

    const zoomInfo = document.createElement("div");
    zoomInfo.className = "ee-zoom-info";
    document.body.appendChild(zoomInfo);
    this.zoomInfoEl = zoomInfo;
    this.updateZoomInfo();

    this.buildMapTypeControl();

    this.renderLegend();
  }

  private buildMapTypeControl(): void {
    const control = document.createElement("div");
    control.className = "ee-maptype";
    const items: Array<{ type: MapType; label: string; title: string }> = [
      { type: "elevation", label: "Elevation", title: "Show only the elevation relief" },
      { type: "hybrid", label: "Hybrid", title: "Elevation relief over the base map" },
      { type: "map", label: "Map", title: "Show only the base map" },
    ];
    control.innerHTML = items
      .map(
        ({ type, label, title }) =>
          `<button class="ee-maptype-btn" type="button" data-type="${type}" title="${title}">${label}</button>`,
      )
      .join("");
    document.body.appendChild(control);

    for (const { type } of items) {
      const btn = control.querySelector(
        `[data-type="${type}"]`,
      ) as HTMLButtonElement;
      this.mapTypeBtns[type] = btn;
      btn.addEventListener("click", () => this.setMapType(type));
    }

    this.applyMapType();
  }

  private setMapType(type: MapType): void {
    if (this.mapType === type) return;
    this.mapType = type;
    this.applyMapType();
  }

  private applyMapType(): void {
    const map = this.opts.map;
    const showBasemap = this.mapType !== "elevation";
    const showElevation = this.mapType !== "map";

    const setVisible = (id: string, visible: boolean) => {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      }
    };

    setVisible("basemap", showBasemap);
    // Labels (street names, places) belong to the base map; hide them in
    // elevation-only mode so the relief is completely pure.
    setVisible("labels", showBasemap);
    setVisible(RELIEF_LAYER_ID, showElevation);
    setVisible(HILLSHADE_LAYER_ID, showElevation);

    // In hybrid mode the relief is translucent so the base map blends through;
    // in elevation-only mode there is nothing meaningful underneath, so make it
    // fully opaque to get pure, saturated relief colors.
    if (map.getLayer(RELIEF_LAYER_ID)) {
      map.setPaintProperty(
        RELIEF_LAYER_ID,
        "color-relief-opacity",
        this.mapType === "elevation" ? 1 : 0.85,
      );
    }

    for (const [type, btn] of Object.entries(this.mapTypeBtns)) {
      const active = type === this.mapType;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    }
  }

  private renderLegend(): void {
    const stops = this.palette.stops
      .map(([t, c]) => `${c} ${(t * 100).toFixed(1)}%`)
      .join(", ");
    this.legendBarEl.style.background = `linear-gradient(to right, ${stops})`;
    this.legendSeaEl.hidden = !this.flatSea;
    this.legendMaxEl.textContent = `${formatMeters(this.range[1])}`;
    if (this.flatSea) {
      this.legendMinEl.textContent = "0 m / sea";
    } else {
      this.legendMinEl.textContent = `${formatMeters(this.range[0])}`;
    }
  }

  private applyLockButtonState(): void {
    this.lockBtnEl.setAttribute("aria-pressed", String(this.locked));
    this.lockBtnEl.classList.toggle("active", this.locked);
    this.lockBtnEl.textContent = this.locked ? "Range locked" : "Lock range";
  }

  private applyFlatSeaButtonState(): void {
    this.flatSeaBtnEl.setAttribute("aria-pressed", String(this.flatSea));
    this.flatSeaBtnEl.classList.toggle("active", this.flatSea);
    this.flatSeaBtnEl.textContent = this.flatSea ? "Flat sea on" : "Flat sea";
  }

  private updateZoomInfo(): void {
    const map = this.opts.map;
    const zoom = map.getZoom();
    const lat = map.getCenter().lat;
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const viewRes = (156543.03 * cosLat) / Math.pow(2, zoom);
    const dataRes = (156543.03 * cosLat) / Math.pow(2, this.demMaxZoom);
    const zInt = Math.floor(zoom);
    const overzoomed = zoom > this.demMaxZoom;
    const suffix = overzoomed ? " ↑" : "";
    this.zoomInfoEl.textContent =
      `z${zInt}  ·  ${formatResolution(viewRes)}  ·  data ${formatResolution(dataRes)}${suffix}`;
  }

  private bindMapEvents(): void {
    let pending: number | null = null;
    let pendingEvt: MapMouseEvent | null = null;
    const handle = async () => {
      pending = null;
      const evt = pendingEvt;
      if (!evt) return;
      const { lng, lat } = evt.lngLat;
      const elev = await this.opts.stats.elevationAt(lng, lat);
      const elStr =
        elev === null ? "—" : `${elev.toFixed(elev < 100 ? 1 : 0)} m`;
      this.readoutEl.textContent = `${formatLngLat(lng, lat)}  ·  ${elStr}`;
    };

    this.opts.map.on("mousemove", (e) => {
      pendingEvt = e;
      if (pending !== null) return;
      pending = window.setTimeout(handle, 40);
    });

    this.opts.map.on("mouseout", () => {
      this.readoutEl.textContent = "Hover the map";
    });

    this.opts.map.on("zoom", () => this.updateZoomInfo());
    this.opts.map.on("move", () => this.updateZoomInfo());
  }
}

function formatResolution(mPerPx: number): string {
  if (mPerPx >= 1000) return `${(mPerPx / 1000).toFixed(1)} km/px`;
  if (mPerPx >= 10) return `${Math.round(mPerPx)} m/px`;
  return `${mPerPx.toFixed(1)} m/px`;
}

function formatMeters(m: number): string {
  if (Math.abs(m) >= 100) return `${Math.round(m)} m`;
  return `${m.toFixed(1)} m`;
}

function formatLngLat(lng: number, lat: number): string {
  return `${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E`;
}

/**
 * Parse a "lat, lng" string into coordinates. Accepts comma- or
 * whitespace-separated decimals (e.g. "57.764063, 26.875972"), with an
 * optional trailing N/E hemisphere letter.
 */
function parseCoords(input: string): { lat: number; lng: number } | null {
  const cleaned = input.trim().replace(/[°NSEWnsew]/g, " ");
  const matches = cleaned.match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length < 2) return null;
  const lat = parseFloat(matches[0]!);
  const lng = parseFloat(matches[1]!);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}
