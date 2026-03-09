import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/theme/app_colors.dart';

class UserMarkerLayer extends StatelessWidget {
  final LatLng position;

  const UserMarkerLayer({
    required this.position,
    super.key,
  });

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
