// Base de datos local temporal de vehículos de emergencia (España).
// Preparada para uso futuro en restricciones de rutas y calles estrechas.

export type VehicleCategory =
  | "urban"
  | "forestry"
  | "ladder"
  | "tanker"
  | "rescue"
  | "command"
  | "medical"
  | "military";

export type Vehicle = {
  id: string;
  name: string;
  type: string;
  category: VehicleCategory;
  height: number; // m
  width: number; // m
  length: number; // m
  weight: number; // t
  turningRadius: number; // m
  description: string;
};

export const VEHICLES: Vehicle[] = [
  {
    id: "bup-ligera",
    name: "BUP Ligera",
    type: "Bomba Urbana Ligera",
    category: "urban",
    height: 3.0,
    width: 2.2,
    length: 6.5,
    weight: 9,
    turningRadius: 9,
    description: "Vehículo compacto para cascos históricos y calles estrechas.",
  },
  {
    id: "bup-pesada",
    name: "Bomba Urbana Pesada",
    type: "BUP",
    category: "urban",
    height: 3.3,
    width: 2.5,
    length: 8.0,
    weight: 16,
    turningRadius: 12,
    description: "Vehículo urbano estándar de intervención.",
  },
  {
    id: "bul-forestal",
    name: "Autobomba Forestal Ligera",
    type: "BUL",
    category: "forestry",
    height: 3.1,
    width: 2.3,
    length: 6.8,
    weight: 10,
    turningRadius: 10,
    description: "Vehículo para pistas forestales y caminos rurales.",
  },
  {
    id: "bfp-forestal",
    name: "Autobomba Forestal Pesada",
    type: "BFP",
    category: "forestry",
    height: 3.4,
    width: 2.5,
    length: 8.5,
    weight: 18,
    turningRadius: 13,
    description: "Vehículo forestal pesado para incendios de gran magnitud.",
  },
  {
    id: "aea",
    name: "Autoescala Automática",
    type: "AEA",
    category: "ladder",
    height: 3.9,
    width: 2.55,
    length: 11.0,
    weight: 26,
    turningRadius: 18,
    description: "Vehículo con escalera automática para rescates en altura.",
  },
  {
    id: "nodriza",
    name: "Nodriza Pesada",
    type: "Nodriza",
    category: "tanker",
    height: 3.7,
    width: 2.55,
    length: 10.0,
    weight: 28,
    turningRadius: 17,
    description: "Vehículo cisterna de gran capacidad de agua.",
  },
  {
    id: "fsv",
    name: "Vehículo de Rescate",
    type: "FSV",
    category: "rescue",
    height: 3.2,
    width: 2.45,
    length: 7.5,
    weight: 14,
    turningRadius: 11,
    description: "Vehículo especializado en rescate técnico.",
  },
  {
    id: "jefatura",
    name: "Vehículo Ligero de Jefatura",
    type: "Jefatura",
    category: "command",
    height: 2.1,
    width: 1.9,
    length: 5.0,
    weight: 3,
    turningRadius: 6,
    description: "Vehículo rápido de mando y coordinación.",
  },
  {
    id: "ambulancia-svb",
    name: "Ambulancia de Soporte Vital",
    type: "Ambulancia",
    category: "medical",
    height: 2.8,
    width: 2.1,
    length: 6.2,
    weight: 5,
    turningRadius: 8,
    description: "Ambulancia de emergencias sanitarias.",
  },
  {
    id: "ume-pesada",
    name: "Unidad Militar de Emergencias Pesada",
    type: "UME",
    category: "military",
    height: 3.8,
    width: 2.55,
    length: 9.5,
    weight: 22,
    turningRadius: 16,
    description: "Vehículo pesado de intervención en catástrofes.",
  },
];

// Restricciones genéricas a verificar al calcular ruta (uso futuro).
export function vehicleRouteWarnings(v: Vehicle): string[] {
  const w: string[] = [];
  if (v.height >= 3.5) w.push(`Altura ${v.height} m: revisar pasos inferiores < 4 m.`);
  if (v.width >= 2.5) w.push(`Anchura ${v.width} m: evitar callejones < 3 m.`);
  if (v.weight >= 18) w.push(`Peso ${v.weight} t: comprobar limitaciones de tonelaje.`);
  if (v.length >= 9) w.push(`Longitud ${v.length} m: vigilar radios de giro estrechos.`);
  if (v.turningRadius >= 14) w.push(`Radio de giro ${v.turningRadius} m: evitar cruces angostos.`);
  return w;
}
