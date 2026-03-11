# Spec 12 — Map Pick Mode: seleccionar destino/origen tocando el mapa

## Por qué es importante

Cuando Nominatim no encuentra la dirección exacta o el usuario quiere ser más preciso,
puede tocar directamente en el mapa para seleccionar el punto.

## Flujo

1. En PlannerScreen, el campo de origen o destino tiene un ícono de mapa al lado
2. Usuario toca el ícono → navega a `MapPickScreen` (pantalla full-screen)
3. El mapa se abre centrado en la posición actual del usuario
4. Una mira (crosshair) permanece **fija en el centro** de la pantalla
5. El usuario mueve el mapa hasta posicionar la mira donde quiere
6. Toca **"Confirmar"** → se hace reverse geocoding con Nominatim `/reverse`
7. Vuelve al planner con el resultado (`NominatimResult`)
8. El campo se actualiza automáticamente con el nombre del lugar

---

## Step 1 — Strings

**Archivo:** `lib/core/l10n/strings.dart`

Agregar:
```dart
static const mapPickTitle = 'Seleccionar en mapa';
static const mapPickInstruction = 'Mueve el mapa hasta el punto deseado';
static const mapPickConfirm = 'Confirmar punto';
static const mapPickGeocoding = 'Identificando dirección...';
static const mapPickError = 'No se pudo identificar el punto. Intenta de nuevo.';
```

---

## Step 2 — MapPickScreen (nueva pantalla)

**Archivo:** `lib/features/map/screens/map_pick_screen.dart` (nuevo)

```dart
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/l10n/strings.dart';
import '../../../core/location/location_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/app_snackbar.dart';
import '../../planner/models/nominatim_result.dart';
import '../../planner/providers/planner_notifier.dart';

class MapPickScreen extends ConsumerStatefulWidget {
  const MapPickScreen({super.key});

  @override
  ConsumerState<MapPickScreen> createState() => _MapPickScreenState();
}

class _MapPickScreenState extends ConsumerState<MapPickScreen> {
  final MapController _mapController = MapController();
  bool _loading = false;

  // Centro inicial: posición del usuario o Barranquilla
  LatLng _center = const LatLng(10.9685, -74.7813);

  @override
  void initState() {
    super.initState();
    Future<void>(() async {
      final pos = await LocationService.getCurrentPosition();
      if (pos != null && mounted) {
        setState(() => _center = LatLng(pos.latitude, pos.longitude));
        _mapController.move(_center, 15);
      }
    });
  }

  @override
  void dispose() {
    _mapController.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    setState(() => _loading = true);

    final center = _mapController.camera.center;

    try {
      final dio = ref.read(nominatimDioProvider);
      final response = await dio.get<Map<String, dynamic>>(
        '/reverse',
        queryParameters: <String, dynamic>{
          'lat': center.latitude,
          'lon': center.longitude,
          'format': 'jsonv2',
        },
      );

      if (!mounted) return;

      final data = response.data;
      if (data == null || data['error'] != null) {
        // Reverse geocode failed → use coordinates as display name
        final result = NominatimResult(
          displayName:
              '${center.latitude.toStringAsFixed(5)}, ${center.longitude.toStringAsFixed(5)}',
          lat: center.latitude,
          lng: center.longitude,
        );
        context.pop(result);
        return;
      }

      final result = NominatimResult.fromJson(data);
      context.pop(result);
    } catch (_) {
      if (!mounted) return;
      setState(() => _loading = false);
      AppSnackbar.show(context, AppStrings.mapPickError, SnackbarType.error);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text(AppStrings.mapPickTitle),
      ),
      body: Stack(
        children: <Widget>[
          // Mapa
          FlutterMap(
            mapController: _mapController,
            options: MapOptions(
              initialCenter: _center,
              initialZoom: 15,
              onMapReady: () {},
            ),
            children: <Widget>[
              TileLayer(
                urlTemplate: AppStrings.osmTileUrl,
                subdomains: AppStrings.osmTileSubdomains,
                userAgentPackageName: AppStrings.osmUserAgent,
              ),
            ],
          ),

          // Mira fija en el centro
          Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                const Icon(
                  Icons.location_pin,
                  color: AppColors.error,
                  size: 44,
                  shadows: <Shadow>[
                    Shadow(color: Colors.black26, blurRadius: 4),
                  ],
                ),
                // El pin visual apunta al centro exacto:
                // el ícono location_pin tiene la punta abajo,
                // así que el centro del mapa está debajo del ícono
                const SizedBox(height: 22), // compensa la mitad del ícono
              ],
            ),
          ),

          // Banner de instrucción (parte superior)
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: Container(
              color: Colors.black.withValues(alpha: 0.55),
              padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
              child: const Text(
                AppStrings.mapPickInstruction,
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white, fontSize: 13),
              ),
            ),
          ),

          // Botón confirmar (parte inferior)
          Positioned(
            bottom: 24,
            left: 24,
            right: 24,
            child: _loading
                ? const Center(
                    child: CircularProgressIndicator(),
                  )
                : AppButton.primary(
                    label: AppStrings.mapPickConfirm,
                    onPressed: _confirm,
                  ),
          ),
        ],
      ),
    );
  }
}
```

