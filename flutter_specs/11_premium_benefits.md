# Spec 11 — Premium: botón "Ver beneficios" funcional

## Problema actual

`lib/features/profile/widgets/premium_card.dart:46`:
```dart
AppButton.secondary(
  label: AppStrings.premiumViewBenefits,
  onPressed: () {},   // ← no hace nada
),
```

El botón "Ver beneficios" en el card de usuario premium no tiene acción.

## Web equivalent

La web tiene `/premium` page con la lista de beneficios. En la app móvil es suficiente
con mostrar un `AppBottomSheet` con la lista.

---

## Step 1 — Strings

**Archivo:** `lib/core/l10n/strings.dart`

Agregar:
```dart
static const premiumBenefitsTitle = 'Beneficios Premium';
static const premiumActiveUntil = 'Activo hasta';
```

---

## Step 2 — PremiumCard: hacer funcional el botón "Ver beneficios"

**Archivo:** `lib/features/profile/widgets/premium_card.dart`

Agregar import:
```dart
import '../../../shared/widgets/app_bottom_sheet.dart';
```

Reemplazar `onPressed: () {}` por:
```dart
onPressed: () {
  AppBottomSheet.show<void>(
    context,
    title: AppStrings.premiumBenefitsTitle,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        for (final feature in AppStrings.premiumFeatures) ...<Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              const Icon(Icons.check_circle, color: AppColors.success, size: 18),
              const SizedBox(width: 10),
              Expanded(child: Text(feature)),
            ],
          ),
          const SizedBox(height: 10),
        ],
        if (user.premiumExpiresAt != null) ...<Widget>[
          const Divider(),
          const SizedBox(height: 8),
          Text(
            '${AppStrings.premiumActiveUntil}: ${user.premiumExpiresAt!.formatDate()}',
            style: const TextStyle(
              color: AppColors.success,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ],
    ),
  );
},
```

**Nota:** `context` está disponible en `ConsumerWidget.build(context, ref)`.

---

## Verification

```bash
~/development/flutter/bin/flutter analyze
```

Must return **0 issues**.

Commit: `feat: premium benefits bottom sheet`
