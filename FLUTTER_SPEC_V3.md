# MiBus Flutter — Phase 3: Production Setup Spec

## Context

The Flutter app at `flutter_app/` has all features implemented but is missing:
- Platform folders (`android/`, `ios/`) — not yet generated
- Native permissions for GPS + internet
- App icon and splash screen
- Two UX fixes: user position marker on map, vibration on drop-off alert

**`flutter analyze` must return 0 issues after every step.**
Use `~/development/flutter/bin/flutter` as the Flutter binary throughout.

---

## Clean code rules — non-negotiable

1. No hardcoded strings in widgets — `lib/core/l10n/strings.dart` only.
2. No logic in widgets — all state in Riverpod notifiers.
3. Do not modify any existing feature code except where this spec explicitly instructs you to.

---

## Step 1 — Generate platform folders

The project currently only has `lib/`, `test/`, and `pubspec.yaml`. Run inside `flutter_app/`:

```bash
~/development/flutter/bin/flutter create \
  --org co.mibus \
  --project-name mibus_flutter \
  --platforms android,ios \
  .
```

This generates `android/` and `ios/` without touching existing Dart files.

After running, verify with:
```bash
ls flutter_app/android flutter_app/ios
```

Commit: `chore: generate android and ios platform folders`

---

## Step 2 — Android permissions

Edit `flutter_app/android/app/src/main/AndroidManifest.xml`.

Add the following permissions **before** the `<application>` tag:

```xml
<!-- Internet -->
<uses-permission android:name="android.permission.INTERNET"/>

<!-- Location (foreground) -->
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>

<!-- Location (background — needed while trip is active) -->
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION"/>

<!-- Vibration for drop-off alerts -->
<uses-permission android:name="android.permission.VIBRATE"/>

<!-- Keep CPU awake during active trip -->
<uses-permission android:name="android.permission.WAKE_LOCK"/>
```

Inside the `<application>` tag, set:
```xml
android:label="MiBus"
```

Inside the `<activity>` tag that has `android.intent.action.MAIN`, ensure:
```xml
android:exported="true"
```

Commit: `chore: add android permissions and app label`

---

## Step 3 — iOS permissions

Edit `flutter_app/ios/Runner/Info.plist`.

Add the following keys inside the root `<dict>`:

```xml
<!-- Location permissions (required by geolocator) -->
<key>NSLocationWhenInUseUsageDescription</key>
<string>MiBus necesita tu ubicación para mostrarte rutas cercanas y rastrear tu viaje en tiempo real.</string>

<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>MiBus necesita tu ubicación en segundo plano para continuar rastreando tu viaje cuando cierras la app.</string>

<key>NSLocationAlwaysUsageDescription</key>
<string>MiBus necesita tu ubicación en segundo plano para continuar rastreando tu viaje cuando cierras la app.</string>
```

Commit: `chore: add ios location permission descriptions`

---

## Step 4 — App icon and splash screen

### 4a — Add packages to `pubspec.yaml`

Add under `dev_dependencies`:
```yaml
  flutter_launcher_icons: ^0.14.1
  flutter_native_splash: ^2.4.1
```

Add at the **bottom** of `pubspec.yaml` (after the `flutter:` section):

```yaml
flutter_launcher_icons:
  android: true
  ios: true
  image_path: "assets/icon/icon.png"
  adaptive_icon_background: "#1E3A5F"
  adaptive_icon_foreground: "assets/icon/icon_foreground.png"
  min_sdk_android: 21

flutter_native_splash:
  color: "#1E3A5F"
  color_dark: "#1E3A5F"
  image: assets/splash/splash_logo.png
  android: true
  ios: true
  fullscreen: true
```

Also add under the `flutter:` section:
```yaml
  assets:
    - assets/icon/
    - assets/splash/
```

### 4b — Create asset folders and placeholder icons

Create directories:
- `flutter_app/assets/icon/`
- `flutter_app/assets/splash/`

Create `flutter_app/assets/icon/icon.png`:
A 1024×1024 PNG with:
- Background: `#1E3A5F` (dark blue)
- A white bus icon centered (🚌 style — a simple rounded rectangle bus shape)
- Text "MB" in white bold below the bus, centered

