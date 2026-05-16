// OpenRouteService Directions API server functions.
// Calcula rutas reales con el perfil driving-hgv aplicando restricciones de
// peso, altura, anchura y longitud del vehículo. Si la ruta directa no es
// accesible, busca por binaria el último punto alcanzable sobre una ruta de
// referencia con coche.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ORS_BASE = "https://api.openrouteservice.org/v2/directions";

export type ORSProfile = "driving-hgv" | "driving-car";

export type ORSRouteResult = {
  ok: boolean;
  profile: ORSProfile;
  effectiveProfile: ORSProfile;
  degraded: boolean;
  fullyAccessible: boolean;
  coords: { lat: number; lng: number }[];
  km: number;
  min: number;
  accessibleCoords?: { lat: number; lng: number }[];
  blockedCoords?: { lat: number; lng: number }[];
  lastAccessible?: { lat: number; lng: number };
  walkingMeters?: number;
  message?: string;
  error?: string;
};

const InputSchema = z.object({
  origin: z.object({ lat: z.number(), lng: z.number() }),
  destination: z.object({ lat: z.number(), lng: z.number() }),
  profile: z.enum(["driving-hgv", "driving-car"]),
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

async function orsRoute(
  origin: LL,
  destination: LL,
  profile: ORSProfile,
  dims: { height: number; width: number; length: number; weight: number },
  apiKey: string
): Promise<{ status: number; body: any }> {
  const body: any = {
    coordinates: [
      [origin.lng, origin.lat],
      [destination.lng, destination.lat],
    ],
    instructions: false,
    language: "es",
  };

  if (profile === "driving-hgv") {
    body.options = {
      vehicle_type: "hgv",
      profile_params: {
        restrictions: {
          height: dims.height,
          width: dims.width,
          length: dims.length,
          weight: dims.weight, // toneladas
        },
      },
    };
  }

  const res = await fetch(`${ORS_BASE}/${profile}/geojson`, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
      Accept: "application/geo+json, application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

function parsePath(json: any): { coords: LL[]; km: number; min: number } | null {
  const feat = json?.features?.[0];
  const pts = feat?.geometry?.coordinates as [number, number][] | undefined;
  const sum = feat?.properties?.summary;
  if (!pts?.length || !sum) return null;
  return {
    coords: pts.map(([lng, lat]) => ({ lat, lng })),
    km: (sum.distance ?? 0) / 1000,
    min: (sum.duration ?? 0) / 60,
  };
}

function extractError(body: any, status: number): string {
  return (
    body?.error?.message ||
    (typeof body?.error === "string" ? body.error : null) ||
    body?.message ||
    `OpenRouteService respondió ${status}`
  );
}

export const calculateOpenRouteRoute = createServerFn({ method: "POST" })
  .inputValidator((input: Input) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<ORSRouteResult> => {
    const apiKey = process.env.OPENROUTESERVICE_API_KEY;
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
        error: "OPENROUTESERVICE_API_KEY no configurada en el servidor.",
      };
    }

    const dims = {
      height: data.height,
      width: data.width,
      length: data.length,
      weight: data.weight,
    };

    // 1) Intentar el perfil solicitado (normalmente driving-hgv).
    let effective: ORSProfile = data.profile;
    let degraded = false;
    let attempt = await orsRoute(data.origin, data.destination, effective, dims, apiKey);

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
          message:
            effective === "driving-hgv"
              ? "Ruta adaptada para vehículo pesado."
              : "Ruta válida para el vehículo seleccionado.",
        };
      }
    }

    // 2) Ruta no encontrada con el perfil del vehículo.
    //    Pedir una ruta de referencia con coche y buscar el último punto
    //    accesible mediante búsqueda binaria.
    const refAttempt =
      effective === "driving-car"
        ? attempt
        : await orsRoute(data.origin, data.destination, "driving-car", dims, apiKey);

    if (refAttempt.status !== 200) {
      return {
        ok: false,
        profile: data.profile,
        effectiveProfile: effective,
        degraded,
        fullyAccessible: false,
        coords: [],
        km: 0,
        min: 0,
        error: extractError(refAttempt.body, refAttempt.status),
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

    if (effective === "driving-car") {
      return {
        ok: true,
        profile: data.profile,
        effectiveProfile: "driving-car",
        degraded,
        fullyAccessible: true,
        coords: ref.coords,
        km: ref.km,
        min: ref.min,
        message: "Ruta válida para el vehículo seleccionado.",
      };
    }

    // Búsqueda binaria del último punto accesible para el perfil pesado.
    const coords = ref.coords;
    let lo = 1;
    let hi = coords.length - 1;
    let lastOkIdx = 0;
    let lastOkPath: { coords: LL[]; km: number; min: number } | null = null;
    let iterations = 0;
    while (lo <= hi && iterations < 7) {
      iterations++;
      const mid = Math.floor((lo + hi) / 2);
      const target = coords[mid];
      const a = await orsRoute(data.origin, target, effective, dims, apiKey);
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
