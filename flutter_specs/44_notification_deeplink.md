# Spec 44 — Notification deep-link + "no destination" nudge

## Problem

1. **Deep-link missing:** Tapping a local notification (inactivity check, boarding alerts) while the app is in background or terminated opens the app but shows no modal. `NotificationService.initialize()` has no `onDidReceiveNotificationResponse`, and cold-start has no `getNotificationAppLaunchDetails()` check. `active_trip_screen.dart` checks `dropoffPrompt` in `initState` but not `showInactivityModal`.

2. **No-destination nudge missing:** Users who board without selecting a stop never learn about dropoff alerts unless the dialog fires automatically — which Spec 43 removed. A one-time push 4 minutes into the trip nudges them to set a destination. Two variants:
   - **Regular nudge** (user has ≥5 credits or is premium/admin): "¿A dónde vas? → selecciona tu parada"
   - **Premium nudge** (free user with <5 credits): "Activa alertas → hazte premium, es gratis el primer mes"

3. **Tap opens stop list instead of map:** The stop list has no readable names. Tapping the `no_destination` notification must open the crosshair map picker directly (`_pickDestinationOnMap()`), not the stop-select sheet.

---

## Routing table — which notifications open a modal

| `type` payload | Action on tap |
|---|---|
| `inactivity_check` | Go to `/trip`, show inactivity dialog **only if** `showInactivityModal == true` |
| `no_destination` | Go to `/trip`, call `_pickDestinationOnMap()` **only if** `destinationStopId == null && !hasDropoffMonitor` |
| `boarding_alert_prepare` | Go to `/trip`, no modal |
| `boarding_alert_now` | Go to `/trip`, no modal |
| `report` / `report_resolved` | Go to `/trip`, no modal |
| `trip_ended` | Go to `/profile/trips`, no modal |

---

## File 1 — `lib/core/notifications/notification_service.dart`

### Change A: Add `onDidReceiveNotificationResponse` to `initialize()`

Add a static callback field and wire it in `initialize()`.

**Old:**
```dart
class NotificationService {
  NotificationService._();

  static final FlutterLocalNotificationsPlugin _local =
      FlutterLocalNotificationsPlugin();
```

**New:**
```dart
class NotificationService {
  NotificationService._();

  static final FlutterLocalNotificationsPlugin _local =
      FlutterLocalNotificationsPlugin();

  /// Called when user taps a local notification (foreground, background, or
  /// terminated). Set this before calling [initialize].
  static void Function(String? payload)? onNotificationTap;
```

**Old** (inside `initialize()`):
```dart
    const initSettings = InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
    );
    await _local.initialize(initSettings);
```

**New:**
```dart
    const initSettings = InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
    );
    await _local.initialize(
      initSettings,
      onDidReceiveNotificationResponse: (NotificationResponse response) {
        onNotificationTap?.call(response.payload);
      },
      onDidReceiveBackgroundNotificationResponse: _onBackgroundNotificationResponse,
    );
```

Add top-level background handler (must be top-level, not inside the class):

```dart
@pragma('vm:entry-point')
void _onBackgroundNotificationResponse(NotificationResponse response) {
  NotificationService.onNotificationTap?.call(response.payload);
}
```

### Change B: Add `getNotificationAppLaunchDetails()`

Add at the end of the class:

```dart
  /// Returns the payload of the notification that launched the app from a
  /// terminated state, or null if the app was opened normally.
  static Future<String?> getLaunchPayload() async {
    final details = await _local.getNotificationAppLaunchDetails();
    if (details == null || !details.didNotificationLaunchApp) return null;
    return details.notificationResponse?.payload;
  }
```

---

## File 2 — `lib/app.dart`

### Change A: Register `NotificationService.onNotificationTap` in `initState`

**Old** (in `_MiBusAppState.initState`):
```dart
  @override
  void initState() {
    super.initState();

    // App opened from background by tapping a notification
    NotificationService.setOnMessageOpenedApp(_handleNotificationTap);

    // App launched from terminated state by tapping a notification
    NotificationService.getInitialMessage().then((message) {
      if (message != null) _handleNotificationTap(message.data);
    });
  }
```

