// Análisis de restricciones de carreteras OSM para vehículos de emergencia.
// Usa la Overpass API para obtener vías con restricciones cerca de la ruta.

import type { Vehicle } from "@/data/vehicles";

export type LatLng = { lat: number; lng: number };

export type RestrictionViolation = {
  index: number; // índice del punto en la ruta donde aparece la restricción
  point: LatLng;
  reason: string;
  tag: string;
  value: string;
  wayName?: string;
};

export type RouteAnalysis = {
  accessible: LatLng[]; // tramo accesible
  blocked: LatLng[]; // tramo inaccesible
  lastAccessible: LatLng | null;
  violations: RestrictionViolation[];
  fullyAccessible: boolean;
};

type OverpassWay = {
  type: "way";
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
};
type OverpassNode = { type: "node"; id: number; lat: number; lon: number };
type OverpassResult = { elements: Array<OverpassWay | OverpassNode> };

type RestrictedSegment = {
  a: LatLng;
  b: LatLng;
  tags: Record<string, string>;
  name?: string;
};

const PARSE_NUM = (s?: string) => {
  if (!s) return NaN;
  const m = s.match(/[\d.]+/);
  return m ? parseFloat(m[0]) : NaN;
};

// Construye query Overpass dentro del bounding box de la ruta.
function buildOverpassQuery(bbox: [number, number, number, number]): string {
  const [s, w, n, e] = bbox;
  return `[out:json][timeout:25];
(
  way["highway"]["maxwidth"](${s},${w},${n},${e});
  way["highway"]["maxheight"](${s},${w},${n},${e});
  way["highway"]["maxweight"](${s},${w},${n},${e});
  way["highway"="pedestrian"](${s},${w},${n},${e});
  way["highway"="footway"](${s},${w},${n},${e});
  way["highway"="path"](${s},${w},${n},${e});
  way["highway"="steps"](${s},${w},${n},${e});
  way["highway"="track"]["tracktype"~"grade[3-5]"](${s},${w},${n},${e});
  way["access"~"^(no|private|destination)$"]["highway"](${s},${w},${n},${e});
  way["motor_vehicle"~"^(no|private|destination)$"]["highway"](${s},${w},${n},${e});
  way["hgv"~"^(no|destination)$"]["highway"](${s},${w},${n},${e});
);
out body;
>;
out skel qt;`;
}

function bboxOfRoute(route: LatLng[], pad = 0.002): [number, number, number, number] {
  let s = 90, n = -90, w = 180, e = -180;
  for (const p of route) {
    if (p.lat < s) s = p.lat;
    if (p.lat > n) n = p.lat;
    if (p.lng < w) w = p.lng;
    if (p.lng > e) e = p.lng;
  }
  return [s - pad, w - pad, n + pad, e + pad];
}

// Distancia aproximada en metros entre 2 puntos (equirectangular, suficiente a esta escala).
function distM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const x = ((b.lng - a.lng) * Math.PI) / 180 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  const y = ((b.lat - a.lat) * Math.PI) / 180;
  return Math.sqrt(x * x + y * y) * R;
}

// Distancia punto-a-segmento en metros.
function distPointToSegmentM(p: LatLng, a: LatLng, b: LatLng): number {
  const toXY = (q: LatLng) => ({
    x: ((q.lng - a.lng) * Math.PI) / 180 * Math.cos((a.lat * Math.PI) / 180) * 6371000,
    y: ((q.lat - a.lat) * Math.PI) / 180 * 6371000,
  });
  const A = { x: 0, y: 0 };
  const B = toXY(b);
  const P = toXY(p);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = A.x + t * dx;
  const cy = A.y + t * dy;
  return Math.hypot(P.x - cx, P.y - cy);
}

// Evalúa si el vehículo viola las restricciones de un set de tags.
function checkTags(vehicle: Vehicle, tags: Record<string, string>): { reason: string; tag: string; value: string } | null {
  const mw = PARSE_NUM(tags.maxwidth);
  if (!isNaN(mw) && vehicle.width > mw) return { reason: `Anchura ${vehicle.width} m supera el límite de ${mw} m`, tag: "maxwidth", value: tags.maxwidth };
  const mh = PARSE_NUM(tags.maxheight);
  if (!isNaN(mh) && vehicle.height > mh) return { reason: `Altura ${vehicle.height} m supera el límite de ${mh} m`, tag: "maxheight", value: tags.maxheight };
  const mwt = PARSE_NUM(tags.maxweight);
  if (!isNaN(mwt) && vehicle.weight > mwt) return { reason: `Peso ${vehicle.weight} t supera el límite de ${mwt} t`, tag: "maxweight", value: tags.maxweight };

  const hwy = tags.highway;
  if (hwy === "pedestrian") return { reason: "Zona peatonal", tag: "highway", value: hwy };
  if (hwy === "footway" || hwy === "path" || hwy === "steps") return { reason: "Vía no apta para vehículos", tag: "highway", value: hwy };
  if (hwy === "track" && tags.tracktype && /grade[3-5]/.test(tags.tracktype)) {
    return { reason: `Pista forestal de baja calidad (${tags.tracktype})`, tag: "tracktype", value: tags.tracktype };
  }

  const access = tags.access;
  if (access === "no" || access === "private") return { reason: `Acceso ${access === "no" ? "prohibido" : "privado"}`, tag: "access", value: access };

  const mv = tags.motor_vehicle;
  if (mv === "no" || mv === "private") return { reason: `Tráfico motorizado ${mv === "no" ? "prohibido" : "privado"}`, tag: "motor_vehicle", value: mv };

  const hgv = tags.hgv;
  if (hgv === "no" && vehicle.weight >= 7.5) return { reason: "Vehículos pesados prohibidos", tag: "hgv", value: hgv };

  return null;
}

