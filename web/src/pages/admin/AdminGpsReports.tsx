import { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { routeAlertsApi, routesApi } from '../../services/api';

interface GpsReport {
  id: number;
  route_id: number;
  route_name: string;
  route_code: string;
  user_name: string;
  created_at: string;
  reported_geometry: [number, number][] | null;
  route_geometry: [number, number][] | null;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  return `hace ${Math.floor(hrs / 24)}d`;
}

function MiniMap({ routeGeometry, reportedGeometry }: {
  routeGeometry: [number, number][] | null;
  reportedGeometry: [number, number][] | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;
    const map = L.map(el, { zoomControl: false, attributionControl: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    mapRef.current = map;

    const bounds: L.LatLngTuple[] = [];

    if (routeGeometry && routeGeometry.length >= 2) {
      const latlngs = routeGeometry.map(([lat, lng]) => [lat, lng] as L.LatLngTuple);
      L.polyline(latlngs, { color: '#3B82F6', weight: 3, opacity: 0.7 }).addTo(map);
      bounds.push(...latlngs);
    }

    if (reportedGeometry && reportedGeometry.length >= 1) {
      const latlngs = reportedGeometry.map(([lat, lng]) => [lat, lng] as L.LatLngTuple);
      if (latlngs.length >= 2) {
        L.polyline(latlngs, { color: '#F97316', weight: 4, opacity: 0.95 }).addTo(map);
      }
      // Always show a marker at the reported position
      const dotIcon = L.divIcon({
        className: '',
        html: `<div style="background:#F97316;width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.5)"></div>`,
        iconSize: [12, 12], iconAnchor: [6, 6],
      });
      L.marker(latlngs[0], { icon: dotIcon }).addTo(map);
      bounds.push(...latlngs);
    }

    if (bounds.length >= 2) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [16, 16] });
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 15);
    } else {
      map.setView([10.9685, -74.7813], 13);
    }

    return () => { map.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} style={{ height: 200, borderRadius: 8, overflow: 'hidden' }} />;
}

export default function AdminGpsReports() {
  const [reports, setReports] = useState<GpsReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await routeAlertsApi.getRutaRealReports();
      setReports((res.data as any).reports);
    } catch {
      setMsg({ text: 'Error al cargar reportes', ok: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function applyGeometry(report: GpsReport) {
    if (!report.reported_geometry || report.reported_geometry.length < 2) {
      setMsg({ text: 'Este reporte no tiene trazado GPS suficiente', ok: false });
      return;
    }
    setApplying(report.id);
    try {
      await routesApi.applyReportedGeometry(report.route_id, report.reported_geometry);
      setMsg({ text: `Geometria aplicada a ${report.route_code} - ${report.route_name}`, ok: true });
      load();
    } catch {
      setMsg({ text: 'Error al aplicar geometria', ok: false });
    } finally {
      setApplying(null);
    }
  }

  async function deleteReport(report: GpsReport) {
    setDeleting(report.id);
    try {
      await routeAlertsApi.deleteRutaRealReport(report.id);
      setReports(prev => prev.filter(r => r.id !== report.id));
    } catch {
      setMsg({ text: 'Error al eliminar', ok: false });
    } finally {
      setDeleting(null);
    }
  }

  // Group reports by route
  const grouped = reports.reduce<Record<number, { route_id: number; route_name: string; route_code: string; items: GpsReport[] }>>((acc, r) => {
    if (!acc[r.route_id]) acc[r.route_id] = { route_id: r.route_id, route_name: r.route_name, route_code: r.route_code, items: [] };
    acc[r.route_id].items.push(r);
    return acc;
  }, {});

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Reportes GPS de rutas</h1>
          <p className="text-gray-400 text-sm mt-1">Todos los reportes <span className="text-orange-400 font-medium">ruta_real</span> de usuarios sin filtro de umbral</p>
        </div>
        <button onClick={load} className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-2 rounded-lg transition-colors">
          Recargar
        </button>
      </div>

      {msg && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${msg.ok ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-800' : 'bg-red-900/40 text-red-300 border border-red-800'}`}>
          {msg.text}
          <button onClick={() => setMsg(null)} className="ml-3 opacity-60 hover:opacity-100">x</button>
        </div>
      )}

      {loading ? (
        <div className="text-gray-400 text-sm">Cargando...</div>
      ) : reports.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p>No hay reportes ruta_real todavia</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.values(grouped).map(group => (
            <div key={group.route_id} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
              {/* Route header */}
              <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-3">
                <span className="bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded">{group.route_code}</span>
                <span className="text-white font-medium text-sm">{group.route_name}</span>
                <span className="ml-auto text-xs text-gray-400">{group.items.length} reporte{group.items.length !== 1 ? 's' : ''}</span>
              </div>

              {/* Individual reports */}
              <div className="divide-y divide-gray-700">
                {group.items.map(report => (
                  <div key={report.id} className="p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />
                      <span className="text-gray-300 text-sm font-medium">{report.user_name}</span>
                      <span className="text-gray-500 text-xs">{timeAgo(report.created_at)}</span>
                      {report.reported_geometry && report.reported_geometry.length >= 2 ? (
                        <span className="text-xs text-orange-400 bg-orange-900/30 px-2 py-0.5 rounded border border-orange-800/50">
                          {report.reported_geometry.length} pts GPS
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded">
                          Solo punto inicial
                        </span>
                      )}
                      <div className="ml-auto flex gap-2">
                        <button
                          onClick={() => setExpandedId(expandedId === report.id ? null : report.id)}
                          className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          {expandedId === report.id ? 'Ocultar' : 'Ver mapa'}
                        </button>
                        <button
                          onClick={() => applyGeometry(report)}
                          disabled={applying === report.id || !report.reported_geometry || report.reported_geometry.length < 2}
                          className="text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
                        >
                          {applying === report.id ? 'Aplicando...' : 'Aplicar como ruta'}
                        </button>
                        <button
                          onClick={() => deleteReport(report)}
                          disabled={deleting === report.id}
                          className="text-xs bg-red-900/40 hover:bg-red-800/60 disabled:opacity-40 text-red-300 px-3 py-1.5 rounded-lg transition-colors border border-red-800/40"
                        >
                          {deleting === report.id ? '...' : 'Eliminar'}
                        </button>
                      </div>
                    </div>

                    {expandedId === report.id && (
                      <div className="mt-3">
                        <MiniMap
                          routeGeometry={report.route_geometry}
                          reportedGeometry={report.reported_geometry}
                        />
                        <div className="mt-2 text-xs text-gray-500 flex gap-4">
                          <span><span className="text-blue-400">---</span> Ruta actual en DB</span>
                          <span><span className="text-orange-400">---</span> GPS reportado</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
