import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/theme/app_colors.dart';

class UserMarkerLayer extends StatelessWidget {
  final LatLng position;
  final bool isOnTrip;

  const UserMarkerLayer({
    required this.position,
    this.isOnTrip = false,
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    return MarkerLayer(
      markers: <Marker>[
        Marker(
          point: position,
          width: isOnTrip ? 34 : 20,
          height: isOnTrip ? 34 : 20,
          child: isOnTrip
              ? Container(
                  decoration: BoxDecoration(
                    color: AppColors.success,
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.white, width: 2),
                    boxShadow: <BoxShadow>[
                      BoxShadow(
                        color: AppColors.success.withValues(alpha: 0.4),
                        blurRadius: 8,
                        spreadRadius: 2,
                      ),
                    ],
                  ),
                  child: const Icon(Icons.directions_bus, color: Colors.white, size: 18),
                )
              : Container(
                  decoration: BoxDecoration(
                    color: AppColors.primary,
                    shape: BoxShape.circle,
                    border: Border.all(color: AppColors.surface, width: 3),
                    boxShadow: <BoxShadow>[
                      BoxShadow(
                        color: AppColors.textSecondary.withValues(alpha: 0.26),
                        blurRadius: 4,
                        offset: const Offset(0, 2),
                      ),
                    ],
                  ),
                ),
        ),
      ],
    );
  }
}
