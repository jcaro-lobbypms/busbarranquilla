import { Request, Response } from 'express';
import pool from '../config/database';

const RUTA_REAL_THRESHOLD = 3; // reportes para activar alerta

// POST /api/routes/:id/update-report
// Usuario reporta que el bus tomó un camino diferente
export const reportRouteUpdate = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { tipo, geometry } = req.body; // 'trancon' | 'ruta_real', geometry?: [lat,lng][]
  const userId = (req as any).userId;

  if (!['trancon', 'ruta_real'].includes(tipo)) {
    res.status(400).json({ message: 'tipo debe ser trancon o ruta_real' });
    return;
  }

  try {
    const geomValue = geometry && Array.isArray(geometry) && geometry.length >= 2
      ? JSON.stringify(geometry)
      : null;

    // Upsert: si el usuario ya reportó esta ruta, actualiza el tipo, timestamp y geometría
    await pool.query(
      `INSERT INTO route_update_reports (route_id, user_id, tipo, reported_geometry)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (route_id, user_id)
       DO UPDATE SET tipo = $3, created_at = NOW(), reported_geometry = COALESCE($4, route_update_reports.reported_geometry)`,
      [id, userId, tipo, geomValue]
    );

    // Verificar si se alcanzó el umbral de ruta_real
    const countResult = await pool.query(
      `SELECT COUNT(*) AS total
       FROM route_update_reports
       WHERE route_id = $1
         AND tipo = 'ruta_real'
         AND created_at > NOW() - INTERVAL '30 days'`,
      [id]
    );
    const total = parseInt(countResult.rows[0].total, 10);

    res.json({ ok: true, ruta_real_count: total, threshold_reached: total >= RUTA_REAL_THRESHOLD });
  } catch (error) {
    console.error('Error en reportRouteUpdate:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// GET /api/routes/update-alerts  (solo admin)
// Rutas que superaron el umbral de reportes "ruta_real" en los últimos 30 días
export const getRouteUpdateAlerts = async (_req: Request, res: Response): Promise<void> => {
  try {
    const alertsResult = await pool.query(
      `SELECT
         r.id,
         r.name,
         r.code,
         r.geometry,
         r.route_alert_reviewed_at,
         COUNT(rur.id) FILTER (WHERE rur.tipo = 'ruta_real') AS ruta_real_count,
         COUNT(rur.id) FILTER (WHERE rur.tipo = 'trancon')   AS trancon_count,
         MAX(rur.created_at) AS last_report_at
       FROM routes r
       JOIN route_update_reports rur
         ON rur.route_id = r.id
        AND rur.created_at > NOW() - INTERVAL '30 days'
       GROUP BY r.id
       HAVING COUNT(rur.id) FILTER (WHERE rur.tipo = 'ruta_real') >= $1
          AND (
            r.route_alert_reviewed_at IS NULL
            OR MAX(rur.created_at) > r.route_alert_reviewed_at
          )
       ORDER BY ruta_real_count DESC, last_report_at DESC`,
      [RUTA_REAL_THRESHOLD]
    );

    // Para cada alerta, obtener reportantes y sus últimas posiciones GPS
    const alerts = await Promise.all(
      alertsResult.rows.map(async (row) => {
        // Reportantes con nombre, tipo y geometría reportada
        const reportersResult = await pool.query(
          `SELECT u.name AS user_name, rur.tipo, rur.created_at, rur.reported_geometry
           FROM route_update_reports rur
           JOIN users u ON u.id = rur.user_id
           WHERE rur.route_id = $1
             AND rur.created_at > NOW() - INTERVAL '30 days'
           ORDER BY rur.created_at DESC`,
          [row.id]
        );

        // Últimas posiciones GPS de usuarios que reportaron "ruta_real" (viajes activos o recientes)
        const gpsResult = await pool.query(
          `SELECT at.current_latitude AS lat, at.current_longitude AS lng, at.last_location_at
           FROM active_trips at
           WHERE at.route_id = $1
             AND at.last_location_at > NOW() - INTERVAL '7 days'
             AND at.user_id IN (
               SELECT user_id FROM route_update_reports
               WHERE route_id = $1
                 AND tipo = 'ruta_real'
                 AND created_at > NOW() - INTERVAL '30 days'
             )
           ORDER BY at.last_location_at DESC
           LIMIT 20`,
          [row.id]
        );

        return {
          ...row,
          reporters: reportersResult.rows,
          reporter_positions: gpsResult.rows.map((p: { lat: string; lng: string }) => [
            parseFloat(p.lat),
            parseFloat(p.lng),
          ]),
          // Geometrías GPS reportadas (solo ruta_real con geometría guardada)
          reported_geometries: reportersResult.rows
            .filter((r: { tipo: string; reported_geometry: unknown }) =>
              r.tipo === 'ruta_real' && r.reported_geometry
            )
            .map((r: { user_name: string; reported_geometry: [number, number][] }) => ({
              user_name: r.user_name,
              geometry: r.reported_geometry,
            })),
        };
      })
    );

    res.json({ alerts });
  } catch (error) {
    console.error('Error en getRouteUpdateAlerts:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// GET /api/routes/update-alerts/count  (solo admin)
// Número de alertas pendientes para el badge del sidebar
export const getRouteUpdateAlertsCount = async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT COUNT(DISTINCT r.id) AS total
       FROM routes r
       JOIN route_update_reports rur
         ON rur.route_id = r.id
        AND rur.created_at > NOW() - INTERVAL '30 days'
        AND rur.tipo = 'ruta_real'
       WHERE (
         r.route_alert_reviewed_at IS NULL
         OR rur.created_at > r.route_alert_reviewed_at
       )
       GROUP BY r.id
       HAVING COUNT(rur.id) >= $1`,
      [RUTA_REAL_THRESHOLD]
    );

    res.json({ count: result.rowCount ?? 0 });
  } catch (error) {
    console.error('Error en getRouteUpdateAlertsCount:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// PATCH /api/routes/:id/apply-reported-geometry  (solo admin)
// Reemplaza la geometría de la ruta con el track GPS reportado por un usuario
// Marca manually_edited_at = NOW() para que los imports no la pisen
export const applyReportedGeometry = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { geometry } = req.body; // [lat, lng][]

  if (!Array.isArray(geometry) || geometry.length < 2) {
    res.status(400).json({ message: 'geometry debe ser un array de al menos 2 puntos' });
    return;
  }

  try {
    await pool.query(
      `UPDATE routes
       SET geometry = $1, manually_edited_at = NOW(), route_alert_reviewed_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(geometry), id]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Error en applyReportedGeometry:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// PATCH /api/routes/:id/dismiss-alert  (solo admin)
// Marca la alerta como revisada — desaparece hasta que lleguen nuevos reportes
export const dismissRouteAlert = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    await pool.query(
      `UPDATE routes SET route_alert_reviewed_at = NOW() WHERE id = $1`,
      [id]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Error en dismissRouteAlert:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};
