// GraphHopper Routing API server functions.
// Calcula rutas reales con perfiles de vehículos pesados y, si la ruta directa
// no es accesible, hace búsqueda binaria del último punto accesible.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GH_BASE = "https://graphhopper.com/api/1/route";

export type GHProfile = "truck" | "small_truck" | "car";

export type GHRouteResult = {
  ok: boolean;
  profile: GHProfile;
  effectiveProfile: GHProfile; // perfil realmente usado (puede degradarse a car)
  degraded: boolean; // true si se degradó a car por restricciones del plan
  fullyAccessible: boolean;
  coords: { lat: number; lng: number }[]; // ruta completa (lo que se pintará)
  km: number;
  min: number;
  // Si fullyAccessible=false:
  accessibleCoords?: { lat: number; lng: number }[];
  blockedCoords?: { lat: number; lng: number }[];
  lastAccessible?: { lat: number; lng: number };
  walkingMeters?: number; // distancia restante a pie hasta el destino
  message?: string;
  error?: string;
};

const InputSchema = z.object({
  origin: z.object({ lat: z.number(), lng: z.number() }),
  destination: z.object({ lat: z.number(), lng: z.number() }),
  profile: z.enum(["truck", "small_truck", "car"]),
  height: z.number().positive().max(10),
  width: z.number().positive().max(5),
  length: z.number().positive().max(30),
  weight: z.number().positive().max(80),
});

type Input = z.infer<typeof InputSchema>;
type LL = { lat: number; lng: number };

