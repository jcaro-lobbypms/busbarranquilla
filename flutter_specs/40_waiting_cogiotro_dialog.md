# Spec 40 — Modo espera: "¿Cogiste otro bus?" al moverse 100 m

## Problem

El mecanismo M2 actual detecta auto-boarding basándose en velocidad (≥10 km/h) y proximidad
a la geometría de la ruta esperada (≤150 m) durante ≥4 minutos. Esto falla en dos casos reales:
1. Bus lento (<10 km/h) — la condición de velocidad nunca se cumple aunque el usuario ya
   lleve 500+ metros encima de otro bus.
2. Buses que comparten tramos — M2 dispara el trip equivocado porque el otro bus pasa dentro
   de 150 m de la ruta esperada.

La solución es reemplazar M2 con una pregunta simple: si el usuario se movió ≥100 m desde su
punto de espera, preguntar "¿Cogiste otro bus?" antes de hacer cualquier suposición.

---

## Files to modify

- `flutter_app/lib/features/map/screens/map_screen.dart`
- `flutter_app/lib/core/l10n/strings.dart`

---

## Step 1 — Replace M2 fields with `_cogiOtroShown`

### 1a. Remove these three field declarations from `_MapScreenState`

```dart
// remove
  DateTime? _onRouteStart; // inicio de período "sobre la ruta" (M2)
```

```dart
// remove
  LatLng? _userPosAtOnRouteStart; // GPS usuario cuando _onRouteStart se asignó
```

```dart
// remove
  bool _slowAlertShown = false; // evita mostrar el diálogo M4 repetidamente
```

### 1b. Add `_cogiOtroShown` after `_farAlertShown`

```dart
// old
  bool _farAlertShown = false; // evita mostrar el diálogo M5 repetidamente
```

```dart
// new
  bool _farAlertShown = false; // evita mostrar el diálogo M5 repetidamente
  bool _cogiOtroShown = false; // evita mostrar el diálogo de "¿Cogiste otro bus?" dos veces
```

---

## Step 2 — Clean up `_startWaiting` (the block that activates waiting mode)

```dart
// old
    _waitingStartPosition = _livePosition;
    _userPosAtOnRouteStart = null;
    _userPosAtOffRouteStart = null;
    _slowAlertShown = false;
    _farAlertShown = false;
```

```dart
// new
    _waitingStartPosition = _livePosition;
    _userPosAtOffRouteStart = null;
    _cogiOtroShown = false;
    _farAlertShown = false;
```

---

## Step 3 — Clean up `_stopWaiting`

```dart
// old
    _waitingStartPosition = null;
    _onRouteStart = null;
    _offRouteStart = null;
    _userPosAtOnRouteStart = null;
    _userPosAtOffRouteStart = null;
    _slowAlertShown = false;
    _farAlertShown = false;
```

```dart
// new
    _waitingStartPosition = null;
    _offRouteStart = null;
    _userPosAtOffRouteStart = null;
    _cogiOtroShown = false;
    _farAlertShown = false;
```

---

## Step 4 — Replace `_startGpsMovementMonitor` entirely

