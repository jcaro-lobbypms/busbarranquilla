import '../../../core/domain/models/bus_route.dart';
import '../../../core/domain/models/plan_result.dart';
import '../models/nominatim_result.dart';

sealed class PlannerState {
  const PlannerState();
}

final class PlannerIdle extends PlannerState {
  final NominatimResult? selectedOrigin;
  final NominatimResult? selectedDest;
  final List<BusRoute> nearbyRoutes;

  const PlannerIdle({
    this.selectedOrigin,
    this.selectedDest,
    this.nearbyRoutes = const <BusRoute>[],
  });

  PlannerIdle copyWith({
    NominatimResult? selectedOrigin,
    NominatimResult? selectedDest,
    List<BusRoute>? nearbyRoutes,
  }) {
    return PlannerIdle(
      selectedOrigin: selectedOrigin ?? this.selectedOrigin,
      selectedDest: selectedDest ?? this.selectedDest,
      nearbyRoutes: nearbyRoutes ?? this.nearbyRoutes,
    );
  }
}

final class PlannerLoading extends PlannerState {
  const PlannerLoading();
}

final class PlannerResults extends PlannerState {
  final String originLabel;
  final String destLabel;
  final List<PlanResult> results;
  final NominatimResult? selectedOrigin;
  final NominatimResult? selectedDest;

  const PlannerResults({
    required this.originLabel,
    required this.destLabel,
    required this.results,
    this.selectedOrigin,
    this.selectedDest,
  });

  PlannerResults copyWith({
    String? originLabel,
    String? destLabel,
    List<PlanResult>? results,
    NominatimResult? selectedOrigin,
    NominatimResult? selectedDest,
  }) {
    return PlannerResults(
      originLabel: originLabel ?? this.originLabel,
      destLabel: destLabel ?? this.destLabel,
      results: results ?? this.results,
      selectedOrigin: selectedOrigin ?? this.selectedOrigin,
      selectedDest: selectedDest ?? this.selectedDest,
    );
  }
}

final class PlannerError extends PlannerState {
  final String message;

  const PlannerError(this.message);
}
