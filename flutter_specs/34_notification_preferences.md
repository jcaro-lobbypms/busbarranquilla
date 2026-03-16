# Spec 34 — Notification Preferences Panel & Bus Nearby Credit Charge

> **MOBILE APP ONLY** — All changes in this spec are for `flutter_app/` and `backend/`.
> Do NOT modify any files under `web/`.

## Problem

The "bus nearby" notification fires unconditionally (free, no opt-in) every time the user
waits for a bus. There is no way to turn it off, no credit cost, and no per-type preference
system. Users have no control over which notification types they receive.

## Goal

1. Add a `notification_prefs` column to `users` (JSONB) — backend persists preferences.
2. Add a backend endpoint to update preferences from the app.
3. Add a `NotificationPrefs` model to Flutter and attach it to `User`.
4. Show a one-time opt-in dialog the **first time** each notification type would fire
   (when `prefs.busNearby == null`). Never ask again once the user decides.
5. Charge **3 credits** (free users only) each time the bus-nearby notification fires.
6. Add a **Notifications section** in `ProfileScreen` so users can change preferences anytime.

---

## Part 1 — Backend

### 1.1 `backend/src/config/schema.ts`

Add after the existing `fcm_token` migration block:

```typescript
await pool.query(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notification_prefs JSONB DEFAULT '{}'
`);
```

### 1.2 `backend/src/controllers/authController.ts`

#### 1.2a — Update `getProfile` SELECT

In the `getProfile` query, add `notification_prefs` to the selected columns:

```typescript
// old
SELECT id, name, email, phone, credits, role, is_premium, is_active,
       trial_expires_at, premium_expires_at, reputation, created_at,
       referral_code, fcm_token
FROM users WHERE id = $1

// new
SELECT id, name, email, phone, credits, role, is_premium, is_active,
       trial_expires_at, premium_expires_at, reputation, created_at,
       referral_code, fcm_token, notification_prefs
FROM users WHERE id = $1
```

Include `notification_prefs` in the returned user object (it is already returned as-is since
the pg driver parses JSONB automatically):

```typescript
res.json({ user: { ...userRow, notification_prefs: userRow.notification_prefs ?? {} } });
```

#### 1.2b — New `updateNotificationPrefs` controller

```typescript
export const updateNotificationPrefs = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = (req as any).userId;
  const { notification_prefs } = req.body;

  if (typeof notification_prefs !== 'object' || notification_prefs === null) {
    res.status(400).json({ error: 'notification_prefs must be an object' });
    return;
  }

  await pool.query(
    'UPDATE users SET notification_prefs = $1 WHERE id = $2',
    [JSON.stringify(notification_prefs), userId],
  );

  res.json({ message: 'Preferencias de notificaciones actualizadas' });
};
```

Export it alongside the other auth exports.

### 1.3 `backend/src/routes/authRoutes.ts`

```typescript
import { updateNotificationPrefs } from '../controllers/authController';

// Add after the fcm-token route:
router.patch('/notification-prefs', authMiddleware, updateNotificationPrefs);
```

---

## Part 2 — Flutter

### 2.1 Create `flutter_app/lib/core/domain/models/notification_prefs.dart`

```dart
/// User preferences for notification types.
/// A null value means the user has never been asked (opt-in dialog not shown yet).
class NotificationPrefs {
  /// Push/local alert when the waited bus is ≤ 2 min away. Costs 3 credits (free users).
  final bool? busNearby;

  /// Drop-off alerts during an active trip (400 m prepare + 200 m alight). Costs 5 credits.
  final bool? boardingAlerts;

  /// Push notification when another user reports a trancón on your active route.
  final bool? routeReports;

  const NotificationPrefs({
    this.busNearby,
    this.boardingAlerts,
    this.routeReports,
  });

