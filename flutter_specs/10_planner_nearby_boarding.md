# Spec 10 — Planner: "Buses en tu zona" va directo al boarding

## Web equivalent

`PlanTripMode.tsx` — sección "Buses en tu zona":
- Tap en una tarjeta → **no va directo al boarding**, en la web previsualiza geometría
  en el mapa y muestra mini barra "¿Va a tu destino? Escríbelo arriba ↑"
- Pero el flujo final para el usuario móvil (sin mapa interactivo integrado en la misma
  pantalla) debería ir directo al boarding confirm

## Problema actual

`PlannerScreen.dart:196`:
```dart
onTap: () => context.push('/trip/confirm?routeId=${route.id}'),
```

Tap en ruta cercana va directo a boarding confirm sin pasar por destino. Esto está
correcto para el flujo móvil. PERO hay dos problemas UX:

1. **Las tarjetas no muestran distancia** — se ve solo nombre y empresa, no cuántos
   metros está la ruta
2. **No hay badge de actividad** — no se muestra si hay usuarios activos en la ruta

## Cambio requerido

Mejorar la UX de las tarjetas de "Buses en tu zona" en `PlannerScreen`:
- Mostrar la distancia de la ruta al usuario
- Mostrar `RouteActivityBadge` por cada ruta

---

## Step 1 — BusRoute model: verificar campo distance

**Archivo:** `lib/core/domain/models/bus_route.dart`

Verificar que el modelo tiene `distanceMeters` o similar. Si no existe, verificar
la respuesta de `/api/routes/nearby` en el backend — devuelve `distance_meters`.

Leer el archivo y si no tiene `distanceMeters`, agregar:
```dart
final int? distanceMeters;
```

En `fromJson`:
```dart
distanceMeters: asIntOrNull(json['distance_meters']),
```

En constructor:
```dart
this.distanceMeters,
```

---

## Step 2 — PlannerScreen: mejorar tarjetas de rutas cercanas

**Archivo:** `lib/features/planner/screens/planner_screen.dart`

Agregar import:
```dart
import '../../../shared/widgets/route_activity_badge.dart';
```

Reemplazar el `ListTile` actual de nearbyRoutes por una tarjeta más rica:

```dart
// ANTES:
...nearbyRoutes.map(
  (route) => ListTile(
    onTap: () => context.push('/trip/confirm?routeId=${route.id}'),
    leading: RouteCodeBadge(code: route.code),
    title: Text(route.name),
    subtitle: (route.companyName ?? route.company ?? '').isNotEmpty
        ? Text(route.companyName ?? route.company ?? '')
        : null,
    trailing: const Icon(Icons.chevron_right),
    contentPadding: EdgeInsets.zero,
  ),
),

// DESPUÉS:
...nearbyRoutes.map(
  (route) => InkWell(
    onTap: () => context.push('/trip/confirm?routeId=${route.id}'),
    borderRadius: BorderRadius.circular(10),
    child: Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        border: Border.all(color: Theme.of(context).dividerColor),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: <Widget>[
          RouteCodeBadge(code: route.code),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(route.name, style: Theme.of(context).textTheme.bodyMedium),
                if ((route.companyName ?? route.company ?? '').isNotEmpty)
                  Text(
                    route.companyName ?? route.company ?? '',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                const SizedBox(height: 4),
                RouteActivityBadge(routeId: route.id),
              ],
            ),
          ),
          if (route.distanceMeters != null) ...<Widget>[
            const SizedBox(width: 8),
            Text(
              '${route.distanceMeters} m',
              style: TextStyle(
                fontSize: 12,
                color: AppColors.forDistance(route.distanceMeters!),
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
          const SizedBox(width: 4),
          const Icon(Icons.chevron_right, size: 18),
        ],
      ),
    ),
  ),
),
```

Agregar import si no está:
```dart
import '../../../core/theme/app_colors.dart';
```

---

## Verification

```bash
~/development/flutter/bin/flutter analyze
```

Must return **0 issues**.

Commit: `feat: improve nearby routes cards in planner with activity and distance`
