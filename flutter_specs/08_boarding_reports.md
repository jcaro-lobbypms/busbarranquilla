# Spec 08 — Reportes en pantalla de espera del bus

## Web equivalent

`CatchBusMode.tsx` — vista de espera (antes de "Me subí"). Muestra los reportes activos
de la ruta y permite confirmarlos mientras el usuario espera el bus en la parada.

## Problema actual

`BoardingConfirmScreen` solo muestra: info de la ruta + selector de parada de bajada +
botón "Me subí". No hay reportes. El usuario no sabe si hay trancón u otro problema
en la ruta que está esperando.

## Lo que tiene el móvil que se puede reusar

- Widget `RouteReportsList` en `lib/features/trip/widgets/route_reports_list.dart`
- `reportsRepositoryProvider.getRouteReports(routeId)` ya existe
- El socket ya está conectado a la sala `route:{id}` desde spec 03
- Los eventos `route:new_report` y `route:report_confirmed` también se pueden escuchar aquí

---

## Step 1 — Strings

**Archivo:** `lib/core/l10n/strings.dart`

Agregar:
```dart
static const boardingReportsTitle = 'Reportes de la ruta';
static const boardingReportsEmpty = 'Sin reportes activos';
```

---

## Step 2 — BoardingConfirmScreen: cargar y mostrar reportes

**Archivo:** `lib/features/trip/screens/boarding_confirm_screen.dart`

### 2a — Agregar estado para reportes

En `_BoardingConfirmScreenState`, añadir:
```dart
List<Report> _reports = const <Report>[];
```

Agregar import:
```dart
import '../../../core/data/repositories/reports_repository.dart';
import '../../../core/domain/models/report.dart';
import '../widgets/route_reports_list.dart';
```

### 2b — Cargar reportes en `_load()`

Al final del método `_load()`, después de `_loading = false`, cargar los reportes:
```dart
// Al final del método _load(), antes del último setState:
final reportsResult = await ref.read(reportsRepositoryProvider).getRouteReports(widget.routeId);
if (reportsResult is Success<List<Report>>) {
  _reports = reportsResult.data;
}
```

**Nota:** `_load()` ya hace `setState` al final con `_loading = false`. Solo necesitas
agregar `_reports = reportsResult.data` dentro de ese mismo setState block:

```dart
setState(() {
  _route = route;
  _stops = stops;
  _selectedStopId = autoSelected;
  _reports = reportsResult is Success<List<Report>>
      ? (reportsResult as Success<List<Report>>).data
      : const <Report>[];
  _loading = false;
});
```

### 2c — Socket listeners para actualizar reportes en tiempo real

En `initState()`, dentro del `addPostFrameCallback` ya existente (después de
`ref.read(socketServiceProvider).on('route:report_resolved', _onRouteReportResolved)`),
agregar:
```dart
ref.read(socketServiceProvider).on('route:new_report', (_) => _reloadReports());
ref.read(socketServiceProvider).on('route:report_confirmed', (_) => _reloadReports());
```

Agregar método `_reloadReports()`:
```dart
Future<void> _reloadReports() async {
  if (!mounted) return;
  final result = await ref.read(reportsRepositoryProvider).getRouteReports(widget.routeId);
  if (!mounted) return;
  if (result is Success<List<Report>>) {
    setState(() => _reports = result.data);
  }
}
```

### 2d — Limpiar listeners en dispose()

En `dispose()`, después de `socket.off('route:report_resolved')`, agregar:
```dart
ref.read(socketServiceProvider).off('route:new_report');
ref.read(socketServiceProvider).off('route:report_confirmed');
```

### 2e — Mostrar reportes en build()

En `build()`, después del widget `RouteActivityBadge(routeId: widget.routeId)`,
agregar la sección de reportes:
```dart
if (_reports.isNotEmpty) ...<Widget>[
  const SizedBox(height: 16),
  const Divider(),
  const SizedBox(height: 8),
  Text(
    AppStrings.boardingReportsTitle,
    style: Theme.of(context).textTheme.titleSmall,
  ),
  const SizedBox(height: 6),
  RouteReportsList(
    reports: _reports,
    onConfirm: (reportId) async {
      final result = await ref.read(reportsRepositoryProvider).confirm(reportId);
      if (result is Success<void>) {
        await _reloadReports();
      }
    },
  ),
],
```

**Nota importante:** `BoardingConfirmScreen` ya tiene `_showStopList` que puede expandir
la lista de paradas. Si `_showStopList` está activo, los reportes quedan debajo del
Expanded. Para evitar conflictos, coloca los reportes ANTES del `_DropoffRow`, o asegúrate
de que solo se muestren cuando `!_showStopList`. La solución más simple: añadir los
reportes justo después de `RouteActivityBadge` y antes del `Divider` existente.

---

## Verification

```bash
~/development/flutter/bin/flutter analyze
```

Must return **0 issues**.

Commit: `feat: show and confirm route reports in boarding waiting screen`
