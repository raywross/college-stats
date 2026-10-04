/**
 * The U.S. outline for the Explore map (specs/data-expansion/campus-profile.md). Server-side only: it projects
 * coordinates and pre-renders the outline, so the client gets path strings and points, not d3 or the TopoJSON.
 *
 * `us-atlas/states-albers-10m.json` is already projected with geoAlbersUsa at scale 1300 and translate
 * [487.5, 305] into a 975 × 610 box; points use the same projection so they land on it.
 */
import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import states from "us-atlas/states-albers-10m.json";
import { SETTING_GROUPS } from "./campus-profile";
import type { School, SchoolType } from "./types";
import { crestBrand, type CrestBrand } from "./brand";

export const MAP_WIDTH = 975;
export const MAP_HEIGHT = 610;

const projection = geoAlbersUsa().scale(1300).translate([487.5, 305]);

/** Map-box [x, y] for a coordinate, or null outside the 50 states and DC (Puerto Rico, Guam, ...). */
export function projectLngLat(lng: number, lat: number): [number, number] | null {
  const p = projection([lng, lat]);
  return p ? [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10] : null;
}

let outline: { nation: string; borders: string } | null = null;

/** The nation's outline and the borders between states, as SVG path data in the map box. */
export function usOutline(): { nation: string; borders: string } {
  if (outline) return outline;
  const topo = states as unknown as Topology<{ states: GeometryCollection; nation: GeometryCollection }>;
  const path = geoPath().digits(1);
  outline = {
    nation: path(feature(topo, topo.objects.nation)) ?? "",
    borders: path(mesh(topo, topo.objects.states, (a, b) => a !== b)) ?? "",
  };
  return outline;
}

/** One college on the map: position in the map box plus what the hover card shows. */
export interface MapPoint {
  id: string;
  name: string;
  x: number;
  y: number;
  enrollment: number;
  type: SchoolType;
  city: string;
  state: string;
  setting: string | null;
  admit: number | null;
  /** The hover card crest's colors and mark (specs/school-identity/brand.md), when the college has them. */
  brand?: CrestBrand;
}

/** Colleges with coordinates, projected; `outside` counts those in territories the map doesn't draw. */
export function mapPoints(schools: School[]): { points: MapPoint[]; outside: number; missing: number } {
  const points: MapPoint[] = [];
  let outside = 0;
  let missing = 0;
  for (const s of schools) {
    const { lat, lng } = s.location;
    if (lat == null || lng == null) {
      missing++;
      continue;
    }
    const xy = projectLngLat(lng, lat);
    if (!xy) {
      outside++;
      continue;
    }
    const brand = crestBrand(s);
    points.push({
      id: s.unit_id,
      name: s.name,
      x: xy[0],
      y: xy[1],
      enrollment: s.demographics.undergrad_enrollment,
      type: s.type,
      city: s.location.city,
      state: s.location.state,
      setting: s.campus?.setting ? (SETTING_GROUPS.find((g) => g.key === s.campus!.setting!.group)?.label ?? null) : null,
      admit: s.admissions.acceptance_rate,
      ...(brand ? { brand } : {}),
    });
  }
  return { points, outside, missing };
}