  factory NotificationPrefs.fromJson(Map<String, dynamic> json) => NotificationPrefs(
        busNearby: json['bus_nearby'] as bool?,
        boardingAlerts: json['boarding_alerts'] as bool?,
        routeReports: json['route_reports'] as bool?,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        if (busNearby != null) 'bus_nearby': busNearby,
        if (boardingAlerts != null) 'boarding_alerts': boardingAlerts,
        if (routeReports != null) 'route_reports': routeReports,
      };

  NotificationPrefs copyWith({
    bool? busNearby,
    bool? boardingAlerts,
    bool? routeReports,
  }) =>
      NotificationPrefs(
        busNearby: busNearby ?? this.busNearby,
        boardingAlerts: boardingAlerts ?? this.boardingAlerts,
        routeReports: routeReports ?? this.routeReports,
      );
}
```

### 2.2 `flutter_app/lib/core/domain/models/user.dart`

#### 2.2a — Add import

```dart
import 'notification_prefs.dart';
```

#### 2.2b — Add field

```dart
// In the User class, add after referralCode:
final NotificationPrefs? notificationPrefs;
```

#### 2.2c — Update constructor

```dart
const User({
  // ... existing params ...
  this.notificationPrefs,
});
```

#### 2.2d — Update `fromJson`

```dart
// Add after referralCode line:
notificationPrefs: json['notification_prefs'] != null
    ? NotificationPrefs.fromJson(
        json['notification_prefs'] as Map<String, dynamic>)
    : null,
```

#### 2.2e — Update `copyWith`

```dart
// Add param:
NotificationPrefs? notificationPrefs,

// Add in return:
notificationPrefs: notificationPrefs ?? this.notificationPrefs,
```

### 2.3 `flutter_app/lib/core/api/api_paths.dart`

```dart
// Add after authFcmToken:
static const authNotificationPrefs = '/api/auth/notification-prefs';
```

### 2.4 `flutter_app/lib/core/data/sources/auth_remote_source.dart`

```dart
Future<void> updateNotificationPrefs(Map<String, dynamic> prefs) async {
  await _dio.patch(
    ApiPaths.authNotificationPrefs,
    data: <String, dynamic>{'notification_prefs': prefs},
  );
}
```

### 2.5 `flutter_app/lib/core/data/repositories/auth_repository.dart`

```dart
Future<void> updateNotificationPrefs(Map<String, dynamic> prefs) async {
  try {
    await _source.updateNotificationPrefs(prefs);
  } catch (_) {
    // Non-critical
  }
}
```

### 2.6 `flutter_app/lib/features/auth/providers/auth_notifier.dart`

Add a new public method to `AuthNotifier`:

```dart
/// Persists notification preferences to the backend and updates local auth state.
Future<void> updateNotificationPrefs(Map<String, dynamic> prefs) async {
  if (state is! Authenticated) return;
  final current = state as Authenticated;
  // Optimistic update
  final updated = current.user.copyWith(
    notificationPrefs: NotificationPrefs.fromJson(prefs),
  );
  state = Authenticated(updated);
  // Persist
  await ref.read(authRepositoryProvider).updateNotificationPrefs(prefs);
}
```

Add import at top of file:
```dart
import '../../../core/domain/models/notification_prefs.dart';
```

### 2.7 Create `flutter_app/lib/shared/widgets/notification_opt_in_dialog.dart`

```dart
import 'package:flutter/material.dart';

import '../../core/l10n/strings.dart';
import '../../core/theme/app_colors.dart';

enum NotificationOptInType { busNearby, boardingAlerts, routeReports }

