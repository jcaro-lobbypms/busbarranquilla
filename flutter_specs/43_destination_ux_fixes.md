# Spec 43 — Destination UX: fix unwanted prompts + animated FAB

## Problem

**Bug A — App reopen without destination:**
When the app is reopened with an active trip that has no `destination_stop_id`, `_recoverActiveTrip()` calls `_startMonitors(activeState, null)`. Inside `_startMonitors`, the `else if (!isPremium)` branch fires immediately, setting `dropoffPrompt = true` (or `dropoffAutoPickDestination = true`). Result: the user sees the "Activar alertas" prompt or is sent to the map-pick screen **every time they reopen the app**, even though they never asked for dropoff alerts.

**Bug B — Start trip without destination:**
When a user boards from `BoardingConfirmScreen` without selecting a stop (`_selectedStopId == null`), `startTrip(routeId, destinationStopId: null)` is called → `_startMonitors(state, null)` → same prompt fires **before the user even sees the trip view**.

**Feature — Animated destination FAB:**
The `where_to_vote` FAB in `ActiveTripScreen` is static. When no destination is set, the user has no visual cue that they can tap it to add one. A pulsing animation + "Añadir destino" label makes the call to action clear without being intrusive.

---

## File 1 — `lib/features/trip/providers/trip_notifier.dart`

### Change: Remove unsolicited no-destination prompt from `_startMonitors`

The `else if (!isPremium)` block at the end of `_startMonitors` fires when `destinationStopId == null`. Delete it entirely. The user will set a destination voluntarily via the animated FAB.

**Old:**
```dart
    } else if (!isPremium) {
      if (boardingAlertsEnabled) {
        // Preference is on but no destination selected yet — skip the payment
        // confirmation dialog and go straight to destination picker.
        state = (state as TripActive).copyWith(dropoffAutoPickDestination: true);
      } else {
        // Free users without preference: show full prompt (pay + pick destination).
        state = (state as TripActive).copyWith(dropoffPrompt: true);
      }
    }
```

**New:**
```dart
    }
    // No destination selected — don't prompt automatically.
    // The animated destination FAB in ActiveTripScreen guides the user.
```

---

## File 2 — `lib/features/trip/screens/active_trip_screen.dart`

### Change A: Switch to `TickerProviderStateMixin` (supports multiple AnimationControllers)

**Old:**
```dart
class _ActiveTripScreenState extends ConsumerState<ActiveTripScreen>
    with SingleTickerProviderStateMixin {
```

**New:**
```dart
class _ActiveTripScreenState extends ConsumerState<ActiveTripScreen>
    with TickerProviderStateMixin {
```

### Change B: Add destination pulse AnimationController in `initState`

Add after the existing `_creditAnimController` setup (before the `WidgetsBinding.instance.addPostFrameCallback` block):

```dart
  late final AnimationController _destAnimController;
  late final Animation<double> _destPulse;
```

In `initState`, after the credit animation setup:
```dart
    _destAnimController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    )..repeat(reverse: true);
    _destPulse = Tween<double>(begin: 1.0, end: 1.22).animate(
      CurvedAnimation(parent: _destAnimController, curve: Curves.easeInOut),
    );
```

### Change C: Dispose the new controller

**Old:**
```dart
  @override
  void dispose() {
    _mapController.dispose();
    _creditAnimController.dispose();
    super.dispose();
  }
```

**New:**
```dart
  @override
  void dispose() {
    _mapController.dispose();
    _creditAnimController.dispose();
    _destAnimController.dispose();
    super.dispose();
  }
```

### Change D: Wrap the destination FAB with ScaleTransition + label

Locate the `FloatingActionButton.small` that calls `_changeDestination()` and uses `Icons.where_to_vote`. Replace it with:

**Old:**
```dart
                FloatingActionButton.small(
                  heroTag: 'dest',
                  tooltip: AppStrings.tripChangeDestination,
                  backgroundColor: AppColors.primaryDark,
                  onPressed: () => _changeDestination(),
                  child: const Icon(Icons.where_to_vote, color: AppColors.accent),
                ),
```

**New:**
```dart
                Builder(builder: (context) {
                  final hasDestination = active.trip.destinationStopId != null ||
                      ref.read(tripNotifierProvider.notifier).hasDropoffMonitor;
                  return Column(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      ScaleTransition(
                        scale: hasDestination ? const AlwaysStoppedAnimation(1.0) : _destPulse,
                        child: FloatingActionButton.small(
                          heroTag: 'dest',
                          tooltip: AppStrings.tripChangeDestination,
                          backgroundColor: AppColors.primaryDark,
                          onPressed: () => _changeDestination(),
                          child: const Icon(Icons.where_to_vote, color: AppColors.accent),
                        ),
                      ),
                      if (!hasDestination) ...<Widget>[
                        const SizedBox(height: 2),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: AppColors.primaryDark.withValues(alpha: 0.85),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: const Text(
                            AppStrings.tripAddDestination,
                            style: TextStyle(
                              fontSize: 9,
                              color: AppColors.accent,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ],
                  );
                }),
```

---

## File 3 — `lib/core/l10n/strings.dart`

Add one string:

```dart
  static const tripAddDestination = 'Añadir destino';
```

---

## Verification

```bash
~/development/flutter/bin/flutter analyze
```

Expected: 0 issues.

## Behavior after fix

- **App reopen (no destination):** router goes to `/trip` directly. No dialog, no map-pick. Animated pulsing FAB + "Añadir destino" label guides the user.
- **Board without destination:** `startTrip()` → `context.go('/trip')` → trip view appears immediately. Same animated FAB.
- **User taps animated FAB:** `_changeDestination()` → map-pick → confirmation → destination set → FAB stops animating, label disappears.
- **Dropoff prompt dialog** (`dropoffPrompt`) still appears when `destinationStopId != null` but alerts are not yet activated (user set a stop, needs to confirm payment). This is expected and untouched.
