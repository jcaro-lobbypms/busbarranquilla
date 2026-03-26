import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { routesApi } from '../../services/api';

// ─── Geometry helpers ────────────────────────────────────────────────────────

function perpDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const [y0, x0] = p, [y1, x1] = a, [y2, x2] = b;
  const dy = y2 - y1, dx = x2 - x1;
  if (dy === 0 && dx === 0) return Math.hypot(y0 - y1, x0 - x1);
  const t = ((y0 - y1) * dy + (x0 - x1) * dx) / (dy * dy + dx * dx);
  return Math.hypot(y0 - y1 - t * dy, x0 - x1 - t * dx);
}

function rdp(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length <= 2) return pts;
  let maxD = 0, maxI = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; maxI = i; }
  }
  if (maxD > eps) {
    const left = rdp(pts.slice(0, maxI + 1), eps);
    const right = rdp(pts.slice(maxI), eps);
    return [...left.slice(0, -1), ...right];
  }
  return [pts[0], pts[pts.length - 1]];
}

/** Simplifies dense GPS traces to a manageable number of editable control points. */
function simplify(pts: [number, number][]): [number, number][] {
  if (pts.length <= 200) return pts;
  const eps = pts.length > 600 ? 0.0002 : pts.length > 300 ? 0.0001 : 0.00006;
  const result = rdp(pts, eps);
  // Fallback: if RDP over-simplified, sample evenly
  if (result.length < 40 && pts.length > 80) {
    const step = Math.max(1, Math.floor(pts.length / 120));
    const sampled: [number, number][] = [];
    for (let i = 0; i < pts.length; i += step) sampled.push(pts[i]);
    if (sampled[sampled.length - 1] !== pts[pts.length - 1]) sampled.push(pts[pts.length - 1]);
    return sampled;
  }
  return result;
}

/** Finds the index where inserting a new point minimises total path detour. */
function bestInsertIdx(geom: [number, number][], pt: [number, number]): number {
  if (geom.length === 0) return 0;
  if (geom.length === 1) return 1;
  const R = 6371000;
  const haverM = (a: [number, number], b: [number, number]) => {
    const dLat = (b[0] - a[0]) * Math.PI / 180, dLng = (b[1] - a[1]) * Math.PI / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  };
  let bestCost = Infinity, bestIdx = geom.length;
  for (let i = 0; i < geom.length - 1; i++) {
    const cost = haverM(geom[i], pt) + haverM(pt, geom[i + 1]) - haverM(geom[i], geom[i + 1]);
    if (cost < bestCost) { bestCost = cost; bestIdx = i + 1; }
  }
  return bestIdx;
}

// ─── Icons ───────────────────────────────────────────────────────────────────

