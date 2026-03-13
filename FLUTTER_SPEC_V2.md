# MiBus Flutter — Phase 2 Features Spec

## Context

The Flutter app at `flutter_app/` is already built with Clean Architecture (Steps 1–14 of FLUTTER_SPEC.md are complete).
This spec adds the two remaining features needed to match the web app experience.

**`flutter analyze` must return 0 issues after every step. Fix any errors before continuing.**

---

## Clean code rules — non-negotiable

1. No business logic in widgets. All API calls happen in repositories or notifiers.
2. No hardcoded strings in widgets. Every user-facing string goes in `lib/core/l10n/strings.dart`.
3. No raw network calls outside repositories.
4. No `setState` for shared state — use Riverpod.
5. Keep each class single-responsibility. If it does two things, split it.

---

## Existing code to reuse (do NOT recreate)

| Symbol | File |
|--------|------|
| `routesRepositoryProvider` | `lib/core/data/repositories/routes_repository.dart` |
| `RoutesRepository.nearby({lat, lng, radius})` | same file — returns `Result<List<BusRoute>>` |
| `LocationService.getCurrentPosition()` | `lib/core/location/location_service.dart` — returns `Position?` |
| `LocationService.distanceMeters(lat1, lng1, lat2, lng2)` | same file |
| `BusRoute` model | `lib/core/domain/models/bus_route.dart` |
| `RouteCodeBadge` widget | `lib/shared/widgets/route_code_badge.dart` |
| `AppColors` | `lib/core/theme/app_colors.dart` |
| `AppStrings` | `lib/core/l10n/strings.dart` |
| `plannerNotifierProvider` | `lib/features/planner/providers/planner_notifier.dart` |
| `PlannerIdle` state | `lib/features/planner/providers/planner_state.dart` |

---

## Step 1 — "Cerca de ti" section in BoardingScreen

### What it does
When the user taps "Me subí" and lands on `BoardingScreen`, they currently see a search field and the full list of all routes. This step adds a **"Cerca de ti"** horizontal scroll section **above** the search field showing routes within 500m of the user's current GPS position.

If GPS is unavailable or no routes are nearby, the section is hidden entirely — no error shown.

### Strings to add in `lib/core/l10n/strings.dart`

```dart
static const nearbyTitle = 'Cerca de ti';
```

### Changes to `lib/features/trip/screens/boarding_screen.dart`

The screen is a `ConsumerStatefulWidget`. Extend `_BoardingScreenState` as follows:

**Add state fields:**
```dart
List<BusRoute> _nearbyRoutes = const <BusRoute>[];
```

**Update `_loadRoutes()`** — run both calls in parallel using `Future.wait`:
```dart
Future<void> _loadRoutes() async {
  setState(() { _loading = true; _error = null; });

  // get GPS in parallel with route list
  final results = await Future.wait<dynamic>(<Future<dynamic>>[
    ref.read(routesRepositoryProvider).list(),
    LocationService.getCurrentPosition(),
  ]);

  final routesResult = results[0] as Result<List<BusRoute>>;
  final position = results[1] as Position?;

  // load nearby only if GPS is available
  if (position != null) {
    final nearbyResult = await ref.read(routesRepositoryProvider).nearby(
      lat: position.latitude,
      lng: position.longitude,
      radius: 0.5,
    );
    if (nearbyResult is Success<List<BusRoute>>) {
      setState(() { _nearbyRoutes = nearbyResult.data; });
    }
  }

  switch (routesResult) {
    case Success<List<BusRoute>>(data: final routes):
      setState(() { _routes = routes; _loading = false; });
    case Failure(error: final error):
      setState(() { _error = error.message; _loading = false; });
  }
}
```

**Add `_NearbyRouteCard` private widget** (inside the same file, below the state class):

```dart
class _NearbyRouteCard extends StatelessWidget {
  final BusRoute route;
  final VoidCallback onTap;

  const _NearbyRouteCard({required this.route, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 200,
        margin: const EdgeInsets.only(right: 10),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          border: Border.all(color: Theme.of(context).dividerColor),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            RouteCodeBadge(code: route.code),
            const SizedBox(height: 6),
            Text(
              route.name,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            if ((route.companyName ?? route.company ?? '').isNotEmpty)
              Text(
                route.companyName ?? route.company ?? '',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodySmall,
              ),
          ],
        ),
      ),
    );
  }
}
```

**Update `build()`** — add the "Cerca de ti" section above the `Padding` that wraps the search field:

```dart
// Inside the body Column, BEFORE the search field Padding:
if (_nearbyRoutes.isNotEmpty) ...<Widget>[
  Padding(
    padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
    child: Text(
      AppStrings.nearbyTitle,
      style: Theme.of(context).textTheme.titleMedium,
    ),
  ),
  const SizedBox(height: 8),
  SizedBox(
    height: 110,
    child: ListView.builder(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      itemCount: _nearbyRoutes.length,
      itemBuilder: (context, index) {
        final route = _nearbyRoutes[index];
        return _NearbyRouteCard(
          route: route,
          onTap: () => context.go('/trip/stop-select?routeId=${route.id}'),
        );
      },
    ),
  ),
  const SizedBox(height: 4),
],
```

### Imports needed
```dart
import '../../../core/data/repositories/routes_repository.dart';
import '../../../core/domain/models/bus_route.dart';
import '../../../core/error/result.dart';
import '../../../core/location/location_service.dart';
import '../../../shared/widgets/route_code_badge.dart';
import 'package:geolocator/geolocator.dart'; // for Position type
```

