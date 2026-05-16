// Mapea cada vehículo a un perfil de OpenRouteService.
import type { Vehicle } from "@/data/vehicles";
import type { ORSProfile } from "@/lib/openroute.functions";

export function orsProfileForVehicle(v: Vehicle): ORSProfile {
  // driving-hgv aplica restricciones reales de peso/altura/anchura/longitud.
  if (v.weight >= 3.5 || v.height >= 2.8 || v.length >= 6) return "driving-hgv";
  return "driving-car";
}

export const PROFILE_LABEL: Record<ORSProfile, string> = {
  "driving-hgv": "Camión pesado (HGV)",
  "driving-car": "Vehículo estándar",
};
