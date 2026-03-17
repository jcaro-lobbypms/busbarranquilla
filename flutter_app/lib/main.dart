import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'core/notifications/notification_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();
  // Notifications are non-critical — initialize in background so runApp()
  // is never blocked by permission dialogs or Firebase setup delays.
  NotificationService.initialize(); // ignore: unawaited_futures
  runApp(const ProviderScope(child: MiBusApp()));
}
