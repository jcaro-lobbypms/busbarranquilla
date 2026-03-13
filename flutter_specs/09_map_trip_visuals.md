# Spec 09 — Mapa: Ícono de bus en viaje activo + buses activos en ruta seleccionada

## Web equivalent

`MapView.tsx`:
- `UserLocationTracker`: cuando `isOnTrip === true`, el marcador del usuario cambia a
  un ícono 🚌 verde pulsante (`USER_ON_BUS_ICON`)
- `routeActivityPositions`: cuando hay ruta seleccionada, dibuja marcadores amber 🚌
  (`ACTIVITY_BUS_ICON`) en las posiciones activas de esa ruta

## Problema actual

`MapScreen.dart`:
- `UserMarkerLayer` siempre muestra el mismo ícono de usuario, sin importar si está
  en un viaje activo
- No hay marcadores de posiciones de otros usuarios activos en la ruta seleccionada

---

## Step 1 — Strings

**Archivo:** `lib/core/l10n/strings.dart`

Agregar:
```dart
static const youAreOnBus = '🚌 Estás en el bus';
static const activeBusOnRoute = '🚌 Bus activo en ruta';
```

---

## Step 2 — UserMarkerLayer: cambiar ícono cuando hay viaje activo

**Archivo:** `lib/features/map/widgets/user_marker_layer.dart`

Leer el archivo primero. Luego agregar un parámetro `isOnTrip`:

```dart
class UserMarkerLayer extends StatelessWidget {
  final LatLng position;
  final bool isOnTrip;         // ← nuevo

  const UserMarkerLayer({
    required this.position,
    this.isOnTrip = false,     // ← nuevo
    super.key,
  });
```

En `build()`, cambiar el widget del marcador según `isOnTrip`:
```dart
// Si isOnTrip == true: mostrar ícono bus verde
// Si isOnTrip == false: mantener el ícono actual (punto azul / person)

child: isOnTrip
    ? Container(
        decoration: BoxDecoration(
          color: AppColors.success,
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 2),
          boxShadow: <BoxShadow>[
            BoxShadow(
              color: AppColors.success.withValues(alpha: 0.4),
              blurRadius: 8,
              spreadRadius: 2,
            ),
          ],
        ),
        child: const Icon(Icons.directions_bus, color: Colors.white, size: 18),
      )
    : /* widget actual sin cambios */,
```

### Step 2b — MapScreen: pasar isOnTrip a UserMarkerLayer

**Archivo:** `lib/features/map/screens/map_screen.dart`

Agregar import:
```dart
import '../../trip/providers/trip_notifier.dart';
import '../../trip/providers/trip_state.dart';
```

En `build()`, antes de construir el mapa:
```dart
final tripState = ref.watch(tripNotifierProvider);
final isOnTrip = tripState is TripActive;
```

Pasar al widget:
```dart
if (ready.userPosition != null)
  UserMarkerLayer(
    position: ready.userPosition!,
    isOnTrip: isOnTrip,
  ),
```

---

## Step 3 — ActiveRouteBusLayer: mostrar buses activos de la ruta seleccionada

**Archivo nuevo:** `lib/features/map/widgets/active_route_bus_layer.dart`