```dart
// old
  void _startGpsMovementMonitor(BusRoute route) {
    _gpsMovementTimer?.cancel();
    _onRouteStart = null;
    _offRouteStart = null;

    if (route.geometry.isEmpty) return;

    _gpsMovementTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_autoboardPending) return;
      if (ref.read(tripNotifierProvider) is! TripIdle) return;

      final userPos = _livePosition;
      final startPos = _waitingStartPosition;
      if (userPos == null || startPos == null) return;

      final distFromStart = LocationService.distanceMeters(
        startPos.latitude,
        startPos.longitude,
        userPos.latitude,
        userPos.longitude,
      );

      if (distFromStart < 200) {
        _onRouteStart = null;
        _offRouteStart = null;
        return;
      }

      final distToRoute = _distToRouteGeometry(userPos, route.geometry);

      if (distToRoute < 150) {
        _offRouteStart = null;
        _userPosAtOffRouteStart = null;
        _farAlertShown = false;

        if (_onRouteStart == null) {
          _onRouteStart = DateTime.now();
          _userPosAtOnRouteStart = userPos;
          return;
        }

        final onRouteElapsed = DateTime.now().difference(_onRouteStart!);

        final distFromOnRouteStart = _userPosAtOnRouteStart != null
            ? LocationService.distanceMeters(
                _userPosAtOnRouteStart!.latitude,
                _userPosAtOnRouteStart!.longitude,
                userPos.latitude,
                userPos.longitude,
              )
            : distFromStart;

        final elapsedSec = onRouteElapsed.inSeconds.toDouble();
        final speedKmh = elapsedSec > 0 ? (distFromOnRouteStart / elapsedSec) * 3.6 : 0.0;

        if (speedKmh >= 10 && onRouteElapsed >= const Duration(minutes: 4)) {
          _triggerAutoBoarding(route);
          return;
        }

        if (speedKmh < 10 &&
            distFromOnRouteStart >= 200 &&
            onRouteElapsed >= const Duration(minutes: 8) &&
            !_slowAlertShown) {
          _slowAlertShown = true;
          _onRouteStart = null;
          _userPosAtOnRouteStart = null;
          if (mounted) _showSlowOnRouteDialog(route);
          return;
        }
      }

      if (distToRoute > 300) {
        _onRouteStart = null;
        _userPosAtOnRouteStart = null;
        _slowAlertShown = false;

        if (_offRouteStart == null) {
          _offRouteStart = DateTime.now();
          _userPosAtOffRouteStart = userPos;
          return;
        }

        final offRouteElapsed = DateTime.now().difference(_offRouteStart!);

        final distFromOffRouteStart = _userPosAtOffRouteStart != null
            ? LocationService.distanceMeters(
                _userPosAtOffRouteStart!.latitude,
                _userPosAtOffRouteStart!.longitude,
                userPos.latitude,
                userPos.longitude,
              )
            : distFromStart;

        final elapsedSec = offRouteElapsed.inSeconds.toDouble();
        final speedKmh = elapsedSec > 0 ? (distFromOffRouteStart / elapsedSec) * 3.6 : 0.0;

        if (speedKmh >= 10 && offRouteElapsed >= const Duration(minutes: 4)) {
          _gpsMovementTimer?.cancel();
          if (mounted) {
            ref.read(selectedWaitingRouteProvider.notifier).state = null;
            AppSnackbar.show(context, AppStrings.waitingAutoCancelled, SnackbarType.info);
          }
          return;
        }

        if (speedKmh < 10 &&
            distFromStart > 1000 &&
            offRouteElapsed >= const Duration(minutes: 5) &&
            !_farAlertShown) {
          _farAlertShown = true;
          _offRouteStart = null;
          _userPosAtOffRouteStart = null;
          if (mounted) _showFarOffRouteDialog();
          return;
        }
      }
    });
  }
```

```dart
// new
  void _startGpsMovementMonitor(BusRoute route) {
    _gpsMovementTimer?.cancel();
    _offRouteStart = null;

    if (route.geometry.isEmpty) return;

    _gpsMovementTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_autoboardPending || _cogiOtroShown) return;
      if (ref.read(tripNotifierProvider) is! TripIdle) return;

      final userPos = _livePosition;
      final startPos = _waitingStartPosition;
      if (userPos == null || startPos == null) return;

      final distFromStart = LocationService.distanceMeters(
        startPos.latitude,
        startPos.longitude,
        userPos.latitude,
        userPos.longitude,
      );

      // ── 100 m check: ¿Cogiste otro bus? ─────────────────────────────────
      // Fires regardless of speed — catches slow buses and fast ones equally.
      if (distFromStart >= 100) {
        _cogiOtroShown = true;
        if (mounted) _showCogiotroDialog(route, userPos);
        return;
      }

      // ── M3: far from route geometry → auto-cancel waiting mode ───────────
      final distToRoute = _distToRouteGeometry(userPos, route.geometry);

      if (distToRoute > 300) {
        if (_offRouteStart == null) {
          _offRouteStart = DateTime.now();
          _userPosAtOffRouteStart = userPos;
          return;
        }

        final offRouteElapsed = DateTime.now().difference(_offRouteStart!);

        final distFromOffRouteStart = _userPosAtOffRouteStart != null
            ? LocationService.distanceMeters(
                _userPosAtOffRouteStart!.latitude,
                _userPosAtOffRouteStart!.longitude,
                userPos.latitude,
                userPos.longitude,
              )
            : distFromStart;

        final elapsedSec = offRouteElapsed.inSeconds.toDouble();
        final speedKmh =
            elapsedSec > 0 ? (distFromOffRouteStart / elapsedSec) * 3.6 : 0.0;

        if (speedKmh >= 10 && offRouteElapsed >= const Duration(minutes: 4)) {
          _gpsMovementTimer?.cancel();
          if (mounted) {
            ref.read(selectedWaitingRouteProvider.notifier).state = null;
            AppSnackbar.show(
                context, AppStrings.waitingAutoCancelled, SnackbarType.info);
          }
          return;
        }

        if (speedKmh < 10 &&
            distFromStart > 1000 &&
            offRouteElapsed >= const Duration(minutes: 5) &&
            !_farAlertShown) {
          _farAlertShown = true;
          _offRouteStart = null;
          _userPosAtOffRouteStart = null;
          if (mounted) _showFarOffRouteDialog();
          return;
        }
      } else {
        // Back near route — reset M3 timers.
        _offRouteStart = null;
        _userPosAtOffRouteStart = null;
        _farAlertShown = false;
      }
    });
  }
```

