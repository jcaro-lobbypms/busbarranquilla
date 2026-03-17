# Spec 42 — Push notifications completas desde backend

## Objetivo

Completar el sistema de push notifications para que funcionen con la app **cerrada o en background**.
La infraestructura ya existe: Firebase Admin SDK, `sendPushToUser/sendPushToUsers`, FCM tokens, `firebase_messaging` en Flutter y `flutter_local_notifications`. Solo falta conectar esa infraestructura a los eventos correctos del backend y reforzar el chequeo de preferencias.

## Lo que ya funciona (NO tocar)

| Evento | Archivo | Estado |
|--------|---------|--------|
| Viaje finalizado → push al usuario | `tripController.ts` endTrip | ✅ funciona |
| Nuevo reporte en ruta → push a pasajeros activos | `reportController.ts` createReport | ✅ funciona |
| Trancón resuelto → push a pasajeros activos | `reportController.ts` resolveReport | ✅ funciona |
| Bus cercano en modo espera | Flutter (ya implementado) | ✅ funciona |

## Lo que falta

| Evento | Acción |
|--------|--------|
| Alerta de bajada 400 m / 200 m | Nueva lógica en `updateLocation` |
| Reporte confirmado → notificar al reportante | Nueva push en `confirmReport` |
| Preferencias de notificaciones no se respetan | Agregar chequeo en todos los push existentes |

---

## Paso 1 — Migración: dos columnas nuevas en `active_trips`

**Archivo:** `backend/src/config/schema.ts`

Agregar estas dos líneas al bloque de migraciones de `active_trips`, justo después de la migración de `gps_trace`:

```typescript
// EXISTING (do not modify):
await pool.query(`ALTER TABLE active_trips ADD COLUMN IF NOT EXISTS gps_trace JSONB DEFAULT '[]'`);

// ADD THESE TWO LINES immediately after:
await pool.query(`ALTER TABLE active_trips ADD COLUMN IF NOT EXISTS boarding_alert_prepare_sent BOOLEAN DEFAULT FALSE`);
await pool.query(`ALTER TABLE active_trips ADD COLUMN IF NOT EXISTS boarding_alert_now_sent BOOLEAN DEFAULT FALSE`);
```

---

## Paso 2 — Alerta de bajada en `updateLocation`

**Archivo:** `backend/src/controllers/tripController.ts`
**Función:** `updateLocation`

### Dónde insertar

Después de la línea `res.json({ credits_pending: updated.rows[0].credits_earned });` y **dentro del bloque try** (antes del catch), agregar el bloque de boarding alert.

### Código a agregar

Reemplazar:

```typescript
    res.json({
      credits_pending: updated.rows[0].credits_earned,
    });

  } catch (error) {
    console.error('Error actualizando ubicación:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
```

Con:

```typescript
    res.json({
      credits_pending: updated.rows[0].credits_earned,
    });

    // Boarding alerts — solo si hay destino y aún no se enviaron ambas alertas
    const updatedTrip = updated.rows[0];
    if (updatedTrip.destination_stop_id && !updatedTrip.boarding_alert_now_sent) {
      const stopRes = await pool.query(
        'SELECT latitude, longitude FROM stops WHERE id = $1',
        [updatedTrip.destination_stop_id],
      );
      if (stopRes.rows.length > 0) {
        const stop = stopRes.rows[0];
        const distToStop = haversineMeters(
          parseFloat(latitude),
          parseFloat(longitude),
          parseFloat(stop.latitude),
          parseFloat(stop.longitude),
        );

        if (distToStop <= 200) {
          // Alerta: Bájate ya
          await pool.query(
            'UPDATE active_trips SET boarding_alert_now_sent = true WHERE id = $1',
            [updatedTrip.id],
          );
          const userRow = await pool.query(
            'SELECT fcm_token, notification_prefs FROM users WHERE id = $1',
            [userId],
          );
          const { fcm_token, notification_prefs } = userRow.rows[0] ?? {};
          const prefs: Record<string, unknown> = notification_prefs ?? {};
          if (prefs.boardingAlerts !== false) {
            void sendPushToUser(
              fcm_token as string | null,
              '🚨 Bájate ya',
              'Tu parada está a menos de 200 metros',
              { type: 'boarding_alert', level: 'now' },
            );
          }
        } else if (distToStop <= 400 && !updatedTrip.boarding_alert_prepare_sent) {
          // Alerta: Prepárate para bajar
          await pool.query(
            'UPDATE active_trips SET boarding_alert_prepare_sent = true WHERE id = $1',
            [updatedTrip.id],
          );
          const userRow = await pool.query(
            'SELECT fcm_token, notification_prefs FROM users WHERE id = $1',
            [userId],
          );
          const { fcm_token, notification_prefs } = userRow.rows[0] ?? {};
          const prefs: Record<string, unknown> = notification_prefs ?? {};
          if (prefs.boardingAlerts !== false) {
            void sendPushToUser(
              fcm_token as string | null,
              '⏱ Prepárate para bajar',
              'Tu parada está a menos de 400 metros',
              { type: 'boarding_alert', level: 'prepare' },
            );
          }
        }
      }
    }

  } catch (error) {
    console.error('Error actualizando ubicación:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
```