Create `flutter_app/assets/icon/icon_foreground.png`:
Same bus icon + "MB" text on transparent background (for Android adaptive icon foreground), 1024×1024.

Create `flutter_app/assets/splash/splash_logo.png`:
- Transparent background, 512×512
- White bus icon + "MiBus" text below in white

**If you cannot generate PNG images programmatically, create them using Flutter's canvas by writing a small Dart script at `flutter_app/tool/generate_assets.dart` that uses `dart:ui` to draw and save the PNGs. Then run it:**

```bash
~/development/flutter/bin/dart flutter_app/tool/generate_assets.dart
```

The script should produce the three PNG files above.

### 4c — Run icon and splash generators

```bash
cd flutter_app
~/development/flutter/bin/flutter pub get
~/development/flutter/bin/dart run flutter_launcher_icons
~/development/flutter/bin/dart run flutter_native_splash:create
```

Commit: `chore: add app icon and splash screen`

---

## Step 5 — User GPS position marker on map

### What it does
The map currently shows bus markers and report markers but not the user's own position. Add a blue dot marker at the user's current GPS position, updated in real time via the position stream.

### Changes to `lib/features/map/providers/map_state.dart`

`MapReady` already has `userPosition: LatLng?`. No state changes needed.

### Create `lib/features/map/widgets/user_marker_layer.dart`

```dart
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/theme/app_colors.dart';

class UserMarkerLayer extends StatelessWidget {
  final LatLng position;

  const UserMarkerLayer({required this.position, super.key});

  @override
  Widget build(BuildContext context) {
    return MarkerLayer(
      markers: <Marker>[
        Marker(
          point: position,
          width: 20,
          height: 20,
          child: Container(
            decoration: BoxDecoration(
              color: AppColors.primary,
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: 3),
              boxShadow: const <BoxShadow>[
                BoxShadow(
                  color: Colors.black26,
                  blurRadius: 4,
                  offset: Offset(0, 2),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
```

### Update `lib/features/map/widgets/index.dart`

Add export:
```dart
export 'user_marker_layer.dart';
```

### Update `lib/features/map/screens/map_screen.dart`

Import the new widget and add it to the map's `children` list, **after** `TileLayer` and **before** `RoutePolylineLayer`:

```dart
if (ready.userPosition != null)
  UserMarkerLayer(position: ready.userPosition!),
```

Commit: `feat: add user GPS position marker on map`

---

## Step 6 — Vibration on drop-off alert

### What it does
When the drop-off monitor fires `onAlight` (user is ≤200m from destination), the app should vibrate to alert the user even if the screen is locked.

Flutter already has `HapticFeedback` in `package:flutter/services.dart` — no new package needed.

### Changes to `lib/features/trip/providers/trip_notifier.dart`

Add import at the top:
```dart
import 'package:flutter/services.dart';
```

Inside `_startMonitors`, update the `onAlight` callback of `DropoffMonitor`:

```dart
onAlight: () {
  if (state is! TripActive) return;
  final active = state as TripActive;
  state = active.copyWith(dropoffAlert: DropoffAlert.alight);
  HapticFeedback.vibrate();
},
```

Commit: `feat: vibrate on drop-off alight alert`

---

## Step 7 — Final verification

Run:
```bash
~/development/flutter/bin/flutter analyze
```

Must return **0 issues**.

Then run a build check (does not require a device):
```bash
~/development/flutter/bin/flutter build apk --debug 2>&1 | tail -5
```

Commit if needed: `chore: production setup complete`

---

## Verification checklist

- [ ] `android/` and `ios/` folders exist
- [ ] AndroidManifest.xml has all 6 permissions + `android:label="MiBus"`
- [ ] Info.plist has 3 location permission keys in Spanish
- [ ] App icon files exist at `assets/icon/icon.png` and `assets/icon/icon_foreground.png`
- [ ] Splash logo exists at `assets/splash/splash_logo.png`
- [ ] `flutter_launcher_icons` ran successfully (no errors)
- [ ] `flutter_native_splash:create` ran successfully
- [ ] Blue user position marker appears on map when GPS is available
- [ ] `HapticFeedback.vibrate()` is called on `onAlight`
- [ ] `flutter analyze` → 0 issues
- [ ] `flutter build apk --debug` succeeds