const VERTEX_ICON = L.divIcon({
  className: '',
  html: `<div style="width:14px;height:14px;border-radius:50%;background:#fff;border:2.5px solid #2563eb;box-shadow:0 1px 4px rgba(0,0,0,.35);cursor:grab;box-sizing:border-box"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

// ─── Component ───────────────────────────────────────────────────────────────

interface RouteInfo {
  code: string;
  name: string;
  company: string | null;
}

export default function RouteGeometryEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [undoCount, setUndoCount] = useState(0);

  // Map DOM
  const mapContainerRef = useRef<HTMLDivElement>(null);

  // Leaflet refs
  const mapRef = useRef<L.Map | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  const vertexMarkersRef = useRef<L.Marker[]>([]);
  const midpointMarkersRef = useRef<L.CircleMarker[]>([]);

  // Geometry lives in a mutable ref — no React state during editing to avoid re-render lag
  const ptsRef = useRef<[number, number][]>([]);
  const historyRef = useRef<[number, number][][]>([]);

  // ── Load route ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return;
    routesApi.getById(Number(id))
      .then(res => {
        const r = res.data.route as {
          code: string; name: string; company: string | null;
          geometry: [number, number][] | null;
        };
        setRouteInfo({ code: r.code, name: r.name, company: r.company });
        ptsRef.current = simplify(r.geometry ?? []);
      })
      .catch(() => { /* empty geometry, user draws from scratch */ })
      .finally(() => setLoading(false));
  }, [id]);

  // ── Map init (runs once after loading finishes) ─────────────────────────────

  useEffect(() => {
    if (loading || !mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, { center: [10.9685, -74.7813], zoom: 13 });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    // Initial polyline (empty or loaded)
    const pl = L.polyline(
      ptsRef.current.map(([lat, lng]) => [lat, lng] as L.LatLngTuple),
      { color: '#2563eb', weight: 5, opacity: 0.85 },
    ).addTo(map);
    polylineRef.current = pl;

    if (ptsRef.current.length >= 2) {
      map.fitBounds(pl.getBounds(), { padding: [48, 48] });
    }

    // Map click: insert point at best-fit segment position
    map.on('click', (e: L.LeafletMouseEvent) => {
      const newPt: [number, number] = [e.latlng.lat, e.latlng.lng];
      pushHistory();
      const idx = bestInsertIdx(ptsRef.current, newPt);
      ptsRef.current.splice(idx, 0, newPt);
      setUndoCount(historyRef.current.length);
      redrawMarkers(map);
    });

    mapRef.current = map;
    redrawMarkers(map);

    return () => {
      clearMarkers();
      pl.remove();
      polylineRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function pushHistory() {
    historyRef.current.push([...ptsRef.current]);
    if (historyRef.current.length > 40) historyRef.current.shift();
  }

  function clearMarkers() {
    vertexMarkersRef.current.forEach(m => m.remove());
    vertexMarkersRef.current = [];
    midpointMarkersRef.current.forEach(m => m.remove());
    midpointMarkersRef.current = [];
  }

  function redrawMarkers(map: L.Map) {
    clearMarkers();

    const pts = ptsRef.current;

    // Sync polyline
    polylineRef.current?.setLatLngs(pts.map(([lat, lng]) => [lat, lng] as L.LatLngTuple));

    // ── Vertex markers ────────────────────────────────────────────────────────
    pts.forEach((pt, i) => {
      const marker = L.marker([pt[0], pt[1]], {
        icon: VERTEX_ICON,
        draggable: true,
        zIndexOffset: 200,
        bubblingMouseEvents: false,
      });

      // Save state on drag start (before position changes)
      marker.on('dragstart', () => pushHistory());

      // Update geometry + polyline in real-time during drag
      marker.on('drag', () => {
        const { lat, lng } = marker.getLatLng();
        ptsRef.current[i] = [lat, lng];
        polylineRef.current?.setLatLngs(ptsRef.current.map(([la, ln]) => [la, ln] as L.LatLngTuple));
      });

      // Redraw midpoint handles after drag ends
      marker.on('dragend', () => {
        setUndoCount(historyRef.current.length);
        redrawMarkers(map);
      });

      // Double-click to delete vertex
      marker.on('dblclick', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        if (ptsRef.current.length <= 2) return;
        pushHistory();
        ptsRef.current.splice(i, 1);
        setUndoCount(historyRef.current.length);
        redrawMarkers(map);
      });

      marker.addTo(map);
      vertexMarkersRef.current.push(marker);
    });

    // ── Midpoint handles ──────────────────────────────────────────────────────
    for (let i = 0; i < pts.length - 1; i++) {
      const mid: [number, number] = [
        (pts[i][0] + pts[i + 1][0]) / 2,
        (pts[i][1] + pts[i + 1][1]) / 2,
      ];
      const capturedI = i;

      const handle = L.circleMarker([mid[0], mid[1]], {
        radius: 5,
        color: '#93C5FD',
        weight: 2,
        fillColor: 'white',
        fillOpacity: 0.9,
        bubblingMouseEvents: false,
      } as L.CircleMarkerOptions);

      handle.on('mouseover', () => handle.setStyle({ fillColor: '#2563eb', radius: 7 } as L.PathOptions));
      handle.on('mouseout', () => handle.setStyle({ fillColor: 'white', radius: 5 } as L.PathOptions));

      // Click: insert new vertex at midpoint position
      handle.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        pushHistory();
        ptsRef.current.splice(capturedI + 1, 0, mid);
        setUndoCount(historyRef.current.length);
        redrawMarkers(map);
      });

      handle.addTo(map);
      midpointMarkersRef.current.push(handle);
    }
  }

  // ── Undo ────────────────────────────────────────────────────────────────────

  function handleUndo() {
    const prev = historyRef.current.pop();
    if (!prev || !mapRef.current) return;
    ptsRef.current = prev;
    setUndoCount(historyRef.current.length);
    redrawMarkers(mapRef.current);
  }

  // Keyboard shortcut: Ctrl+Z / Cmd+Z
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save ────────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!id) return;
    setSaving(true);
    try {
      await routesApi.update(Number(id), { geometry: ptsRef.current });
      navigate(-1);
    } catch {
      alert('Error al guardar el trazado. Intenta de nuevo.');
      setSaving(false);
    }
  }

  // ── Loading screen ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="text-4xl mb-3">🗺️</div>
          <p className="text-gray-500 text-sm">Cargando trazado…</p>
        </div>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col" style={{ height: '100vh' }}>

      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-gray-200 shrink-0 shadow-sm z-10">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 font-medium transition-colors"
        >
          ← Volver
        </button>

        <div className="w-px h-5 bg-gray-200" />

        <span className="font-mono font-bold text-blue-700 text-sm">{routeInfo?.code}</span>

        {routeInfo?.name && (
          <span className="text-sm text-gray-600 truncate max-w-xs">{routeInfo.name}</span>
        )}

        {routeInfo?.company && (
          <span className="text-xs text-gray-400 hidden md:inline">{routeInfo.company}</span>
        )}

        <div className="flex-1" />

        <span className="text-xs text-gray-400 hidden sm:inline">
          {ptsRef.current.length} puntos
        </span>

        <button
          onClick={handleUndo}
          disabled={undoCount === 0}
          title="Ctrl+Z"
          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 disabled:text-gray-300 disabled:cursor-not-allowed font-medium transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100 disabled:hover:bg-transparent"
        >
          ↩ Deshacer{undoCount > 0 ? ` (${undoCount})` : ''}
        </button>

        <button
          onClick={handleSave}
          disabled={saving || ptsRef.current.length < 2}
          className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold px-4 py-1.5 rounded-lg transition-colors"
        >
          {saving ? 'Guardando…' : 'Guardar trazado'}
        </button>
      </div>

      {/* ── Map + hint overlay ── */}
      <div className="flex-1 relative">
        <div ref={mapContainerRef} className="absolute inset-0" />

        {/* Floating hint pill */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[900] pointer-events-none select-none">
          <div className="bg-gray-900/80 text-white text-xs px-4 py-2 rounded-full shadow-lg whitespace-nowrap flex items-center gap-2.5 backdrop-blur-sm">
            <span className="flex items-center gap-1">
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#fff', border: '2px solid #2563eb' }} />
              Arrastra para mover
            </span>
            <span className="text-gray-500">·</span>
            <span className="flex items-center gap-1">
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'white', border: '1.5px solid #93C5FD' }} />
              Clic para insertar
            </span>
            <span className="text-gray-500">·</span>
            <span>Doble clic para borrar</span>
          </div>
        </div>
      </div>

    </div>
  );
}