export async function analyzeRoute(route: LatLng[], vehicle: Vehicle): Promise<RouteAnalysis> {
  if (route.length < 2) {
    return { accessible: route, blocked: [], lastAccessible: route[0] ?? null, violations: [], fullyAccessible: true };
  }

  const bbox = bboxOfRoute(route);
  const query = buildOverpassQuery(bbox);

  let data: OverpassResult;
  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: "data=" + encodeURIComponent(query),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (!res.ok) throw new Error("overpass");
    data = (await res.json()) as OverpassResult;
  } catch {
    // Sin datos: asumimos accesible pero sin garantías.
    return { accessible: route, blocked: [], lastAccessible: route[route.length - 1], violations: [], fullyAccessible: true };
  }

  const nodes = new Map<number, LatLng>();
  for (const el of data.elements) {
    if (el.type === "node") nodes.set(el.id, { lat: el.lat, lng: el.lon });
  }

  // Construir segmentos restringidos.
  const segments: RestrictedSegment[] = [];
  for (const el of data.elements) {
    if (el.type !== "way" || !el.tags) continue;
    const tags = el.tags;
    // Solo conservar si el vehículo viola algo.
    const v = checkTags(vehicle, tags);
    if (!v) continue;
    const name = tags.name;
    for (let i = 0; i < el.nodes.length - 1; i++) {
      const a = nodes.get(el.nodes[i]);
      const b = nodes.get(el.nodes[i + 1]);
      if (a && b) segments.push({ a, b, tags, name });
    }
  }

  // Para cada punto de la ruta, verificar si está cerca (<18 m) de un segmento restringido.
  const SNAP_M = 18;
  const violations: RestrictionViolation[] = [];
  let firstBlockIdx = -1;
  for (let i = 0; i < route.length; i++) {
    const p = route[i];
    let best: { seg: RestrictedSegment; d: number } | null = null;
    for (const seg of segments) {
      // pre-filtro grueso por bbox del segmento
      const minLat = Math.min(seg.a.lat, seg.b.lat) - 0.0003;
      const maxLat = Math.max(seg.a.lat, seg.b.lat) + 0.0003;
      const minLng = Math.min(seg.a.lng, seg.b.lng) - 0.0003;
      const maxLng = Math.max(seg.a.lng, seg.b.lng) + 0.0003;
      if (p.lat < minLat || p.lat > maxLat || p.lng < minLng || p.lng > maxLng) continue;
      const d = distPointToSegmentM(p, seg.a, seg.b);
      if (d < SNAP_M && (!best || d < best.d)) best = { seg, d };
    }
    if (best) {
      const v = checkTags(vehicle, best.seg.tags)!;
      violations.push({ index: i, point: p, reason: v.reason, tag: v.tag, value: v.value, wayName: best.seg.name });
      if (firstBlockIdx === -1) firstBlockIdx = i;
    }
  }

  if (firstBlockIdx === -1) {
    return { accessible: route, blocked: [], lastAccessible: route[route.length - 1], violations: [], fullyAccessible: true };
  }

  // Buscar el último punto accesible: retrocedemos algunos puntos para alejarnos del conflicto.
  const safeIdx = Math.max(0, firstBlockIdx - 2);
  const accessible = route.slice(0, safeIdx + 1);
  const blocked = route.slice(safeIdx);
  const lastAccessible = accessible[accessible.length - 1] ?? route[0];

  return {
    accessible,
    blocked,
    lastAccessible,
    violations,
    fullyAccessible: false,
  };
}

// Mensajes de cabecera en función del análisis.
export function summaryMessage(analysis: RouteAnalysis, vehicle: Vehicle): string {
  if (analysis.fullyAccessible) {
    if (vehicle.weight >= 18 || vehicle.height >= 3.5) return "Ruta adaptada para vehículo pesado";
    return "Ruta válida para el vehículo seleccionado";
  }
  const v = analysis.violations[0];
  if (!v) return "Acceso restringido en parte de la ruta";
  if (v.tag === "maxwidth") return "Acceso restringido por anchura";
  if (v.tag === "maxheight") return "Acceso restringido por altura (túnel/puente)";
  if (v.tag === "maxweight") return "Acceso restringido por peso";
  if (v.tag === "highway" && v.value === "pedestrian") return "Acceso restringido: zona peatonal";
  if (v.tag === "access") return "Acceso prohibido o privado";
  return "Último punto accesible encontrado";
}
