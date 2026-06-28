export type RampStop = readonly [number, string];

export type Palette = {
  readonly id: string;
  readonly name: string;
  /** Color stops, each `t` in [0, 1]. `t=0` maps to the bottom of the range, `t=1` to the top. */
  readonly stops: readonly RampStop[];
};

/**
 * Classic cartographic hypsometric tint, tuned for Estonia.
 * Heavy weight at the low end (most of the country is 0-50 m), warming
 * upward through the uplands. The upper range uses more stops to avoid
 * large washed-out areas in the highlands (Estonia tops out ~320 m, no
 * alpine snow cap needed).
 */
const hypsometric: Palette = {
  id: "hypsometric",
  name: "Hypsometric",
  stops: [
    [0.0, "#0a3d7a"],
    [0.04, "#2f7fb2"],
    [0.1, "#7cc2c2"],
    [0.18, "#a8d68a"],
    [0.32, "#cdd877"],
    [0.46, "#e8cf5e"],
    [0.6, "#edab43"],
    [0.72, "#df8732"],
    [0.83, "#c5642a"],
    [0.92, "#a44a23"],
    [1.0, "#8a3c1e"],
  ],
};

/**
 * Same warm cartographic ramp as `hypsometric`, but with the deep-blue / cyan
 * lowland tones removed. Useful when the viewport is entirely on land and you
 * want the full dynamic range spent on greens → yellows → browns.
 */
const hypsometricLand: Palette = {
  id: "hypsometric-land",
  name: "Hypsometric (land)",
  stops: [
    [0.0, "#a8d68a"],
    [0.16, "#cdd877"],
    [0.32, "#e8cf5e"],
    [0.5, "#edab43"],
    [0.64, "#df8732"],
    [0.78, "#c5642a"],
    [0.9, "#a44a23"],
    [1.0, "#8a3c1e"],
  ],
};

const viridis: Palette = {
  id: "viridis",
  name: "Viridis",
  stops: [
    [0.0, "#440154"],
    [0.13, "#482878"],
    [0.27, "#3e4989"],
    [0.4, "#31688e"],
    [0.53, "#26828e"],
    [0.67, "#1f9e89"],
    [0.8, "#6ece58"],
    [0.93, "#b5de2b"],
    [1.0, "#fde725"],
  ],
};

const magma: Palette = {
  id: "magma",
  name: "Magma",
  stops: [
    [0.0, "#000004"],
    [0.16, "#1c1044"],
    [0.32, "#51127c"],
    [0.48, "#822681"],
    [0.64, "#b73779"],
    [0.78, "#e75263"],
    [0.88, "#fc8961"],
    [0.95, "#fec488"],
    [1.0, "#fcfdbf"],
  ],
};

const oceanLand: Palette = {
  id: "ocean-land",
  name: "Ocean → Land",
  stops: [
    [0.0, "#053061"],
    [0.06, "#2166ac"],
    [0.1, "#4393c3"],
    [0.12, "#92c5de"],
    [0.14, "#d1e5f0"],
    [0.16, "#f7f7f7"],
    [0.2, "#a6dba0"],
    [0.4, "#5aae61"],
    [0.65, "#1b7837"],
    [0.85, "#7c5a36"],
    [1.0, "#ffffff"],
  ],
};

const inferno: Palette = {
  id: "inferno",
  name: "Inferno",
  stops: [
    [0.0, "#000004"],
    [0.15, "#1f0c48"],
    [0.3, "#550f6d"],
    [0.45, "#88226a"],
    [0.6, "#bb3754"],
    [0.75, "#e35932"],
    [0.85, "#f98e09"],
    [0.95, "#fcc228"],
    [1.0, "#fcffa4"],
  ],
};

export const PALETTES: readonly Palette[] = [
  hypsometric,
  hypsometricLand,
  oceanLand,
  viridis,
  magma,
  inferno,
];

export function getPalette(id: string): Palette {
  return PALETTES.find((p) => p.id === id) ?? hypsometric;
}