```dart
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/data/repositories/routes_repository.dart';
import '../../../core/domain/models/route_activity.dart';
import '../../../core/error/result.dart';
import '../../../core/theme/app_colors.dart';

class ActiveRouteBusLayer extends ConsumerStatefulWidget {
  final int routeId;

  const ActiveRouteBusLayer({required this.routeId, super.key});

  @override
  ConsumerState<ActiveRouteBusLayer> createState() => _ActiveRouteBusLayerState();
}

class _ActiveRouteBusLayerState extends ConsumerState<ActiveRouteBusLayer> {
  List<LatLng> _positions = const <LatLng>[];

  @override
  void initState() {
    super.initState();
    Future<void>(() => _load());
  }

  @override
  void didUpdateWidget(ActiveRouteBusLayer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.routeId != widget.routeId) {
      Future<void>(() => _load());
    }
  }

  Future<void> _load() async {
    final result = await ref.read(routesRepositoryProvider).getActivity(widget.routeId);
    if (!mounted) return;
    if (result is Success<RouteActivity>) {
      // Backend devuelve active_positions como [[lat,lng], ...]
      // RouteActivity solo tiene activeCount y lastActivityMinutes
      // Necesitamos extender RouteActivity para incluir positions, o
      // acceder directamente al JSON raw.
      // Por ahora, si activeCount > 0 pero no tenemos positions, no mostramos nada.
      // Ver nota abajo.
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_positions.isEmpty) return const SizedBox.shrink();

    return MarkerLayer(
      markers: _positions.map((pos) => Marker(
        point: pos,
        width: 34,
        height: 34,
        child: Container(
          decoration: BoxDecoration(
            color: Colors.amber.shade600,
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white, width: 2),
            boxShadow: <BoxShadow>[
              BoxShadow(
                color: Colors.amber.withValues(alpha: 0.4),
                blurRadius: 6,
                spreadRadius: 2,
              ),
            ],
          ),
          child: const Icon(Icons.directions_bus, color: Colors.white, size: 18),
        ),
      )).toList(growable: false),
    );
  }
}
```

### Nota sobre RouteActivity y active_positions

El backend devuelve `active_positions: [[lat, lng], ...]` en la respuesta de
`GET /api/routes/:id/activity`. El modelo `RouteActivity` actual solo parsea
`activeCount` y `lastActivityMinutes`.

**Actualizar `RouteActivity.fromJson` para incluir posiciones:**

**Archivo:** `lib/core/domain/models/route_activity.dart`

```dart
import 'package:latlong2/latlong.dart';
import 'model_parsers.dart';

class RouteActivity {
  final int activeCount;
  final int? lastActivityMinutes;
  final List<LatLng> activePositions;   // ← nuevo

  const RouteActivity({
    required this.activeCount,
    this.lastActivityMinutes,
    this.activePositions = const <LatLng>[],  // ← nuevo
  });

  factory RouteActivity.fromJson(Map<String, dynamic> json) {
    final rawPositions = json['active_positions'];
    final positions = <LatLng>[];
    if (rawPositions is List) {
      for (final p in rawPositions) {
        if (p is List && p.length >= 2) {
          final lat = asDoubleOrNull(p[0]);
          final lng = asDoubleOrNull(p[1]);
          if (lat != null && lng != null) {
            positions.add(LatLng(lat, lng));
          }
        }
      }
    }

    return RouteActivity(
      activeCount: asInt(json['active_count']),
      lastActivityMinutes: asIntOrNull(json['last_activity_minutes']),
      activePositions: positions,
    );
  }

  bool get hasActivity => activeCount > 0 || lastActivityMinutes != null;
}
```

**Actualizar `ActiveRouteBusLayer._load()`** para usar el campo:
```dart
Future<void> _load() async {
  final result = await ref.read(routesRepositoryProvider).getActivity(widget.routeId);
  if (!mounted) return;
  if (result is Success<RouteActivity>) {
    setState(() => _positions = result.data.activePositions);
  }
}
```

### Step 3b — MapScreen: usar ActiveRouteBusLayer

**Archivo:** `lib/features/map/screens/map_screen.dart`

Agregar import:
```dart
import '../widgets/active_route_bus_layer.dart';
```

En los children del mapa, después de `BusMarkerLayer`:
```dart
if (selectedRoute != null)
  ActiveRouteBusLayer(routeId: selectedRoute.id),
```

---

## Verification

```bash
~/development/flutter/bin/flutter analyze
```

Must return **0 issues**.

Commit: `feat: bus icon on active trip + active route bus positions on map`
