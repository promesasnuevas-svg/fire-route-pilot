import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Truck,
  Search,
  Navigation,
  MapPin,
  Ruler,
  Weight,
  AlertTriangle,
  Loader2,
  Crosshair,
  Flame,
  Trees,
  ArrowUpToLine,
  Droplets,
  LifeBuoy,
  Shield,
  Cross,
  ShieldAlert,
  RotateCw,
  ShieldCheck,
  Ban,
} from "lucide-react";
import { VEHICLES, vehicleRouteWarnings, type Vehicle, type VehicleCategory } from "@/data/vehicles";
import { analyzeRoute, summaryMessage, type RouteAnalysis } from "@/lib/restrictions";

const CATEGORY_META: Record<
  VehicleCategory,
  { label: string; icon: typeof Flame; color: string; tint: string }
> = {
  urban: { label: "Urbano", icon: Flame, color: "oklch(0.65 0.22 25)", tint: "oklch(0.65 0.22 25 / 0.15)" },
  forestry: { label: "Forestal", icon: Trees, color: "oklch(0.7 0.17 155)", tint: "oklch(0.7 0.17 155 / 0.15)" },
  ladder: { label: "Altura", icon: ArrowUpToLine, color: "oklch(0.78 0.17 75)", tint: "oklch(0.78 0.17 75 / 0.15)" },
  tanker: { label: "Cisterna", icon: Droplets, color: "oklch(0.62 0.18 230)", tint: "oklch(0.62 0.18 230 / 0.15)" },
  rescue: { label: "Rescate", icon: LifeBuoy, color: "oklch(0.7 0.18 50)", tint: "oklch(0.7 0.18 50 / 0.15)" },
  command: { label: "Mando", icon: Shield, color: "oklch(0.7 0.05 250)", tint: "oklch(0.7 0.05 250 / 0.15)" },
  medical: { label: "Sanitario", icon: Cross, color: "oklch(0.85 0.15 145)", tint: "oklch(0.85 0.15 145 / 0.15)" },
  military: { label: "UME", icon: ShieldAlert, color: "oklch(0.6 0.12 130)", tint: "oklch(0.6 0.12 130 / 0.15)" },
};

type LatLng = { lat: number; lng: number };
type Suggestion = { display_name: string; lat: string; lon: string };

const fireIcon = L.divIcon({
  className: "",
  html: `<div style="background:oklch(0.65 0.22 25);width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 4px 12px rgba(0,0,0,.5);font-size:18px">🚒</div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});
const targetIcon = L.divIcon({
  className: "",
  html: `<div style="position:relative;width:34px;height:44px"><div style="position:absolute;left:50%;top:0;transform:translateX(-50%);width:30px;height:30px;border-radius:50% 50% 50% 0;transform-origin:center;rotate:-45deg;background:oklch(0.62 0.24 25);border:3px solid white;box-shadow:0 4px 12px rgba(0,0,0,.5)"></div><div style="position:absolute;left:50%;top:9px;transform:translateX(-50%);width:10px;height:10px;border-radius:50%;background:white"></div></div>`,
  iconSize: [34, 44],
  iconAnchor: [17, 42],
});
const lastAccessIcon = L.divIcon({
  className: "",
  html: `<div style="background:oklch(0.78 0.17 75);width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 4px 12px rgba(0,0,0,.5);font-size:14px;font-weight:bold;color:#000">!</div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

function FlyTo({ position }: { position: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (!position) return;
    map.flyTo([position.lat, position.lng], Math.max(map.getZoom(), 15), { duration: 0.8 });
  }, [position, map]);
  return null;
}

function FitBounds({ points }: { points: LatLng[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length < 2) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [60, 60] });
  }, [points, map]);
  return null;
}

