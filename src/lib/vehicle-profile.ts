// Mapea cada vehículo a un perfil de GraphHopper.
import type { Vehicle } from "@/data/vehicles";
import type { GHProfile } from "@/lib/graphhopper.functions";

export function ghProfileForVehicle(v: Vehicle): GHProfile {
  if (v.weight >= 7.5 || v.height >= 3.3 || v.length >= 8) return "truck";
  if (v.weight >= 3.5) return "small_truck";
  return "car";
}

export const PROFILE_LABEL: Record<GHProfile, string> = {
  truck: "Camión pesado (HGV)",
  small_truck: "Camión ligero",
  car: "Vehículo estándar",
};