---

## Step 2 — "Buses en tu zona" section in PlannerScreen

### What it does
In the **Planner tab**, after the user's current location is set as origin (which happens automatically on load), show a vertical list of routes within 500m of the origin **before** the user enters a destination. The section disappears once plan results are shown.

This mirrors the web app's "Buses en tu zona" feature in PlanTripMode.

### Strings to add in `lib/core/l10n/strings.dart`

```dart
static const nearbyRoutesTitle = 'Buses en tu zona';
static const nearbyRoutesHint = '¿Va a tu destino? Escríbelo arriba ↑';
```

### 2a — Update `PlannerIdle` in `lib/features/planner/providers/planner_state.dart`

Add `nearbyRoutes` field:

```dart
import '../../../core/domain/models/bus_route.dart'; // ADD import

final class PlannerIdle extends PlannerState {
  final NominatimResult? selectedOrigin;
  final NominatimResult? selectedDest;
  final List<BusRoute> nearbyRoutes; // ADD

  const PlannerIdle({
    this.selectedOrigin,
    this.selectedDest,
    this.nearbyRoutes = const <BusRoute>[], // ADD
  });

  PlannerIdle copyWith({
    NominatimResult? selectedOrigin,
    NominatimResult? selectedDest,
    List<BusRoute>? nearbyRoutes, // ADD
  }) {
    return PlannerIdle(
      selectedOrigin: selectedOrigin ?? this.selectedOrigin,
      selectedDest: selectedDest ?? this.selectedDest,
      nearbyRoutes: nearbyRoutes ?? this.nearbyRoutes, // ADD
    );
  }
}
```

### 2b — Update `PlannerNotifier` in `lib/features/planner/providers/planner_notifier.dart`

Add imports:
```dart
import '../../../core/data/repositories/routes_repository.dart';
```

Add a private method `_loadNearbyForOrigin`:
```dart
Future<void> _loadNearbyForOrigin(NominatimResult origin) async {
  final result = await ref.read(routesRepositoryProvider).nearby(
    lat: origin.lat,
    lng: origin.lng,
    radius: 0.5,
  );

  if (result is Success<List<BusRoute>> && state is PlannerIdle) {
    state = (state as PlannerIdle).copyWith(nearbyRoutes: result.data);
  }
}
```

Update `setOrigin` to call `_loadNearbyForOrigin` after going to idle:
```dart
void setOrigin(NominatimResult origin) {
  _selectedOrigin = origin;

  if (state is PlannerResults) {
    final current = state as PlannerResults;
    state = current.copyWith(
      selectedOrigin: origin,
      originLabel: origin.displayName,
    );
    return;
  }

  state = PlannerIdle(
    selectedOrigin: _selectedOrigin,
    selectedDest: _selectedDest,
  );

  // fetch nearby routes for origin in background
  Future<void>(_loadNearbyForOrigin(origin));
}
```

### 2c — Update `PlannerScreen` in `lib/features/planner/screens/planner_screen.dart`

Read `nearbyRoutes` from state. Show the section only when:
- State is `PlannerIdle`
- `nearbyRoutes` is not empty
- `selectedDest` is null (destination not yet chosen)

Inside the `build` method, extract nearby routes from state:
```dart
final nearbyRoutes = switch (state) {
  PlannerIdle(nearbyRoutes: final routes, selectedDest: null) => routes,
  _ => const <BusRoute>[],
};
```

Add the section in the `Column` children list, **between** the address search fields and the search button — only when `nearbyRoutes.isNotEmpty` and state is not `PlannerResults`:

```dart
if (nearbyRoutes.isNotEmpty && state is! PlannerResults) ...<Widget>[
  const SizedBox(height: 12),
  Align(
    alignment: Alignment.centerLeft,
    child: Text(
      AppStrings.nearbyRoutesTitle,
      style: Theme.of(context).textTheme.titleMedium,
    ),
  ),
  const SizedBox(height: 4),
  Text(
    AppStrings.nearbyRoutesHint,
    style: Theme.of(context).textTheme.bodySmall,
  ),
  const SizedBox(height: 6),
  ...nearbyRoutes.map(
    (route) => ListTile(
      onTap: () => context.go('/trip/stop-select?routeId=${route.id}'),
      leading: RouteCodeBadge(code: route.code),
      title: Text(route.name),
      subtitle: (route.companyName ?? route.company ?? '').isNotEmpty
          ? Text(route.companyName ?? route.company ?? '')
          : null,
      trailing: const Icon(Icons.chevron_right),
      contentPadding: EdgeInsets.zero,
    ),
  ),
],
```

Import needed in planner_screen.dart:
```dart
import '../../../core/domain/models/bus_route.dart';
```

---

## After both steps

1. Run `flutter analyze` — must return **0 issues**.
2. Fix any errors.
3. Commit:
   ```
   feat: add Cerca de ti in boarding and Buses en tu zona in planner
   ```

---

## Verification checklist

- [ ] BoardingScreen shows a horizontal scroll "Cerca de ti" when GPS is available and nearby routes exist
- [ ] BoardingScreen works normally (no section visible) when GPS is off or no routes within 500m
- [ ] PlannerScreen shows "Buses en tu zona" vertical list after origin is auto-set from GPS
- [ ] "Buses en tu zona" disappears once plan results are shown
- [ ] Tapping any nearby route in either screen navigates to `/trip/stop-select?routeId=X`
- [ ] `flutter analyze` returns 0 issues
