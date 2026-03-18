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
  await FMTCObjectBoxBackend().initialise();
  const store = FMTCStore('mapTiles');
  if (!await store.manage.ready) {
    await store.manage.create();
  }

  // Route Flutter framework errors (widget build failures, rendering errors)
  // to Crashlytics. Disabled in debug so the red error screen still shows.
  if (!kDebugMode) {
    FlutterError.onError = FirebaseCrashlytics.instance.recordFlutterFatalError;
    // Route uncaught async errors (platform channel failures, isolate errors)
    PlatformDispatcher.instance.onError = (error, stack) {
      FirebaseCrashlytics.instance.recordError(error, stack, fatal: true);
      return true;
    };
  }

  // Notifications are non-critical — initialize in background so runApp()
  // is never blocked by permission dialogs or Firebase setup delays.
  NotificationService.initialize(); // ignore: unawaited_futures
  runApp(const ProviderScope(child: MiBusApp()));
}
