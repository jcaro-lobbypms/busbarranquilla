import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../core/domain/models/stop.dart';
import '../../../core/location/location_service.dart';

class DesvioMonitor {
  final List<Stop> stops;
  final VoidCallback onDesvio;

  Timer? _timer;
  Timer? _ignoreTimer;
  DateTime? _offRouteAt;
  bool _alerted = false;
  bool _ignored = false;

  DesvioMonitor({required this.stops, required this.onDesvio});

  void start() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => _check());
  }

  void ignore(Duration duration) {
    _alerted = false;
    _ignored = true;
    _ignoreTimer?.cancel();
    _ignoreTimer = Timer(duration, () => _ignored = false);
  }

  void resetAlert() {
    _alerted = false;
    _offRouteAt = null;
  }

  Future<void> _check() async {
    if (_alerted || _ignored || stops.isEmpty) return;

    final pos = await LocationService.getCurrentPosition();
    if (pos == null) return;

    final minDistMeters = stops.fold<double>(
      double.infinity,
      (min, stop) {
        final d = LocationService.distanceMeters(
          pos.latitude,
          pos.longitude,
          stop.latitude,
          stop.longitude,
        );
        return d < min ? d : min;
      },
    );

    if (minDistMeters > 250) {
      _offRouteAt ??= DateTime.now();
      if (DateTime.now().difference(_offRouteAt!).inSeconds >= 90) {
        _alerted = true;
        onDesvio();
      }
    } else {
      _offRouteAt = null;
    }
  }

  void dispose() {
    _timer?.cancel();
    _ignoreTimer?.cancel();
  }
}
