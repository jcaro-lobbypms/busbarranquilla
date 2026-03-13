# MiBus Flutter — Phase 4: UX Fixes Spec

## Context

The Flutter app is deployed. Three UX problems need to be fixed to match the web experience:

1. **Stop selection is manual** — should auto-detect the nearest stop (like the web does)
2. **Route not visible when selecting in planner** — `PlanResultCard` should show a mini-map with the route geometry
3. **Origin/destination not shown on main map** — when a plan is active, the map tab should show origin (green) and destination (red) markers

**`flutter analyze` must return 0 issues after every step.**
Use `~/development/flutter/bin/flutter` as the Flutter binary.

---

## Existing code to reuse — do NOT recreate

| Symbol | File |
|--------|------|
| `PlanResult` model | `lib/core/domain/models/plan_result.dart` — has `nearestStop: LatLng`, `nearestStopName`, `geometry: List<LatLng>` |
| `selectedPlanRouteProvider` | `lib/features/planner/providers/planner_notifier.dart` — `StateProvider<PlanResult?>` |
| `LocationService.distanceMeters` | `lib/core/location/location_service.dart` |
| `RoutePolylineLayer` | `lib/shared/widgets/route_polyline_layer.dart` |
| `AppColors` | `lib/core/theme/app_colors.dart` — primary=`0xFF2563EB`, success=`0xFF10B981`, error=`0xFFEF4444` |
| `AppStrings` | `lib/core/l10n/strings.dart` |
| `selectedFeedRouteProvider` | `lib/features/map/providers/map_provider.dart` — `StateProvider<BusRoute?>` |

---

## Step 1 — Intelligent stop auto-selection in StopSelectScreen

### Problem
`StopSelectScreen` shows a plain list of stops and the user has to manually pick one. The `selectedPlanRouteProvider` contains a `PlanResult` with `nearestStop: LatLng` (the stop closest to the destination) but this is completely ignored.

### Solution
When a `PlanResult` is available in `selectedPlanRouteProvider`, auto-select the stop whose coordinates are closest to `result.nearestStop`. Show a highlighted "Parada recomendada" card at the top so the user can see what was auto-selected and optionally change it.

### Strings to add in `lib/core/l10n/strings.dart`
```dart
static const recommendedStop = 'Parada recomendada';
static const changeStop = 'Cambiar';
```

### Changes to `lib/features/trip/screens/stop_select_screen.dart`

**In `_StopSelectScreenState`, add a method `_autoSelectStop()`** called after `_loadStops()` succeeds:

```dart
void _autoSelectStop() {
  final planResult = ref.read(selectedPlanRouteProvider);
  if (planResult == null || _stops.isEmpty) return;

  // Find the stop closest to planResult.nearestStop
  Stop? best;
  double bestDist = double.infinity;

  for (final stop in _stops) {
    final d = LocationService.distanceMeters(
      stop.latitude,
      stop.longitude,
      planResult.nearestStop.latitude,
      planResult.nearestStop.longitude,
    );
    if (d < bestDist) {
      bestDist = d;
      best = stop;
    }
  }

  if (best != null) {
    setState(() => _selectedStopId = best!.id);
  }
}
```

Call `_autoSelectStop()` at the end of `_loadStops()`, after `setState` sets `_loading = false`.

**Add a "Parada recomendada" banner at the top of the stops list** — show it only when `selectedPlanRouteProvider` is not null and `_selectedStopId` is not null:

```dart
// At the top of the ListView (before the regular stop items), add:
if (ref.watch(selectedPlanRouteProvider) != null && _selectedStopId != null)
  _RecommendedStopBanner(
    stopName: _stops.firstWhere((s) => s.id == _selectedStopId).name,
    onClear: () => setState(() => _selectedStopId = null),
  ),
```

**Add private widget `_RecommendedStopBanner`** (same file, below state class):

```dart
class _RecommendedStopBanner extends StatelessWidget {
  final String stopName;
  final VoidCallback onClear;

  const _RecommendedStopBanner({required this.stopName, required this.onClear});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.success.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.success),
      ),
      child: Row(
        children: <Widget>[
          const Icon(Icons.check_circle_outline, color: AppColors.success, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Text(
                  AppStrings.recommendedStop,
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    color: AppColors.success,
                    fontSize: 12,
                  ),
                ),
                Text(stopName, style: const TextStyle(fontSize: 13)),
              ],
            ),
          ),
          TextButton(
            onPressed: onClear,
            child: const Text(AppStrings.changeStop),
          ),
        ],
      ),
    );
  }
}
```