/// Shows a one-time opt-in dialog for a notification type.
/// Returns true if the user accepted, false if declined.
/// Never throws.
Future<bool> showNotificationOptInDialog(
  BuildContext context, {
  required NotificationOptInType type,
}) async {
  final cfg = _configFor(type);
  final result = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => AlertDialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: Row(
        children: <Widget>[
          Text(cfg.icon, style: const TextStyle(fontSize: 26)),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              cfg.title,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
      content: Text(cfg.body, style: const TextStyle(fontSize: 14, height: 1.45)),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(false),
          child: const Text(AppStrings.notifOptInDecline),
        ),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: AppColors.primary),
          onPressed: () => Navigator.of(ctx).pop(true),
          child: Text(cfg.acceptLabel),
        ),
      ],
    ),
  );
  return result ?? false;
}

class _Cfg {
  final String icon;
  final String title;
  final String body;
  final String acceptLabel;
  const _Cfg(this.icon, this.title, this.body, this.acceptLabel);
}

_Cfg _configFor(NotificationOptInType type) {
  switch (type) {
    case NotificationOptInType.busNearby:
      return const _Cfg(
        '🚌',
        AppStrings.notifBusNearbyTitle,
        AppStrings.notifBusNearbyBody,
        AppStrings.notifBusNearbyAccept,
      );
    case NotificationOptInType.boardingAlerts:
      return const _Cfg(
        '📍',
        AppStrings.notifBoardingTitle,
        AppStrings.notifBoardingBody,
        AppStrings.notifBoardingAccept,
      );
    case NotificationOptInType.routeReports:
      return const _Cfg(
        '📢',
        AppStrings.notifRouteReportsTitle,
        AppStrings.notifRouteReportsBody,
        AppStrings.notifRouteReportsAccept,
      );
  }
}
```

### 2.8 `flutter_app/lib/core/l10n/strings.dart`

Add after `waitingBusNearTitle`:

```dart
// ── Notification opt-in dialog ──────────────────────────────────────────
static const notifOptInDecline = 'No por ahora';

static const notifBusNearbyTitle = 'Avisar cuando el bus llega';
static const notifBusNearbyBody =
    'Te notificamos cuando el bus que esperas está a ~2 minutos.\n\n'
    'Cuesta 3 créditos por alerta. Los usuarios Premium no pagan.';
static const notifBusNearbyAccept = 'Activar (3 créditos)';

static const notifBoardingTitle = 'Alertas de bajada';
static const notifBoardingBody =
    'Te avisamos a 400 m y a 200 m de tu parada de destino.\n\n'
    'Cuesta 5 créditos por viaje. Los usuarios Premium no pagan.';
static const notifBoardingAccept = 'Activar (5 créditos)';

static const notifRouteReportsTitle = 'Reportes en tu ruta';
static const notifRouteReportsBody =
    'Recibes una notificación cuando alguien reporta un trancón '
    'o desvío en la ruta que estás usando.\n\nGratis para todos.';
static const notifRouteReportsAccept = 'Activar';

