# Spec 46 — Map tile caching (FMTC)

## Problem

All 5 `TileLayer` widgets in the app download tiles from CartoCDN on every session
with no local cache. On slow or intermittent connections (common on Barranquilla public
transport) the map shows blank white tiles. Users who open the same map area repeatedly
download the same tiles each time.

**Solution:** Use `flutter_map_tile_caching` (FMTC) with a demand cache — tiles are saved
to disk the first time they load and served locally on subsequent visits. Tiles expire after
30 days and are automatically re-fetched.

No bulk pre-download. Tiles cache organically as the user browses.

---

## File 1 — `pubspec.yaml`

Add dependency after `flutter_map`:

**Old:**
```yaml
  flutter_map: ^7.0.2
  latlong2: ^0.9.1
```

**New:**
```yaml
  flutter_map: ^7.0.2
  flutter_map_tile_caching: ^9.1.0
  latlong2: ^0.9.1
```

---

## File 2 — `lib/main.dart`

Initialize FMTC before `runApp`. The store is created once and persists across sessions.

**Old:**
```dart
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'core/notifications/notification_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();
```

**New:**
```dart
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map_tile_caching/flutter_map_tile_caching.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'core/notifications/notification_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();

  // Initialise tile cache store. Creates the ObjectBox database on first run;
  // subsequent launches just open the existing store.
  await FMTCObjectBoxBackend().initialise();
  await const FMTCStore('mapTiles').manage.createIfNotExists();
```

---

## Files 3–7 — All 5 TileLayer widgets

The same change applies to every `TileLayer` in the app. Add `tileProvider:` to each one.

**Old** (identical in all 5 files):
```dart
TileLayer(
  urlTemplate: AppStrings.tripTileUrl,
  subdomains: AppStrings.osmTileSubdomains,
  userAgentPackageName: AppStrings.osmUserAgent,
  keepBuffer: 3,
  panBuffer: 1,
),
```

**New** (identical replacement in all 5 files):
```dart
TileLayer(
  urlTemplate: AppStrings.tripTileUrl,
  subdomains: AppStrings.osmTileSubdomains,
  userAgentPackageName: AppStrings.osmUserAgent,
  keepBuffer: 3,
  panBuffer: 1,
  tileProvider: FMTCStore('mapTiles').getTileProvider(
    settings: FMTCTileProviderSettings(
      maxStaleAge: const Duration(days: 30),
    ),
  ),
),
```

Add the import to each of the 5 files that contain a `TileLayer`:
```dart
import 'package:flutter_map_tile_caching/flutter_map_tile_caching.dart';
```

### Files to modify:

| File | Location of TileLayer |
|---|---|
| `lib/features/map/screens/map_screen.dart` | Line ~863 |
| `lib/features/trip/screens/active_trip_screen.dart` | Line ~695 |
| `lib/features/trip/screens/boarding_confirm_screen.dart` | Line ~443 |
| `lib/features/map/screens/map_pick_screen.dart` | Line ~119 |
| `lib/features/trip/widgets/route_preview_sheet.dart` | Line ~170 |

---

## Verification

```bash
~/development/flutter/bin/flutter pub get
~/development/flutter/bin/flutter analyze
```

Expected: 0 issues.

## Behavior after this spec

- **First time a tile loads:** downloaded from CartoCDN, stored in ObjectBox on device
- **Next time same tile needed:** served from disk — instant, no network request
- **After 30 days:** tile is considered stale, re-fetched from network on next view
- **No signal:** map shows all previously cached tiles without any network requests
- The cache persists across app restarts and updates
- Cache is stored in the app's private data directory — no extra permissions needed