---

## Step 5 — Remove `_showSlowOnRouteDialog` method

Delete the entire `_showSlowOnRouteDialog` method (no longer called):

```dart
// remove entirely
  void _showSlowOnRouteDialog(BusRoute route) {
    showDialog<void>(
      ...
    );
  }
```

---

## Step 6 — Add `_showCogiotroDialog` method

Add after `_showFarOffRouteDialog`:

```dart
// add
  void _showCogiotroDialog(BusRoute route, LatLng currentPos) {
    showDialog<void>(
      context: context,
      barrierDismissible: true,
      builder: (ctx) => AlertDialog(
        title: const Text(AppStrings.waitingCogiotroTitle),
        content: Text(
          '${AppStrings.waitingCogiotroBody} ${route.code}?',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              // Reset anchor — next 100 m will be measured from here.
              if (mounted) {
                setState(() {
                  _waitingStartPosition = currentPos;
                  _cogiOtroShown = false;
                });
              }
            },
            child: const Text(AppStrings.waitingCogiotroNo),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              // Explicitly reset before cancelling — _stopWaiting() also resets
              // but this makes the intent clear and avoids the .then() branch firing.
              if (mounted) setState(() => _cogiOtroShown = false);
              // Cancel waiting mode and open QuickBoardSheet to pick the new route.
              ref.read(selectedWaitingRouteProvider.notifier).state = null;
              if (mounted) {
                showModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  shape: const RoundedRectangleBorder(
                    borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
                  ),
                  builder: (_) => const QuickBoardSheet(),
                );
              }
            },
            child: const Text(AppStrings.waitingCogiotroYes),
          ),
        ],
      ),
    ).then((_) {
      // Tapped outside (barrier dismissed) → treat as "No, sigo esperando".
      if (mounted && _cogiOtroShown) {
        setState(() {
          _waitingStartPosition = currentPos;
          _cogiOtroShown = false;
        });
      }
    });
  }
```

---

## Step 7 — Add strings

**File:** `flutter_app/lib/core/l10n/strings.dart`

Add after `waitingFarOffRouteCancel`:

```dart
// add
  static const waitingCogiotroTitle = '¿Cogiste otro bus?';
  static const waitingCogiotroBody =
      'Te moviste más de 100 m. ¿Subiste a un bus diferente al';
  // Usage: '${AppStrings.waitingCogiotroBody} ${route.code}?'
  static const waitingCogiotroYes = 'Sí, cogí otro';
  static const waitingCogiotroNo = 'No, sigo esperando';
```

---

## Summary of what changes

| Before | After |
|---|---|
| M2: distToRoute <150 m + speed ≥10 km/h + 4 min | Removed |
| M2 slow variant: distFromStart ≥200 m + speed <10 + 8 min | Removed |
| `_showSlowOnRouteDialog` | Removed |
| Fields: `_onRouteStart`, `_userPosAtOnRouteStart`, `_slowAlertShown` | Removed |
| New: `_cogiOtroShown` | Added |
| New: `_showCogiotroDialog` — fires at 100 m from waiting start | Added |
| M3 (distToRoute >300 + speed) | Unchanged |
| M1 (socket co-movement) | Unchanged |

---

## Verification

```bash
~/development/flutter/bin/flutter analyze
```

Must return **0 issues**.

---

## Step 8 — Change destination button icon in `ActiveTripScreen`

**File:** `flutter_app/lib/features/trip/screens/active_trip_screen.dart`

`Icons.flag_outlined` is ambiguous — the flag is already used as the destination pin on the map.
Replace with `Icons.where_to_vote` which users recognize as "set/confirm destination" from
navigation apps (location pin with checkmark).

```dart
// old
                  child: const Icon(Icons.flag_outlined, color: AppColors.accent),
```

```dart
// new
                  child: const Icon(Icons.where_to_vote, color: AppColors.accent),
```