// ── Notification preferences section ────────────────────────────────────
static const notifSectionTitle = 'Notificaciones';
static const notifBusNearbyLabel = 'Avisar cuando el bus se acerca';
static const notifBusNearbySub = 'Mientras esperas · 3 créditos por alerta';
static const notifBoardingLabel = 'Alertas de bajada';
static const notifBoardingSub = 'Durante el viaje · 5 créditos por viaje';
static const notifRouteReportsLabel = 'Reportes en tu ruta';
static const notifRouteReportsSub = 'Trancones y desvíos · Gratis';
static const notifPremiumFree = 'Premium: gratis';
static const notifSavedSnackbar = 'Preferencia guardada';
```

### 2.9 `flutter_app/lib/features/map/screens/map_screen.dart`

#### 2.9a — Add imports

```dart
import '../../../core/data/repositories/credits_repository.dart';
import '../../../core/error/result.dart';
import '../../../core/domain/models/notification_prefs.dart';
import '../../../shared/widgets/app_snackbar.dart';
import '../../../shared/widgets/notification_opt_in_dialog.dart';
import '../../auth/providers/auth_notifier.dart';
```

#### 2.9b — Replace the bus-nearby notification block

Find the existing block (around line 236–247):

```dart
// OLD — replace this entire if block:
if (!_waitingBusNearNotified && eta != null && eta <= 2) {
  _waitingBusNearNotified = true;
  final distText = distM != null ? _formatDistance(distM) : '';
  final etaText = eta == 0
      ? AppStrings.waitingEtaArriving
      : '~$eta ${AppStrings.waitingEtaMinutes}';
  unawaited(NotificationService.showAlert(
    title: '🚌 ${AppStrings.waitingBusNearTitle}',
    body: '${route.code} · ${route.name} — $etaText${distText.isNotEmpty ? ' · $distText' : ''}',
  ));
  unawaited(_vibrateWaitingAlert());
}
```

```dart
// NEW:
if (!_waitingBusNearNotified && eta != null && eta <= 2) {
  _waitingBusNearNotified = true;
  final distText = distM != null ? _formatDistance(distM) : '';
  final etaText = eta == 0
      ? AppStrings.waitingEtaArriving
      : '~$eta ${AppStrings.waitingEtaMinutes}';
  unawaited(_handleBusNearbyNotification(
    route,
    '$etaText${distText.isNotEmpty ? ' · $distText' : ''}',
  ));
}
```

#### 2.9c — Add `_handleBusNearbyNotification` method to `_MapScreenState`

```dart
Future<void> _handleBusNearbyNotification(
    dynamic route, String etaAndDist) async {
  final authState = ref.read(authNotifierProvider);
  if (authState is! Authenticated) return;

  final prefs = authState.user.notificationPrefs;

  // ── First time: show opt-in dialog ──────────────────────────────────
  if (prefs?.busNearby == null) {
    if (!mounted) return;
    final enabled = await showNotificationOptInDialog(
      context,
      type: NotificationOptInType.busNearby,
    );
    if (!mounted) return;
    final merged = <String, dynamic>{
      ...?prefs?.toJson(),
      'bus_nearby': enabled,
    };
    await ref.read(authNotifierProvider.notifier).updateNotificationPrefs(merged);
    if (!enabled) return;
  }

  // ── Preference explicitly disabled ───────────────────────────────────
  if (prefs?.busNearby == false) return;

  // ── Charge 3 credits for free users ─────────────────────────────────
  final isPremium = authState.user.hasActivePremium || authState.user.role == 'admin';
  if (!isPremium) {
    final result = await ref.read(creditsRepositoryProvider).spend(
          <String, dynamic>{
            'amount': 3,
            'description': 'Alerta bus cercano',
          },
        );
    if (result is Failure) {
      if (mounted) {
        AppSnackbar.show(
          context,
          'Sin créditos para alertas de bus',
          SnackbarType.error,
        );
      }
      return;
    }
  }

  // ── Show notification ────────────────────────────────────────────────
  unawaited(NotificationService.showAlert(
    title: '🚌 ${AppStrings.waitingBusNearTitle}',
    body: '${route.code} · ${route.name} — $etaAndDist',
  ));
  unawaited(_vibrateWaitingAlert());
}
```

> `route` is the local variable of type `BusRoute` available in the calling context.
> Use the correct type if the parameter needs to be explicit: `BusRoute route`.

### 2.10 `flutter_app/lib/features/profile/screens/profile_screen.dart`

#### 2.10a — Add imports

```dart
import '../../../core/domain/models/notification_prefs.dart';
import '../../../shared/widgets/notification_opt_in_dialog.dart';
import '../../auth/providers/auth_notifier.dart';
```

#### 2.10b — Add `_NotificationsSection` widget at the bottom of the file

```dart
class _NotificationsSection extends ConsumerWidget {
  final User user;
  const _NotificationsSection({required this.user});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final prefs = user.notificationPrefs ?? const NotificationPrefs();
    final isPremium = user.hasActivePremium || user.role == 'admin';

