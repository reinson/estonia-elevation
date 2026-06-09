import type { RasterDEMSourceSpecification } from "maplibre-gl";

export type DemEncoding = NonNullable<RasterDEMSourceSpecification["encoding"]>;

export type DemConfig = {
  tileUrl: string;
  encoding: DemEncoding;
  maxZoom: number;
  minZoom?: number;
  attribution: string;
  bounds?: [number, number, number, number];
};