**Wrap the stops section in the body Column** so the banner appears above the list:
```dart
// Replace the current Expanded ListView with:
Expanded(
  child: _stops.isEmpty
      ? const EmptyView(...)
      : ListView.builder(
          itemCount: _stops.length + (bannerVisible ? 1 : 0),
          // OR simply put the banner inside a Column above ListView
        ),
),
```

Simplest approach — wrap in a Column inside Expanded:
```dart
Expanded(
  child: _stops.isEmpty
      ? const EmptyView(
          icon: Icons.pin_drop_outlined,
          message: AppStrings.tripNoStops,
        )
      : Column(
          children: <Widget>[
            if (ref.watch(selectedPlanRouteProvider) != null && _selectedStopId != null)
              _RecommendedStopBanner(
                stopName: _stops.firstWhere(
                  (s) => s.id == _selectedStopId,
                  orElse: () => _stops.first,
                ).name,
                onClear: () => setState(() => _selectedStopId = null),
              ),
            Expanded(
              child: ListView.builder(
                itemCount: _stops.length,
                itemBuilder: (context, index) {
                  final stop = _stops[index];
                  final selected = stop.id == _selectedStopId;
                  return ListTile(
                    onTap: () => setState(() => _selectedStopId = stop.id),
                    title: Text(stop.name),
                    subtitle: Text('${stop.stopOrder}'),
                    trailing: selected
                        ? const Icon(Icons.check_circle, color: AppColors.success)
                        : null,
                  );
                },
              ),
            ),
          ],
        ),
),
```

**Imports needed:**
```dart
import '../../../core/location/location_service.dart';
import '../../../core/theme/app_colors.dart';
import '../providers/trip_notifier.dart'; // already imported
```

Run `flutter analyze` — fix any issues.

Commit: `feat: auto-select nearest destination stop from plan result`

---

## Step 2 — Mini-map route preview in PlanResultCard

### Problem
When plan results are shown, there's no way to visually preview the route. The user can't see where the bus goes before deciding to board.

### Solution
Add an expandable mini-map to `PlanResultCard`. When the user taps the card, it expands to show the route geometry polyline + a destination marker. A "Iniciar viaje" button replaces the current tap-to-navigate behavior.

The card has two states:
- **Collapsed** (default): shows route info (code, name, company, distances) + expand icon
- **Expanded**: shows the above + a 220px `FlutterMap` with the geometry + "Iniciar viaje" button

### Changes to `lib/features/planner/widgets/plan_result_card.dart`

Convert `PlanResultCard` from `ConsumerWidget` to `ConsumerStatefulWidget` to hold the `_expanded` boolean locally:

```dart
class PlanResultCard extends ConsumerStatefulWidget {
  final PlanResult result;
  final VoidCallback onSelect;

  const PlanResultCard({required this.result, required this.onSelect, super.key});

  @override
  ConsumerState<PlanResultCard> createState() => _PlanResultCardState();
}

class _PlanResultCardState extends ConsumerState<PlanResultCard> {
  bool _expanded = false;
  // ... move build logic here, use widget.result and widget.onSelect
}
```

**In the collapsed view**, change the card `onTap` to `setState(() => _expanded = !_expanded)` instead of calling `onSelect` directly.

**Add the expanded section** after the existing info rows, shown only when `_expanded == true`:

```dart
if (_expanded) ...<Widget>[
  const SizedBox(height: 10),
  if (widget.result.geometry.isNotEmpty)
    SizedBox(
      height: 200,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(10),
        child: FlutterMap(
          options: MapOptions(
            initialCenter: widget.result.nearestStop,
            initialZoom: 13,
          ),
          children: <Widget>[
            TileLayer(
              urlTemplate: AppStrings.osmTileUrl,
              userAgentPackageName: AppStrings.osmUserAgent,
            ),
            RoutePolylineLayer(points: widget.result.geometry),
            MarkerLayer(
              markers: <Marker>[
                Marker(
                  point: widget.result.nearestStop,
                  width: 28,
                  height: 28,
                  child: const Icon(
                    Icons.flag,
                    color: AppColors.error,
                    size: 28,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    ),
  const SizedBox(height: 10),
  SizedBox(
    width: double.infinity,
    child: ElevatedButton.icon(
      onPressed: widget.onSelect,
      icon: const Icon(Icons.directions_bus),
      label: const Text(AppStrings.tripStartButton),
    ),
  ),
],
```

