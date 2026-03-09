import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/theme/app_colors.dart';
import '../../planner/providers/planner_notifier.dart';
import '../../planner/providers/planner_state.dart';

class PlanMarkersLayer extends ConsumerWidget {
  const PlanMarkersLayer({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final planState = ref.watch(plannerNotifierProvider);

    LatLng? origin;
    LatLng? dest;

    switch (planState) {
      case PlannerIdle(selectedOrigin: final o, selectedDest: final d):
        if (o != null) origin = LatLng(o.lat, o.lng);
        if (d != null) dest = LatLng(d.lat, d.lng);
      case PlannerResults(selectedOrigin: final o, selectedDest: final d):
        if (o != null) origin = LatLng(o.lat, o.lng);
        if (d != null) dest = LatLng(d.lat, d.lng);
      default:
        break;
    }

    if (origin == null && dest == null) return const SizedBox.shrink();

    return MarkerLayer(
      markers: <Marker>[
        if (origin != null)
          Marker(
            point: origin,
            width: 34,
            height: 34,
            child: const _PinMarker(
              icon: Icons.trip_origin,
              color: Color(0xFF43A047),
            ),
          ),
        if (dest != null)
          Marker(
            point: dest,
            width: 38,
            height: 38,
            alignment: Alignment.topCenter,
            child: const _PinMarker(
              icon: Icons.location_on,
              color: AppColors.error,
            ),
          ),
      ],
    );
  }
}

class _PinMarker extends StatelessWidget {
  final IconData icon;
  final Color color;

  const _PinMarker({required this.icon, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        shape: BoxShape.circle,
        boxShadow: <BoxShadow>[
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.22),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Icon(icon, color: color, size: 22),
    );
  }
}
