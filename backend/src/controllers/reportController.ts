import { Request, Response } from 'express';
import pool from '../config/database';
import { awardCredits } from './creditController';

const VALID_TYPES = [
  'bus_location', 'traffic', 'bus_full', 'no_service', 'detour',
  'desvio', 'trancon', 'casi_lleno', 'lleno', 'sin_parar', 'espera',
  'bus_disponible',
] as const;

// bus_disponible = 0 créditos (toggle sin incentivo económico)
const CREDITS_BY_TYPE: Record<string, number> = {
  bus_location: 5,
  traffic: 4,
  bus_full: 3,
  no_service: 4,
  detour: 4,
  desvio: 4,
  trancon: 4,
  casi_lleno: 3,
  lleno: 3,
  sin_parar: 4,
  espera: 3,
  bus_disponible: 0,
};

const OCCUPANCY_TYPES: string[] = ['lleno', 'casi_lleno', 'bus_disponible'];
// Distancia máxima a parada más cercana para reportes válidos
const GEO_MAX_METERS: Record<string, number> = {
  lleno: 300,
  casi_lleno: 300,
  bus_disponible: 300,
  default: 500,
};
const OCCUPANCY_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutos

// ── Helpers ───────────────────────────────────────────────────────────────────

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Retorna la distancia mínima (metros) del punto a cualquier parada de la ruta
async function minDistanceToRoute(routeId: number, lat: number, lng: number): Promise<number> {
  const result = await pool.query(
    'SELECT latitude, longitude FROM stops WHERE route_id = $1',
    [routeId]
  );
  if (result.rows.length === 0) return 0; // sin paradas → no validar
  let min = Infinity;
  for (const stop of result.rows) {
    const d = haversineMeters(lat, lng, parseFloat(stop.latitude), parseFloat(stop.longitude));
    if (d < min) min = d;
  }
  return min;
}

// ── Estado de ocupación de una ruta ──────────────────────────────────────────
// Lógica A+D: mayoría gana; para revertir de lleno→disponible se necesitan 2+
// con threshold dinámico según usuarios activos en la ruta.