function haversine(a: LL, b: LL): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function ghRoute(
  origin: LL,
  destination: LL,
  profile: GHProfile,
  dims: { height: number; width: number; length: number; weight: number },
  apiKey: string
): Promise<{ status: number; body: any }> {
  const body: Record<string, unknown> = {
    points: [
      [origin.lng, origin.lat],
      [destination.lng, destination.lat],
    ],
    profile,
    points_encoded: false,
    instructions: false,
    calc_points: true,
    locale: "es",
  };
  // Solo aplicar custom_model con dimensiones para perfiles de camión.
  if (profile === "truck" || profile === "small_truck") {
    body["ch.disable"] = true;
    body.custom_model = {
      // Penaliza vías peatonales/pistas y respeta restricciones HGV.
      priority: [
        { if: "road_class == PEDESTRIAN", multiply_by: 0 },
        { if: "road_class == FOOTWAY", multiply_by: 0 },
        { if: "road_class == PATH", multiply_by: 0 },
        { if: "road_class == STEPS", multiply_by: 0 },
        { if: "road_access == PRIVATE", multiply_by: 0 },
        { if: "road_access == NO", multiply_by: 0 },
        { if: "max_width < " + dims.width, multiply_by: 0 },
        { if: "max_height < " + dims.height, multiply_by: 0 },
        { if: "max_weight < " + dims.weight, multiply_by: 0 },
        { if: "max_length < " + dims.length, multiply_by: 0 },
        { if: "hgv == NO", multiply_by: 0 },
      ],
    };
  }

  const res = await fetch(`${GH_BASE}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

function parsePath(json: any): { coords: LL[]; km: number; min: number } | null {
  const path = json?.paths?.[0];
  if (!path) return null;
  const pts = path.points?.coordinates as [number, number][] | undefined;
  if (!pts?.length) return null;
  return {
    coords: pts.map(([lng, lat]) => ({ lat, lng })),
    km: (path.distance ?? 0) / 1000,
    min: (path.time ?? 0) / 60000,
  };
}

export const calculateGraphHopperRoute = createServerFn({ method: "POST" })
  .inputValidator((input: Input) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<GHRouteResult> => {
    const apiKey = process.env.GRAPHHOPPER_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        profile: data.profile,
        effectiveProfile: data.profile,
        degraded: false,
        fullyAccessible: false,
        coords: [],
        km: 0,
        min: 0,
        error: "GRAPHHOPPER_API_KEY no configurada en el servidor.",
      };
    }

    const dims = {
      height: data.height,
      width: data.width,
      length: data.length,
      weight: data.weight,
    };

    // 1) Intentar el perfil solicitado.
    let effective: GHProfile = data.profile;
    let degraded = false;
    let attempt = await ghRoute(data.origin, data.destination, effective, dims, apiKey);

    // Si el plan no soporta el perfil truck/small_truck, GH responde 400/401/403.
    if (attempt.status >= 400 && (effective === "truck" || effective === "small_truck")) {
      effective = "car";
      degraded = true;
      attempt = await ghRoute(data.origin, data.destination, effective, dims, apiKey);
    }

    // 2) Ruta completa con perfil del vehículo → fully accessible.
    if (attempt.status === 200) {
      const parsed = parsePath(attempt.body);
      if (parsed) {
        return {
          ok: true,
          profile: data.profile,
          effectiveProfile: effective,
          degraded,
          fullyAccessible: true,
          coords: parsed.coords,
          km: parsed.km,
          min: parsed.min,
          message: degraded
            ? "Ruta calculada con perfil estándar (perfil de camión no disponible en su plan GraphHopper)."
            : effective === "car"
              ? "Ruta válida para el vehículo seleccionado."
              : "Ruta adaptada para vehículo pesado.",
        };
      }
    }

    // 3) Ruta no encontrada con el perfil del vehículo.
    //    Pedimos una ruta de referencia con coche y buscamos el último punto
    //    accesible mediante búsqueda binaria sobre esa polilínea.
    const refAttempt =
      effective === "car"
        ? attempt
        : await ghRoute(data.origin, data.destination, "car", dims, apiKey);

    if (refAttempt.status !== 200) {
      const msg =
        refAttempt.body?.message ||
        refAttempt.body?.hints?.[0]?.message ||
        `GraphHopper respondió ${refAttempt.status}`;
      return {
        ok: false,
        profile: data.profile,
        effectiveProfile: effective,
        degraded,
        fullyAccessible: false,
        coords: [],
        km: 0,
        min: 0,
        error: msg,
      };
    }

    const ref = parsePath(refAttempt.body);
    if (!ref) {
      return {
        ok: false,
        profile: data.profile,
        effectiveProfile: effective,
        degraded,
        fullyAccessible: false,
        coords: [],
        km: 0,
        min: 0,
        error: "Sin ruta de referencia.",
      };
    }

    // Si efectivamente estamos usando car como perfil del vehículo, no podemos
    // detectar restricciones específicas: devolvemos la ruta tal cual.
    if (effective === "car") {
      return {
        ok: true,
        profile: data.profile,
        effectiveProfile: "car",
        degraded,
        fullyAccessible: true,
        coords: ref.coords,
        km: ref.km,
        min: ref.min,
        message: degraded
          ? "Ruta calculada con perfil estándar (perfil de camión no disponible en su plan GraphHopper)."
          : "Ruta válida para el vehículo seleccionado.",
      };
    }

    // Búsqueda binaria del último punto de `ref.coords` alcanzable con el perfil pesado.
    const coords = ref.coords;
    let lo = 1; // siempre >0 (origen)
    let hi = coords.length - 1;
    let lastOkIdx = 0;
    let lastOkPath: { coords: LL[]; km: number; min: number } | null = null;
    // Limita iteraciones para evitar abuso de cuota (~7 llamadas).
    let iterations = 0;
    while (lo <= hi && iterations < 7) {
      iterations++;
      const mid = Math.floor((lo + hi) / 2);
      const target = coords[mid];
      const a = await ghRoute(data.origin, target, effective, dims, apiKey);
      if (a.status === 200) {
        const p = parsePath(a.body);
        if (p) {
          lastOkIdx = mid;
          lastOkPath = p;
          lo = mid + 1;
          continue;
        }
      }
      hi = mid - 1;
    }

    if (!lastOkPath || lastOkIdx === 0) {
      return {
        ok: true,
        profile: data.profile,
        effectiveProfile: effective,
        degraded,
        fullyAccessible: false,
        coords: ref.coords,
        km: ref.km,
        min: ref.min,
        accessibleCoords: [],
        blockedCoords: ref.coords,
        lastAccessible: data.origin,
        walkingMeters: haversine(data.origin, data.destination),
        message:
          "El vehículo no puede acceder por carretera al destino. Acceso a pie requerido.",
      };
    }

    const lastAccessible = coords[lastOkIdx];
    // Tramo accesible = ruta real del perfil pesado al último punto alcanzable.
    // Tramo bloqueado = resto de la ruta de referencia (lo que el vehículo no puede recorrer).
    const blocked = coords.slice(lastOkIdx);
    let walking = 0;
    for (let i = lastOkIdx; i < coords.length - 1; i++) {
      walking += haversine(coords[i], coords[i + 1]);
    }

    return {
      ok: true,
      profile: data.profile,
      effectiveProfile: effective,
      degraded,
      fullyAccessible: false,
      coords: ref.coords,
      km: ref.km,
      min: ref.min,
      accessibleCoords: lastOkPath.coords,
      blockedCoords: blocked,
      lastAccessible,
      walkingMeters: walking,
      message: "Acceso restringido: último punto accesible localizado.",
    };
  });