---

## Step 3 — Router: agregar ruta /map-pick

**Archivo:** `lib/app.dart`

Agregar import:
```dart
import 'features/map/screens/map_pick_screen.dart';
```

Agregar ruta (fuera del ShellRoute, junto a `/profile/credits`):
```dart
GoRoute(
  path: '/map-pick',
  builder: (BuildContext context, GoRouterState state) => const MapPickScreen(),
),
```

---

## Step 4 — AddressSearchField: agregar botón de mapa opcional

**Archivo:** `lib/features/planner/widgets/address_search_field.dart`

### 4a — Agregar parámetro opcional `onPickFromMap`

```dart
class AddressSearchField extends StatefulWidget {
  final String label;
  final String? initialValue;
  final Future<List<NominatimResult>> Function(String query) onSearch;
  final ValueChanged<NominatimResult> onSelect;
  final VoidCallback? onPickFromMap;   // ← nuevo

  const AddressSearchField({
    required this.label,
    required this.onSearch,
    required this.onSelect,
    this.initialValue,
    this.onPickFromMap,                // ← nuevo
    super.key,
  });
```

### 4b — Agregar ícono de mapa en el suffixIcon del TextField

En el `build()`, cambiar `suffixIcon` para incluir el botón de mapa cuando no está buscando:

```dart
suffixIcon: _isSearching
    ? const Padding(
        padding: EdgeInsets.all(12),
        child: SizedBox(
          width: 16,
          height: 16,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      )
    : widget.onPickFromMap != null
        ? IconButton(
            icon: const Icon(Icons.map_outlined),
            tooltip: AppStrings.mapPickTitle,
            onPressed: widget.onPickFromMap,
          )
        : const Icon(Icons.search),
```

### 4c — Agregar método para actualizar el texto del campo desde fuera

El campo se actualiza cuando hay `initialValue` nuevo via `didUpdateWidget`. Eso ya
está implementado. Solo necesitamos que `PlannerScreen` llame `notifier.setOrigin(result)`
o `notifier.setDestination(result)` con el resultado del pick, lo que ya actualizará
`initialValue` via el state y `didUpdateWidget` actualizará el texto.

---

## Step 5 — PlannerScreen: conectar botón de mapa

**Archivo:** `lib/features/planner/screens/planner_screen.dart`

Reemplazar los dos `AddressSearchField` para pasar `onPickFromMap`:

```dart
AddressSearchField(
  label: AppStrings.originLabel,
  initialValue: selectedOrigin?.displayName,
  onSearch: notifier.searchAddress,
  onSelect: notifier.setOrigin,
  onPickFromMap: () async {
    final result = await context.push<NominatimResult>('/map-pick');
    if (result != null) {
      notifier.setOrigin(result);
    }
  },
),
const SizedBox(height: 10),
AddressSearchField(
  label: AppStrings.destLabel,
  initialValue: selectedDest?.displayName,
  onSearch: notifier.searchAddress,
  onSelect: notifier.setDestination,
  onPickFromMap: () async {
    final result = await context.push<NominatimResult>('/map-pick');
    if (result != null) {
      notifier.setDestination(result);
    }
  },
),
```

**Nota:** `context.push<NominatimResult>('/map-pick')` devuelve `Future<NominatimResult?>`
porque GoRouter tipifica el resultado del pop. Cuando `MapPickScreen` llama
`context.pop(result)`, el valor llega aquí.

---

## Verificación visual esperada

1. En PlannerScreen, ambos campos (origen y destino) muestran un ícono 🗺️ a la derecha
2. Al tocarlo se abre `MapPickScreen`
3. El mapa aparece centrado en la ubicación del usuario
4. Un pin rojo está fijo en el centro de la pantalla mientras el mapa se mueve debajo
5. Banner "Mueve el mapa hasta el punto deseado" en la parte superior
6. Botón "Confirmar punto" en la parte inferior
7. Al confirmar: spinner breve → vuelve al planner → el campo se llena con la dirección
8. Si Nominatim falla, usa las coordenadas como nombre (no falla silenciosamente)

---

## Verification

```bash
~/development/flutter/bin/flutter analyze
```

Must return **0 issues**.

Commit: `feat: map pick mode for origin/destination selection`