**New:**
```dart
  @override
  void initState() {
    super.initState();

    // FCM: app opened from background by tapping a push notification
    NotificationService.setOnMessageOpenedApp(_handleNotificationTap);

    // FCM: app launched from terminated state
    NotificationService.getInitialMessage().then((message) {
      if (message != null) _handleNotificationTap(message.data);
    });

    // Local notifications: tap handler (background + foreground)
    NotificationService.onNotificationTap = _handleLocalNotificationTap;

    // Local notifications: cold start (app was terminated)
    NotificationService.getLaunchPayload().then((payload) {
      if (payload != null) _handleLocalNotificationTap(payload);
    });
  }
```

### Change B: Add `_handleLocalNotificationTap`

Add this method to `_MiBusAppState`.

`no_destination` calls `requestMapPick()` (signals `ActiveTripScreen` to open the
crosshair map picker, not the stop list).

```dart
  void _handleLocalNotificationTap(String? payload) {
    if (payload == null) return;
    final router = ref.read(appRouterProvider);

    switch (payload) {
      case 'inactivity_check':
        router.go('/trip');
        // The inactivity dialog is shown by ActiveTripScreen.initState
        // checking showInactivityModal — no extra action needed here.

      case 'no_destination':
        router.go('/trip');
        // Signal ActiveTripScreen to open the MAP PICKER (not stop list).
        WidgetsBinding.instance.addPostFrameCallback((_) {
          final s = ref.read(tripNotifierProvider);
          if (s is TripActive) {
            ref.read(tripNotifierProvider.notifier).requestMapPick();
          }
        });

      case 'boarding_alert_prepare':
      case 'boarding_alert_now':
        router.go('/trip');

      default:
        break;
    }
  }
```

---

## File 3 — `lib/features/trip/providers/trip_state.dart`

Add `noMapPickRequested` flag to `TripActive` (signals the screen to open the crosshair
map picker when the user taps the no-destination notification):

**Old:**
```dart
  final bool dropoffAutoPickDestination;
```

**New:**
```dart
  final bool dropoffAutoPickDestination;
  final bool noMapPickRequested;
```

Add to constructor defaults:
```dart
    this.noMapPickRequested = false,
```

Add to `copyWith`:
```dart
    bool? noMapPickRequested,
```
```dart
      noMapPickRequested: noMapPickRequested ?? this.noMapPickRequested,
```

---

## File 4 — `lib/features/trip/providers/trip_notifier.dart`

### Change A: Add payload types to all `showAlert()` calls

Find every `NotificationService.showAlert(...)` call and add `payload`:

| Current title | Add `payload:` |
|---|---|
| `AppStrings.stillOnBus` (inactivity) | `'inactivity_check'` |
| `AppStrings.dropoffAlertPrepareTitle` (prepare) | `'boarding_alert_prepare'` |
| `AppStrings.dropoffAlertNowTitle` (now/vibrate) | `'boarding_alert_now'` |

### Change B: Add `requestMapPick()` / `clearMapPickRequest()` methods

```dart
  /// Called when user taps the "no destination" local notification.
  /// Sets a flag so ActiveTripScreen opens the crosshair map picker.
  void requestMapPick() {
    if (state is! TripActive) return;
    final active = state as TripActive;
    if (active.trip.destinationStopId != null || hasDropoffMonitor) return;
    state = active.copyWith(noMapPickRequested: true);
  }

  void clearMapPickRequest() {
    if (state is! TripActive) return;
    state = (state as TripActive).copyWith(noMapPickRequested: false);
  }
```

### Change C: Add 4-minute no-destination nudge timer in `startTrip()`

Add a `Timer? _noDestTimer` field alongside the other timers.

After `_startMonitors(activeState, destinationStopId)` in `startTrip()`:

```dart
    // One-time nudge: if no destination after 4 min, send a local push.
    // Two variants depending on whether the user can afford the 5-credit service.
    if (destinationStopId == null) {
      _noDestTimer = Timer(const Duration(minutes: 4), () {
        if (state is! TripActive) return;
        final active = state as TripActive;
        if (active.trip.destinationStopId != null || hasDropoffMonitor) return;

        final authState = ref.read(authNotifierProvider);
        if (authState is! Authenticated) return;
        final user = authState.user;

        final prefs = user.notificationPrefs;
        if (prefs?.boardingAlerts == false) return;

        final isPremium = user.isPremium || user.role == 'admin';
        final hasCredits = user.credits >= 5;

        if (!isPremium && !hasCredits) {
          // User cannot afford the service — nudge toward premium.
          unawaited(NotificationService.showAlert(
            title: AppStrings.noDestinationPremiumNudgeTitle,
            body: AppStrings.noDestinationPremiumNudgeBody,
            payload: 'no_destination',
          ));
        } else {
          // User can use the service — nudge to pick a stop.
          unawaited(NotificationService.showAlert(
            title: AppStrings.noDestinationNudgeTitle,
            body: AppStrings.noDestinationNudgeBody,
            payload: 'no_destination',
          ));
        }
      });
    }
```