### Por qué es seguro

- La respuesta `res.json(...)` ya se envió antes — el boarding alert corre de forma asíncrona sin bloquear al cliente
- Los flags `boarding_alert_prepare_sent` / `boarding_alert_now_sent` evitan envíos duplicados
- Si `destination_stop_id` es null, el bloque completo se salta
- Si `boarding_alert_now_sent` ya es true, el bloque completo se salta
- Los dos `pool.query` adicionales (stops + users) solo corren cuando faltan alertas — en la mayoría de las actualizaciones se omiten por la guarda inicial

---

## Paso 3 — Enforcement de `notification_prefs` en `createReport`

**Archivo:** `backend/src/controllers/reportController.ts`
**Función:** `createReport`

### Cambio: agregar `notification_prefs` al SELECT y filtrar antes de enviar

Buscar este bloque (alrededor de línea 278):

```typescript
    const othersRes = await pool.query(
      `SELECT u.fcm_token FROM active_trips t
       JOIN users u ON u.id = t.user_id
       WHERE t.route_id = $1 AND t.is_active = true
         AND t.user_id != $2 AND u.fcm_token IS NOT NULL`,
      [route_id, userId],
    );
    const tokens = othersRes.rows.map((r: { fcm_token: string }) => r.fcm_token);
```

Reemplazar con:

```typescript
    const othersRes = await pool.query(
      `SELECT u.fcm_token, u.notification_prefs FROM active_trips t
       JOIN users u ON u.id = t.user_id
       WHERE t.route_id = $1 AND t.is_active = true
         AND t.user_id != $2 AND u.fcm_token IS NOT NULL`,
      [route_id, userId],
    );
    const tokens = othersRes.rows
      .filter((r: { fcm_token: string; notification_prefs: Record<string, unknown> | null }) => {
        const prefs: Record<string, unknown> = r.notification_prefs ?? {};
        return prefs.routeReports !== false;
      })
      .map((r: { fcm_token: string }) => r.fcm_token);
```

---

## Paso 4 — Enforcement de `notification_prefs` en `resolveReport`

**Archivo:** `backend/src/controllers/reportController.ts`
**Función:** `resolveReport`

### Cambio: agregar `notification_prefs` al SELECT y filtrar

Buscar este bloque (alrededor de línea 399):

```typescript
  if (report.type === 'trancon') {
    const passengersRes = await pool.query(
      `SELECT u.fcm_token FROM active_trips t
       JOIN users u ON u.id = t.user_id
       WHERE t.route_id = $1 AND t.is_active = true AND u.fcm_token IS NOT NULL`,
      [report.route_id],
    );
    const tokens = passengersRes.rows.map((r: { fcm_token: string }) => r.fcm_token);
```

Reemplazar con:

```typescript
  if (report.type === 'trancon') {
    const passengersRes = await pool.query(
      `SELECT u.fcm_token, u.notification_prefs FROM active_trips t
       JOIN users u ON u.id = t.user_id
       WHERE t.route_id = $1 AND t.is_active = true AND u.fcm_token IS NOT NULL`,
      [report.route_id],
    );
    const tokens = passengersRes.rows
      .filter((r: { fcm_token: string; notification_prefs: Record<string, unknown> | null }) => {
        const prefs: Record<string, unknown> = r.notification_prefs ?? {};
        return prefs.routeReports !== false;
      })
      .map((r: { fcm_token: string }) => r.fcm_token);
```

---

## Paso 5 — Push cuando confirman un reporte