export function FireRouteApp() {
  const [vehicle, setVehicle] = useState<Vehicle>(VEHICLES[0]);
  const [origin, setOrigin] = useState<LatLng>({ lat: 40.4168, lng: -3.7038 }); // Madrid
  const [originLabel, setOriginLabel] = useState<string>("Madrid (predeterminado)");
  const [destination, setDestination] = useState<LatLng | null>(null);
  const [flyTarget, setFlyTarget] = useState<LatLng | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [route, setRoute] = useState<LatLng[]>([]);
  const [stats, setStats] = useState<{ km: number; min: number } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setOrigin(p);
        setOriginLabel("Mi ubicación actual");
        setFlyTarget(p);
      },
      () => {},
      { timeout: 5000, enableHighAccuracy: true }
    );
  };

  const calculateRoute = async () => {
    if (!destination) return;
    setCalculating(true);
    setWarnings([]);
    setRoute([]);
    setStats(null);
    try {
      // OSRM public demo. No real truck restrictions, so we annotate warnings client-side.
      const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&alternatives=true`;
      const res = await fetch(url);
      const data = await res.json();
      if (!data.routes?.length) throw new Error("Sin ruta");
      // Pick the route with fewest very-tight residential segments would require road class data.
      // We use the first (fastest) and surface generic restriction warnings based on vehicle size.
      const r = data.routes[0];
      const coords: LatLng[] = r.geometry.coordinates.map(([lng, lat]: [number, number]) => ({ lat, lng }));
      setRoute(coords);
      setStats({ km: r.distance / 1000, min: r.duration / 60 });

      const w = vehicleRouteWarnings(vehicle);
      w.push("Ruta calculada con perfil estándar. Verificar in situ restricciones reales.");
      setWarnings(w);
    } catch {
      setWarnings(["No se pudo calcular la ruta. Reintente."]);
    } finally {
      setCalculating(false);
    }
  };

  const points = useMemo(() => {
    const arr: LatLng[] = [origin];
    if (destination) arr.push(destination);
    return arr;
  }, [origin, destination]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <aside className="flex h-full w-[420px] flex-shrink-0 flex-col border-r border-border bg-sidebar">
        <header className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg">
            <Truck className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">FireRoute</h1>
            <p className="text-xs text-muted-foreground">Sistema de rutas para emergencias</p>
          </div>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* Vehicle selector */}
          <section>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Flota de vehículos
            </label>
            <div className="grid gap-2">
              {VEHICLES.map((v) => {
                const active = v.id === vehicle.id;
                const meta = CATEGORY_META[v.category];
                const Icon = meta.icon;
                return (
                  <button
                    key={v.id}
                    onClick={() => setVehicle(v)}
                    className={`group flex items-stretch gap-3 rounded-xl border p-3 text-left transition active:scale-[0.99] ${
                      active
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card hover:border-muted-foreground/40"
                    }`}
                  >
                    <div
                      className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg"
                      style={{ background: meta.tint, color: meta.color }}
                    >
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-semibold">{v.name}</div>
                        {active && (
                          <div className="ml-auto h-2 w-2 flex-shrink-0 rounded-full bg-primary shadow-[0_0_10px] shadow-primary" />
                        )}
                      </div>
                      <div
                        className="mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                        style={{ background: meta.tint, color: meta.color }}
                      >
                        {v.type}
                      </div>
                      <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                        {v.description}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-foreground/80">
                        <span>↕ {v.height} m</span>
                        <span>↔ {v.width} m</span>
                        <span>⇆ {v.length} m</span>
                        <span>⚖ {v.weight} t</span>
                        <span>↻ {v.turningRadius} m</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-muted/40 p-3 text-xs">
              <Spec icon={<Ruler className="h-3.5 w-3.5" />} label="Altura" value={`${vehicle.height} m`} />
              <Spec icon={<Ruler className="h-3.5 w-3.5 rotate-90" />} label="Anchura" value={`${vehicle.width} m`} />
              <Spec icon={<Ruler className="h-3.5 w-3.5" />} label="Longitud" value={`${vehicle.length} m`} />
              <Spec icon={<Weight className="h-3.5 w-3.5" />} label="Peso" value={`${vehicle.weight} t`} />
              <Spec icon={<RotateCw className="h-3.5 w-3.5" />} label="Radio giro" value={`${vehicle.turningRadius} m`} />
            </div>
          </section>

          {/* Origin */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Origen
              </label>
              <button
                onClick={useMyLocation}
                className="flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1 text-[11px] font-semibold text-foreground/80 hover:bg-muted"
              >
                <Crosshair className="h-3.5 w-3.5" />
                Mi ubicación
              </button>
            </div>
            <AddressSearch
              placeholder="Origen: parque, calle, ciudad…"
              initialValue={originLabel}
              onSelect={(s) => {
                const p = { lat: parseFloat(s.lat), lng: parseFloat(s.lon) };
                setOrigin(p);
                setOriginLabel(s.display_name);
                setFlyTarget(p);
              }}
            />
          </section>

          {/* Destination */}
          <section>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Destino
            </label>
            <AddressSearch
              placeholder="Destino: calle, número, ciudad…"
              onSelect={(s) => {
                const p = { lat: parseFloat(s.lat), lng: parseFloat(s.lon) };
                setDestination(p);
                setFlyTarget(p);
              }}
            />
          </section>

          {/* Calculate */}
          <button
            onClick={calculateRoute}
            disabled={!destination || calculating}
            className="flex h-16 w-full items-center justify-center gap-3 rounded-xl bg-primary text-lg font-bold text-primary-foreground shadow-lg transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {calculating ? <Loader2 className="h-6 w-6 animate-spin" /> : <Navigation className="h-6 w-6" />}
            {calculating ? "Calculando…" : "Calcular Ruta"}
          </button>

          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Distancia" value={`${stats.km.toFixed(1)} km`} />
              <Stat label="Tiempo est." value={`${Math.round(stats.min)} min`} />
            </div>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="rounded-xl border border-warning/40 bg-warning/10 p-4">
              <div className="mb-2 flex items-center gap-2 text-warning">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-wider">Restricciones a verificar</span>
              </div>
              <ul className="space-y-1.5 text-xs leading-relaxed text-foreground/90">
                {warnings.map((w, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-warning">•</span>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </aside>

      {/* Map */}
      <main className="relative flex-1">
        <MapContainer
          center={[origin.lat, origin.lng]}
          zoom={13}
          className="h-full w-full"
          zoomControl={true}
        >
          <TileLayer
            attribution='&copy; OpenStreetMap'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker position={[origin.lat, origin.lng]} icon={fireIcon} />
          {destination && <Marker position={[destination.lat, destination.lng]} icon={targetIcon} />}
          {route.length > 0 && (
            <>
              <Polyline positions={route.map((p) => [p.lat, p.lng] as [number, number])} pathOptions={{ color: "#000", weight: 9, opacity: 0.4 }} />
              <Polyline positions={route.map((p) => [p.lat, p.lng] as [number, number])} pathOptions={{ color: "oklch(0.65 0.22 25)", weight: 5, opacity: 1 }} />
            </>
          )}
          {route.length > 0 ? (
            <FitBounds points={route} />
          ) : (
            <FlyTo position={flyTarget} />
          )}
        </MapContainer>

        {/* Floating status pill */}
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-border bg-card/90 px-5 py-2 text-sm font-medium shadow-xl backdrop-blur">
          <span className="text-muted-foreground">Vehículo activo · </span>
          <span className="text-primary">{vehicle.name}</span>
        </div>
      </main>
    </div>
  );
}

function Spec({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-muted-foreground">{label}:</span>
      <span className="ml-auto font-semibold">{value}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

function AddressSearch({
  placeholder,
  initialValue,
  onSelect,
}: {
  placeholder: string;
  initialValue?: string;
  onSelect: (s: Suggestion) => void;
}) {
  const [query, setQuery] = useState(initialValue ?? "");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPicked = useRef<string>(initialValue ?? "");

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 3 || query === lastPicked.current) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8&countrycodes=es&q=${encodeURIComponent(query)}`,
          { headers: { "Accept-Language": "es" } }
        );
        const data = (await res.json()) as Suggestion[];
        setSuggestions(data);
        setOpen(true);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 350);
  }, [query]);

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => suggestions.length && setOpen(true)}
          placeholder={placeholder}
          className="h-14 w-full rounded-xl border border-border bg-input pl-11 pr-4 text-base outline-none transition focus:border-primary"
        />
        {searching && (
          <Loader2 className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>
      {open && suggestions.length > 0 && (
        <ul className="absolute z-[1000] mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-card shadow-2xl">
          {suggestions.map((s, i) => (
            <li key={i}>
              <button
                onClick={() => {
                  lastPicked.current = s.display_name;
                  setQuery(s.display_name);
                  setSuggestions([]);
                  setOpen(false);
                  onSelect(s);
                }}
                className="flex w-full items-start gap-2 border-b border-border/60 px-3 py-3 text-left text-sm last:border-b-0 hover:bg-muted/50"
              >
                <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
                <span className="line-clamp-2">{s.display_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