**Update the trailing icon** in the card header to reflect expanded state:
```dart
trailing: Icon(_expanded ? Icons.expand_less : Icons.expand_more),
```

**Imports needed:**
```dart
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/widgets/route_polyline_layer.dart';
```

Run `flutter analyze` — fix any issues.

Commit: `feat: expandable mini-map preview in plan result card`

---

## Step 3 — Origin and destination markers on main map

### Problem
When the user plans a route and switches to the Map tab, the map shows no indication of the planned origin/destination.

### Solution
Add two `StateProvider`s that hold the planned origin and destination `LatLng`. The planner sets them when a plan succeeds. The map reads them and shows markers.

### 3a — Add providers in `lib/features/planner/providers/planner_notifier.dart`

Add at the bottom of the file (after `plannerNotifierProvider`):

```dart
/// Set by PlannerNotifier when a plan succeeds. Read by MapScreen to show markers.
final planOriginProvider = StateProvider<LatLng?>((ref) => null);
final planDestinationProvider = StateProvider<LatLng?>((ref) => null);
```

Import needed:
```dart
import 'package:latlong2/latlong.dart';
```

### 3b — Set providers when plan succeeds in `PlannerNotifier.planRoute()`

Inside the `case Success` branch of `planRoute()`, after setting `state = PlannerResults(...)`, add:

```dart
ref.read(planOriginProvider.notifier).state = LatLng(originLat, originLng);
ref.read(planDestinationProvider.notifier).state = LatLng(destLat, destLng);
```

Also clear them when the planner resets to idle (add a `clearPlan()` method or clear inside `setOrigin` when resetting to `PlannerIdle`):

Inside `setOrigin()` and `setDestination()`, when transitioning to `PlannerIdle`, also clear:
```dart
ref.read(planOriginProvider.notifier).state = null;
ref.read(planDestinationProvider.notifier).state = null;
```

### 3c — Create `lib/features/map/widgets/plan_markers_layer.dart`

```dart
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/theme/app_colors.dart';

class PlanMarkersLayer extends StatelessWidget {
  final LatLng? origin;
  final LatLng? destination;

  const PlanMarkersLayer({this.origin, this.destination, super.key});

  @override
  Widget build(BuildContext context) {
    final markers = <Marker>[
      if (origin != null)
        Marker(
          point: origin!,
          width: 32,
          height: 32,
          child: const Icon(Icons.trip_origin, color: AppColors.success, size: 28),
        ),
      if (destination != null)
        Marker(
          point: destination!,
          width: 32,
          height: 32,
          child: const Icon(Icons.location_on, color: AppColors.error, size: 28),
        ),
    ];

    if (markers.isEmpty) return const SizedBox.shrink();
    return MarkerLayer(markers: markers);
  }
}
```

### 3d — Add export in `lib/features/map/widgets/index.dart`

```dart
export 'plan_markers_layer.dart';
```

### 3e — Update `lib/features/map/screens/map_screen.dart`

Import the new widget and providers:
```dart
import '../../../features/planner/providers/planner_notifier.dart';
import '../widgets/plan_markers_layer.dart';
```

Read the providers in `build()`:
```dart
final planOrigin = ref.watch(planOriginProvider);
final planDest = ref.watch(planDestinationProvider);
```

Add to the FlutterMap `children` list, after `UserMarkerLayer`:
```dart
PlanMarkersLayer(origin: planOrigin, destination: planDest),
```

Run `flutter analyze` — fix any issues.

Commit: `feat: show origin and destination markers on map when plan is active`

---

## Final verification

```bash
~/development/flutter/bin/flutter analyze
```

Must return **0 issues**.

---

## Verification checklist

- [ ] In `StopSelectScreen`, coming from planner: the nearest stop to the destination is auto-selected and shown as "Parada recomendada"
- [ ] User can tap "Cambiar" to deselect and pick a different stop manually
- [ ] `PlanResultCard` is collapsed by default, showing only route info
- [ ] Tapping the card expands it to show the mini-map with route geometry + flag marker at destination stop
- [ ] "Iniciar viaje" button appears only when expanded
- [ ] Switching to the Map tab after searching a route shows a green origin marker and red destination marker
- [ ] Markers disappear when the planner resets (new origin selected)
- [ ] `flutter analyze` → 0 issues