**Archivo:** `backend/src/controllers/reportController.ts`
**Función:** `confirmReport`

### Dónde insertar

Al final de `confirmReport`, después de que se actualiza el contador de confirmaciones y se emite el socket, agregar una push al reportante original.

Buscar el bloque donde se hace el emit de socket en `confirmReport` (buscar `route:report_confirmed`). Justo después de ese emit, agregar:

```typescript
    // Notificar al reportante original
    const reporterRes = await pool.query(
      `SELECT u.fcm_token, u.notification_prefs
       FROM reports r
       JOIN users u ON u.id = r.user_id
       WHERE r.id = $1`,
      [reportId],
    );
    if (reporterRes.rows.length > 0) {
      const reporter = reporterRes.rows[0];
      const prefs: Record<string, unknown> = reporter.notification_prefs ?? {};
      if (prefs.routeReports !== false) {
        void sendPushToUser(
          reporter.fcm_token as string | null,
          '👍 Tu reporte fue confirmado',
          'Otro pasajero confirmó tu reporte en la ruta',
          { type: 'report_confirmed', reportId: String(reportId) },
        );
      }
    }
```

> **Nota**: `sendPushToUser` ya está importado en `reportController.ts` desde `'../services/pushNotificationService'`. Verificar que el import exista; si no, agregarlo.

---

## Paso 6 — Enforcement de `notification_prefs` en `endTrip`

**Archivo:** `backend/src/controllers/tripController.ts`
**Función:** `endTrip`

Buscar (alrededor de línea 334):

```typescript
    if (totalEarned > 0) {
      const userTokenRes = await pool.query(
        'SELECT fcm_token FROM users WHERE id = $1',
        [userId],
      );
      const fcmToken: string | null = userTokenRes.rows[0]?.fcm_token ?? null;
```

Reemplazar con:

```typescript
    if (totalEarned > 0) {
      const userTokenRes = await pool.query(
        'SELECT fcm_token, notification_prefs FROM users WHERE id = $1',
        [userId],
      );
      const fcmToken: string | null = userTokenRes.rows[0]?.fcm_token ?? null;
      const endPrefs: Record<string, unknown> = userTokenRes.rows[0]?.notification_prefs ?? {};
```

Y envolver el `sendPushToUser` con el chequeo de preferencias. Buscar el `void sendPushToUser(` dentro de ese bloque y envolver:

```typescript
      // ANTES:
      void sendPushToUser(
        fcmToken,
        '🎉 Viaje finalizado',
        ...
      );

      // DESPUÉS:
      if (endPrefs.boardingAlerts !== false) {
        void sendPushToUser(
          fcmToken,
          '🎉 Viaje finalizado',
          ...
        );
      }
```

> Nota: se usa `boardingAlerts` para la notificación de fin de viaje ya que es la preferencia más cercana al ciclo del viaje. Si el usuario desactivó todas las alertas de viaje, tampoco recibirá este push.

---

## Paso 7 — Importar `sendPushToUser` en `reportController.ts` si falta

Verificar que al inicio de `reportController.ts` exista:

```typescript
import { sendPushToUser, sendPushToUsers, REPORT_LABELS } from '../services/pushNotificationService';
```

Si solo importa `sendPushToUsers` y `REPORT_LABELS`, agregar `sendPushToUser` a la lista.

---

## Paso 8 — Verificación final

```bash
cd /Users/jesuscaro/Documents/Trabajo/busbarranquilla/backend
npx tsc --noEmit
```

Debe retornar 0 errores. No correr `flutter analyze` — este spec es solo backend.

---

## Resumen de cambios

| Archivo | Cambio |
|---------|--------|
| `schema.ts` | +2 columnas en active_trips |
| `tripController.ts` updateLocation | +boarding alert logic (post-res.json) |
| `tripController.ts` endTrip | +notification_prefs check en push existente |
| `reportController.ts` createReport | +notification_prefs filter en tokens |
| `reportController.ts` resolveReport | +notification_prefs filter en tokens |
| `reportController.ts` confirmReport | +push al reportante original |
| `reportController.ts` imports | +sendPushToUser si no existe |

**Nada de Flutter cambia.** El sistema Flutter ya maneja las notificaciones FCM entrantes correctamente — `firebase_messaging` y `flutter_local_notifications` ya están configurados en spec 34.
