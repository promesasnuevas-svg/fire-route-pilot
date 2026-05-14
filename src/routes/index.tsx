import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const FireRouteApp = lazy(() =>
  import("@/components/FireRouteApp").then((m) => ({ default: m.FireRouteApp }))
);

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FireRoute — Rutas para vehículos de emergencia" },
      {
        name: "description",
        content:
          "Aplicación profesional para calcular rutas de camiones de bomberos sobre OpenStreetMap, optimizada para tablets en vehículos de emergencia.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
          Cargando mapa…
        </div>
      }
    >
      <FireRouteApp />
    </Suspense>
  );
}
