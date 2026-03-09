import { useState, useEffect, useCallback, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { routeAlertsApi, routesApi } from '../../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Reporter {
  user_name: string;
  tipo: 'ruta_real' | 'trancon';
  created_at: string;
}

interface RouteAlert {
  id: number;
  name: string;
  code: string;
  geometry: [number, number][] | null;
  ruta_real_count: number;
  trancon_count: number;
  last_report_at: string;
  route_alert_reviewed_at: string | null;
  reporters: Reporter[];
  reporter_positions: [number, number][];
}

// ─── Mini-map component ───────────────────────────────────────────────────────

function RouteMapPreview({
  geometry,
  reporterPositions,
}: {
  geometry: [number, number][] | null;
  reporterPositions: [number, number][];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, { zoomControl: true, attributionControl: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    mapRef.current = map;

    const bounds: L.LatLngTuple[] = [];

    // Geometría actual (azul)
    if (geometry && geometry.length >= 2) {
      const latlngs = geometry.map(([lat, lng]) => [lat, lng] as L.LatLngTuple);
      L.polyline(latlngs, { color: '#3B82F6', weight: 4, opacity: 0.85 }).addTo(map);
      // Marcadores inicio / fin
      const startIcon = L.divIcon({
        className: '',
        html: `<div style="background:#22C55E;width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>`,
        iconSize: [12, 12], iconAnchor: [6, 6],
      });
      const endIcon = L.divIcon({
        className: '',
        html: `<div style="background:#EF4444;width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>`,
        iconSize: [12, 12], iconAnchor: [6, 6],
      });
      L.marker(latlngs[0], { icon: startIcon }).addTo(map);
      L.marker(latlngs[latlngs.length - 1], { icon: endIcon }).addTo(map);
      bounds.push(...latlngs);
    }

    // Posiciones GPS de reportantes (rojo, pulsante)
    reporterPositions.forEach(([lat, lng]) => {
      const icon = L.divIcon({
        className: '',
        html: `<div style="position:relative;width:16px;height:16px">
          <div style="position:absolute;inset:0;background:#EF4444;border-radius:50%;opacity:0.35;animation:ping 1.5s cubic-bezier(0,0,0.2,1) infinite"></div>
          <div style="position:absolute;inset:3px;background:#EF4444;border-radius:50%;border:1.5px solid white"></div>
        </div>`,
        iconSize: [16, 16], iconAnchor: [8, 8],
      });
      L.marker([lat, lng], { icon }).addTo(map);
      bounds.push([lat, lng] as L.LatLngTuple);
    });

    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [24, 24] });
    } else {
      map.setView([10.96, -74.8], 12);
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative">
      <div ref={containerRef} style={{ height: 260 }} className="rounded-lg overflow-hidden z-0" />
      {/* Leyenda */}
      <div className="absolute bottom-2 left-2 bg-white/90 rounded-md px-2 py-1.5 text-xs flex flex-col gap-1 shadow-sm z-[1000]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-1 bg-blue-500 rounded" />
          Trazado actual en DB
        </span>
        {reporterPositions.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 bg-red-500 rounded-full" />
            GPS de reportantes
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminRouteAlerts() {
  const [alerts, setAlerts] = useState<RouteAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [dismissing, setDismissing] = useState<number | null>(null);
  const [regenerating, setRegenerating] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await routeAlertsApi.getAlerts();
      setAlerts(res.data.alerts);
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleExpanded = (id: number) =>
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  const handleDismiss = async (routeId: number) => {
    setDismissing(routeId);
    try {
      await routeAlertsApi.dismissAlert(routeId);
      setAlerts(prev => prev.filter(a => a.id !== routeId));
    } finally {
      setDismissing(null);
    }
  };

  const handleRegenerate = async (routeId: number) => {
    setRegenerating(routeId);
    try {
      await routesApi.regenerateGeometry(routeId);
      await routeAlertsApi.dismissAlert(routeId);
      setAlerts(prev => prev.filter(a => a.id !== routeId));
    } finally {
      setRegenerating(null);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('es-CO', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const formatRelative = (iso: string) => {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 60) return `hace ${mins} min`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `hace ${hrs} h`;
    return `hace ${Math.round(hrs / 24)} días`;
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Alertas de rutas desactualizadas</h1>
        <p className="text-sm text-gray-500 mt-1">
          Rutas donde 3 o más pasajeros reportaron que el bus tomó un camino diferente al mapa.
          El mapa muestra el trazado guardado (azul) y los puntos GPS de quienes reportaron (rojo).
        </p>
      </div>

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-1/3 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {!loading && alerts.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="text-4xl mb-3">✅</div>
          <p className="text-gray-500 text-sm">No hay alertas pendientes.</p>
          <p className="text-gray-400 text-xs mt-1">
            Aparecerán aquí cuando 3+ usuarios reporten una ruta como desactualizada.
          </p>
        </div>
      )}

      {!loading && alerts.length > 0 && (
        <div className="space-y-4">
          {alerts.map(alert => (
            <div
              key={alert.id}
              className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 bg-amber-50 border-b border-amber-100">
                <div className="flex items-center gap-3">
                  <span className="text-lg">⚠️</span>
                  <div>
                    <span className="font-semibold text-gray-900">{alert.name}</span>
                    <span className="ml-2 text-xs font-mono bg-amber-100 text-amber-800 px-2 py-0.5 rounded">
                      {alert.code}
                    </span>
                  </div>
                </div>
                <span className="text-xs text-gray-400 hidden sm:block">
                  Último reporte: {formatDate(alert.last_report_at)}
                </span>
              </div>

              {/* Stats */}
              <div className="px-4 py-3 flex items-center gap-4 flex-wrap border-b border-gray-100">
                <span className="inline-flex items-center gap-1.5 bg-red-100 text-red-700 text-sm font-semibold px-3 py-1 rounded-full">
                  🗺️ {alert.ruta_real_count} dijeron "la ruta está mal"
                </span>
                {Number(alert.trancon_count) > 0 && (
                  <span className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-600 text-sm px-3 py-1 rounded-full">
                    🚧 {alert.trancon_count} dijeron "trancón"
                  </span>
                )}
                <button
                  onClick={() => toggleExpanded(alert.id)}
                  className="ml-auto text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  {expanded[alert.id] ? '▲ Ocultar detalles' : '▼ Ver trazado y reportantes'}
                </button>
              </div>

              {/* Collapsible: map + reporters */}
              {expanded[alert.id] && (
                <div className="px-4 py-4 space-y-4 border-b border-gray-100">

                  {/* Mini-map */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      Comparación visual
                    </p>
                    {alert.geometry ? (
                      <RouteMapPreview
                        geometry={alert.geometry}
                        reporterPositions={alert.reporter_positions}
                      />
                    ) : (
                      <div className="bg-gray-100 rounded-lg h-40 flex items-center justify-center text-sm text-gray-400">
                        Esta ruta no tiene geometría guardada aún.
                      </div>
                    )}
                    {alert.reporter_positions.length === 0 && alert.geometry && (
                      <p className="text-xs text-gray-400 mt-1.5">
                        No hay posiciones GPS recientes de los reportantes (últimos 7 días).
                      </p>
                    )}
                  </div>

                  {/* Reporters table */}
                  {alert.reporters.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                        Quiénes reportaron
                      </p>
                      <div className="rounded-lg border border-gray-100 overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                              <th className="px-3 py-2 text-left font-medium">Usuario</th>
                              <th className="px-3 py-2 text-left font-medium">Tipo</th>
                              <th className="px-3 py-2 text-left font-medium">Cuándo</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {alert.reporters.map((r, i) => (
                              <tr key={i} className="hover:bg-gray-50">
                                <td className="px-3 py-2 font-medium text-gray-900">{r.user_name}</td>
                                <td className="px-3 py-2">
                                  {r.tipo === 'ruta_real' ? (
                                    <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded-full">
                                      🗺️ Ruta diferente
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-600 text-xs font-medium px-2 py-0.5 rounded-full">
                                      🚧 Trancón
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-gray-500 text-xs">
                                  {formatRelative(r.created_at)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
                <button
                  onClick={() => handleRegenerate(alert.id)}
                  disabled={regenerating === alert.id || dismissing === alert.id}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  {regenerating === alert.id ? (
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                  ) : '🔄'}
                  Regenerar desde paradas
                </button>
                <a
                  href="/admin/routes"
                  className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  ✏️ Editar trazado manualmente
                </a>
                <button
                  onClick={() => handleDismiss(alert.id)}
                  disabled={dismissing === alert.id || regenerating === alert.id}
                  className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  {dismissing === alert.id ? (
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                  ) : '✓'}
                  Ya revisé, marcar cerrada
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