Cancel in `_disposeMonitorsAndTimers()`:
```dart
    _noDestTimer?.cancel();
    _noDestTimer = null;
```

Also cancel when user sets a destination (in `setDestinationStop`, `setDestinationByLatLng`, `updateDestinationByLatLng`):
```dart
    _noDestTimer?.cancel();
    _noDestTimer = null;
```

---

## File 5 — `lib/features/trip/screens/active_trip_screen.dart`

### Change: Add `showInactivityModal` and `noMapPickRequested` checks in `initState`

In the existing `addPostFrameCallback` block, add after the `dropoffPrompt` check.

`noMapPickRequested` calls `_pickDestinationOnMap()` (crosshair map picker), **not**
`_changeDestination()` (which assumes an existing destination to center on).

**Old:**
```dart
      final s = ref.read(tripNotifierProvider);
      if (s is TripActive && s.dropoffPrompt) {
        _showDropoffPrompt();
      }
      if (s is TripActive && s.dropoffAutoPickDestination) {
        ref.read(tripNotifierProvider.notifier).clearDropoffAutoPickDestination();
        _pickDestinationOnMap(ref.read(tripNotifierProvider.notifier));
      }
```

**New:**
```dart
      final s = ref.read(tripNotifierProvider);
      if (s is TripActive && s.dropoffPrompt) {
        _showDropoffPrompt();
      }
      if (s is TripActive && s.dropoffAutoPickDestination) {
        ref.read(tripNotifierProvider.notifier).clearDropoffAutoPickDestination();
        _pickDestinationOnMap(ref.read(tripNotifierProvider.notifier));
      }
      // Check inactivity modal — may have been set before screen mounted (recovery).
      if (s is TripActive && s.showInactivityModal) {
        _showInactivityDialog();
      }
      // Tap on "no destination" notification → open crosshair map picker.
      if (s is TripActive && s.noMapPickRequested) {
        ref.read(tripNotifierProvider.notifier).clearMapPickRequest();
        _pickDestinationOnMap(ref.read(tripNotifierProvider.notifier));
      }
```

Also add `noMapPickRequested` handling to the `ref.listen` block (alongside the existing
`dropoffAutoPickDestination` listener):

```dart
      if (next.noMapPickRequested && prev?.noMapPickRequested != true) {
        ref.read(tripNotifierProvider.notifier).clearMapPickRequest();
        _pickDestinationOnMap(ref.read(tripNotifierProvider.notifier));
      }
```

---

## File 6 — `lib/core/l10n/strings.dart`

Add four strings:

```dart
  // No-destination nudge — user has credits or is premium
  static const noDestinationNudgeTitle = '🗺️ ¿A dónde vas?';
  static const noDestinationNudgeBody = 'Selecciona tu parada para recibir alertas cuando estés llegando.';

  // No-destination nudge — free user with insufficient credits
  static const noDestinationPremiumNudgeTitle = '🔔 Activa alertas de bajada';
  static const noDestinationPremiumNudgeBody = 'Con Premium nunca te pasas de tu parada. ¡El primer mes es gratis!';
```

---

## Verification

```bash
~/development/flutter/bin/flutter analyze
```

Expected: 0 issues.

## Behavior after this spec

- **Tap inactivity notification (background):** app goes to `/trip`, dialog appears only if `showInactivityModal == true` (idempotent — already responded = no dialog)
- **Tap inactivity notification (cold start):** app recovers trip → mounts `ActiveTripScreen` → `initState` check fires dialog if state requires it
- **Tap "no destination" notification:** app goes to `/trip` → opens crosshair map picker directly (not stop list) — only if still no destination
- **4-minute nudge (has credits/premium):** "¿A dónde vas?" → pick stop → activate alerts
- **4-minute nudge (free, <5 credits):** "Activa alertas de bajada → hazte premium" — same `no_destination` payload, same deep-link behavior
- **Nudge auto-cancelled** when destination is set or trip ends
- **Informational notifications** (`boarding_alert_*`): navigate to `/trip`, no modal