async function computeOccupancy(routeId: number): Promise<{
  state: 'lleno' | 'casi_lleno' | 'disponible' | null;
  counts: Record<string, number>;
  activeUsers: number;
}> {
  // Usuarios activos en esta ruta ahora mismo
  const activeRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM active_trips
     WHERE route_id = $1 AND is_active = true`,
    [routeId]
  );
  const activeUsers = parseInt(activeRes.rows[0].cnt, 10);

  // Reportes de ocupación activos en últimos 30 min
  const repRes = await pool.query(
    `SELECT type, COUNT(*) AS cnt FROM reports
     WHERE route_id = $1
       AND type = ANY($2::text[])
       AND is_active = true
       AND created_at > NOW() - INTERVAL '30 minutes'
     GROUP BY type`,
    [routeId, OCCUPANCY_TYPES]
  );

  const counts: Record<string, number> = { lleno: 0, casi_lleno: 0, bus_disponible: 0 };
  for (const row of repRes.rows) counts[row.type] = parseInt(row.cnt, 10);

  // Threshold dinámico: 1 usuario activo → basta 1 reporte; 2+ → se necesitan 2
  const threshold = activeUsers <= 1 ? 1 : 2;

  // Para revertir (disponible) se requiere threshold estricto
  if (counts.bus_disponible >= threshold) return { state: 'disponible', counts, activeUsers };
  if (counts.lleno >= threshold) return { state: 'lleno', counts, activeUsers };
  if (counts.casi_lleno >= threshold) return { state: 'casi_lleno', counts, activeUsers };
  return { state: null, counts, activeUsers };
}

// ── Crear reporte (protegido) ─────────────────────────────────────────────────
export const createReport = async (req: Request, res: Response): Promise<void> => {
  const { route_id, type, latitude, longitude, description } = req.body;
  const userId = (req as any).userId;

  if (!type || latitude === undefined || longitude === undefined) {
    res.status(400).json({ message: 'type, latitude y longitude son obligatorios' });
    return;
  }

  if (!VALID_TYPES.includes(type)) {
    res.status(400).json({ message: 'Tipo de reporte inválido' });
    return;
  }

  try {
    // ── Validación geográfica para reportes con ruta ──────────────────────
    if (route_id) {
      const maxMeters = GEO_MAX_METERS[type] ?? GEO_MAX_METERS.default;
      const dist = await minDistanceToRoute(route_id, parseFloat(latitude), parseFloat(longitude));
      if (dist > maxMeters) {
        res.status(400).json({
          message: `Debes estar cerca del bus para reportar esto (${Math.round(dist)} m de la ruta más cercana, máximo ${maxMeters} m)`,
          distance_meters: Math.round(dist),
        });
        return;
      }
    }

    // ── Cooldown de 10 min para reportes de ocupación ────────────────────
    if (OCCUPANCY_TYPES.includes(type)) {
      const lastRes = await pool.query(
        `SELECT created_at FROM reports
         WHERE user_id = $1 AND route_id = $2
           AND type = ANY($3::text[])
           AND created_at > NOW() - INTERVAL '10 minutes'
         ORDER BY created_at DESC LIMIT 1`,
        [userId, route_id || null, OCCUPANCY_TYPES]
      );
      if (lastRes.rows.length > 0) {
        const lastAt = new Date(lastRes.rows[0].created_at).getTime();
        const remaining = Math.ceil((OCCUPANCY_COOLDOWN_MS - (Date.now() - lastAt)) / 60000);
        res.status(429).json({
          message: `Ya reportaste la ocupación de este bus. Espera ${remaining} min antes de reportar de nuevo.`,
          retry_in_minutes: remaining,
        });
        return;
      }
    }

    const result = await pool.query(
      `INSERT INTO reports (user_id, route_id, type, latitude, longitude, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, route_id || null, type, latitude, longitude, description || null]
    );

    const report = result.rows[0];
    const creditsEarned = CREDITS_BY_TYPE[type] ?? 0;

    if (creditsEarned > 0) {
      await awardCredits(userId, creditsEarned, 'earn', `Reporte: ${type}`);
    }

    res.status(201).json({
      message: 'Reporte creado exitosamente',
      report,
      credits_earned: creditsEarned,
    });

  } catch (error) {
    console.error('Error creando reporte:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Estado de ocupación de una ruta (público)
export const getOccupancy = async (req: Request, res: Response): Promise<void> => {
  const routeId = parseInt(req.params.routeId as string, 10);
  if (isNaN(routeId)) {
    res.status(400).json({ message: 'routeId inválido' });
    return;
  }
  try {
    const occupancy = await computeOccupancy(routeId);
    res.json(occupancy);
  } catch (error) {
    console.error('Error calculando ocupación:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Listar reportes cercanos (protegido)
export const listNearbyReports = async (req: Request, res: Response): Promise<void> => {
  const { lat, lng, radius } = req.query;

  if (!lat || !lng) {
    res.status(400).json({ message: 'lat y lng son obligatorios' });
    return;
  }

  const radiusKm = parseFloat(radius as string) || 1;

  try {
    const result = await pool.query(
      `SELECT * FROM (
        SELECT *,
          (6371 * acos(
            cos(radians($1)) * cos(radians(latitude)) *
            cos(radians(longitude) - radians($2)) +
            sin(radians($1)) * sin(radians(latitude))
          )) AS distance
        FROM reports
        WHERE is_active = true AND expires_at > NOW()
      ) t
      WHERE t.distance < $3
      ORDER BY t.distance ASC`,
      [parseFloat(lat as string), parseFloat(lng as string), radiusKm]
    );

    res.json({ reports: result.rows });

  } catch (error) {
    console.error('Error listando reportes cercanos:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Resolver reporte propio (protegido)
export const resolveReport = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = (req as any).userId as number;

  try {
    const result = await pool.query(
      `UPDATE reports
       SET is_active = false, resolved_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Reporte no encontrado o no tienes permiso para resolverlo' });
      return;
    }

    res.json({ message: 'Reporte resuelto correctamente' });

  } catch (error) {
    console.error('Error resolviendo reporte:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Confirmar reporte de otro usuario (protegido)
export const confirmReport = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = (req as any).userId;

  try {
    const result = await pool.query(
      'SELECT * FROM reports WHERE id = $1 AND is_active = true AND expires_at > NOW()',
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Reporte no encontrado o expirado' });
      return;
    }

    const report = result.rows[0];

    if (report.user_id === userId) {
      res.status(400).json({ message: 'No puedes confirmar tu propio reporte' });
      return;
    }

    const updated = await pool.query(
      'UPDATE reports SET confirmations = confirmations + 1 WHERE id = $1 RETURNING confirmations',
      [id]
    );

    await awardCredits(report.user_id, 2, 'earn', 'Confirmación de reporte');

    res.json({
      message: 'Reporte confirmado',
      confirmations: updated.rows[0].confirmations
    });

  } catch (error) {
    console.error('Error confirmando reporte:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};
