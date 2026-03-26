import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/data/repositories/stops_repository.dart';
import '../../../core/domain/models/stop.dart';
import '../../../core/error/result.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/empty_view.dart';
import '../../../shared/widgets/error_view.dart';
import '../../../shared/widgets/loading_indicator.dart';
import '../providers/trip_notifier.dart';
import '../providers/trip_state.dart';

class StopSelectScreen extends ConsumerStatefulWidget {
  final int routeId;

  /// When true, the trip is already active — selecting a stop sets the
  /// destination and activates dropoff alerts instead of starting a new trip.
  final bool setDestination;

  const StopSelectScreen({
    required this.routeId,
    this.setDestination = false,
    super.key,
  });

  @override
  ConsumerState<StopSelectScreen> createState() => _StopSelectScreenState();
}

class _StopSelectScreenState extends ConsumerState<StopSelectScreen> {
  bool _loading = true;
  String? _error;
  List<Stop> _stops = <Stop>[];
  int? _selectedStopId;

  @override
  void initState() {
    super.initState();
    Future<void>(() => _loadStops());
  }

  Future<void> _loadStops() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    final result = await ref.read(stopsRepositoryProvider).listByRoute(widget.routeId);
    switch (result) {
      case Success<List<Stop>>(data: final stops):
        setState(() {
          _stops = stops;
          _loading = false;
        });
      case Failure(error: final error):
        setState(() {
          _error = error.message;
          _loading = false;
        });
    }
  }

  Future<void> _confirm() async {
    if (widget.setDestination) {
      // Trip is already active — find the selected stop and set it as destination.
      if (_selectedStopId == null) return;
      final stop = _stops.firstWhere((s) => s.id == _selectedStopId);
      await ref.read(tripNotifierProvider.notifier).setDestinationStop(stop);
      if (mounted) context.pop();
    } else {
      await ref.read(tripNotifierProvider.notifier).startTrip(
            widget.routeId,
            destinationStopId: _selectedStopId,
          );
      final current = ref.read(tripNotifierProvider);
      if (current is TripActive) {
        if (mounted) context.go('/trip');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isLoadingTrip = !widget.setDestination &&
        ref.watch(tripNotifierProvider.select((s) => s is TripLoading));

    if (_loading) {
      return const Scaffold(body: LoadingIndicator());
    }

    if (_error != null) {
      return ErrorView(message: _error!, onRetry: _loadStops);
    }

    return Scaffold(
      appBar: AppBar(title: const Text(AppStrings.stopSelectTitle)),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              const Text(AppStrings.tripSelectStopOptional),
              const SizedBox(height: 8),
              Expanded(
                child: _stops.isEmpty
                    ? const EmptyView(
                        icon: Icons.pin_drop_outlined,
                        message: AppStrings.tripNoStops,
                      )
                    : ListView.builder(
                        itemCount: _stops.length,
                        itemBuilder: (context, index) {
                          final stop = _stops[index];
                          final selected = stop.id == _selectedStopId;
                          final isRegreso = stop.leg == 'regreso';
                          final legColor = isRegreso ? AppColors.routeC : AppColors.primary;

                          return Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 3),
                            child: Material(
                              color: selected
                                  ? legColor.withValues(alpha: 0.1)
                                  : Colors.transparent,
                              borderRadius: BorderRadius.circular(10),
                              child: InkWell(
                                borderRadius: BorderRadius.circular(10),
                                onTap: () => setState(() => _selectedStopId = stop.id),
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                                  child: Row(
                                    children: <Widget>[
                                      // Indicador de leg
                                      Container(
                                        width: 4,
                                        height: 36,
                                        decoration: BoxDecoration(
                                          color: legColor.withValues(alpha: selected ? 1.0 : 0.35),
                                          borderRadius: BorderRadius.circular(2),
                                        ),
                                      ),
                                      const SizedBox(width: 12),
                                      // Ícono de parada
                                      Icon(
                                        Icons.radio_button_checked,
                                        size: 18,
                                        color: selected ? legColor : AppColors.textSecondary,
                                      ),
                                      const SizedBox(width: 10),
                                      // Nombre
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: <Widget>[
                                            Text(
                                              stop.name,
                                              style: TextStyle(
                                                fontSize: 14,
                                                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                                                color: selected ? legColor : AppColors.textPrimary,
                                              ),
                                            ),
                                            if (stop.leg != null)
                                              Text(
                                                stop.leg == 'ida' ? 'Ida' : 'Regreso',
                                                style: TextStyle(
                                                  fontSize: 11,
                                                  color: legColor.withValues(alpha: 0.8),
                                                  fontWeight: FontWeight.w500,
                                                ),
                                              ),
                                          ],
                                        ),
                                      ),
                                      // Check
                                      if (selected)
                                        Icon(Icons.check_circle_rounded, color: legColor, size: 20),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          );
                        },
                      ),
              ),
              const SizedBox(height: 8),
              AppButton.primary(
                label: widget.setDestination
                    ? AppStrings.confirmButton
                    : AppStrings.tripStartButton,
                isLoading: isLoadingTrip,
                onPressed: isLoadingTrip ? null : _confirm,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