    Future<void> toggle(String key, bool newValue) async {
      final merged = <String, dynamic>{
        ...prefs.toJson(),
        key: newValue,
      };
      await ref.read(authNotifierProvider.notifier).updateNotificationPrefs(merged);
      if (context.mounted) {
        AppSnackbar.show(context, AppStrings.notifSavedSnackbar, SnackbarType.success);
      }
    }

    return _SectionCard(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
            child: Text(
              AppStrings.notifSectionTitle,
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: AppColors.textSecondary,
                letterSpacing: 0.5,
              ),
            ),
          ),
          _NotifTile(
            icon: Icons.directions_bus_rounded,
            iconColor: AppColors.primary,
            label: AppStrings.notifBusNearbyLabel,
            subtitle: isPremium
                ? AppStrings.notifPremiumFree
                : AppStrings.notifBusNearbySub,
            value: prefs.busNearby ?? false,
            onChanged: (v) => toggle('bus_nearby', v),
          ),
          const Divider(height: 1, indent: 56, endIndent: 16),
          _NotifTile(
            icon: Icons.location_on_rounded,
            iconColor: const Color(0xFF059669),
            label: AppStrings.notifBoardingLabel,
            subtitle: isPremium
                ? AppStrings.notifPremiumFree
                : AppStrings.notifBoardingSub,
            value: prefs.boardingAlerts ?? false,
            onChanged: (v) => toggle('boarding_alerts', v),
          ),
          const Divider(height: 1, indent: 56, endIndent: 16),
          _NotifTile(
            icon: Icons.notifications_rounded,
            iconColor: AppColors.accent,
            label: AppStrings.notifRouteReportsLabel,
            subtitle: AppStrings.notifRouteReportsSub,
            value: prefs.routeReports ?? false,
            onChanged: (v) => toggle('route_reports', v),
          ),
          const SizedBox(height: 6),
        ],
      ),
    );
  }
}

class _NotifTile extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String label;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  const _NotifTile({
    required this.icon,
    required this.iconColor,
    required this.label,
    required this.subtitle,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return SwitchListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
      secondary: Container(
        width: 36,
        height: 36,
        decoration: BoxDecoration(
          color: iconColor.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(9),
        ),
        child: Icon(icon, color: iconColor, size: 20),
      ),
      title: Text(
        label,
        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
      ),
      subtitle: Text(
        subtitle,
        style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
      ),
      value: value,
      activeColor: AppColors.primary,
      onChanged: onChanged,
    );
  }
}
```

#### 2.10c — Insert `_NotificationsSection` into `_ProfileReadyView.build`

Between the menu `_SectionCard` and the `PremiumCard`:

```dart
// OLD:
const SizedBox(height: 12),

// ── Premium card ────────────────────────────────────
PremiumCard(user: user),
```

```dart
// NEW:
const SizedBox(height: 12),

// ── Notification preferences ─────────────────────
_NotificationsSection(user: user),

const SizedBox(height: 12),

// ── Premium card ────────────────────────────────────
PremiumCard(user: user),
```

---

## Acceptance criteria

- `notification_prefs` column exists in `users` table and is returned by `GET /api/auth/profile`.
- `PATCH /api/auth/notification-prefs` saves the JSON object and returns 200.
- `User.notificationPrefs` is populated on app start from the profile response.
- **First time `busNearby` fires** (prefs null): opt-in dialog appears. User's choice is saved.
  Dialog never appears again for that type unless preference is explicitly cleared.
- **If user declines**: no notification fires, no credits deducted.
- **If user accepts (free)**: 3 credits are deducted via `/api/credits/spend`. If insufficient
  credits, snackbar error appears and notification is suppressed.
- **Premium/admin users**: notification fires immediately after opt-in, no credit charge.
- **ProfileScreen** shows "Notificaciones" section with 3 toggles. Toggling saves immediately
  and shows a success snackbar.
- `flutter analyze` reports 0 new issues.
