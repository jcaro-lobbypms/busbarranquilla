import 'package:flutter/material.dart';

import '../../../core/domain/models/credit_transaction.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/extensions/datetime_extensions.dart';

class CreditHistoryTile extends StatelessWidget {
  final CreditTransaction transaction;

  const CreditHistoryTile({required this.transaction, super.key});

  ({IconData icon, Color color}) _iconFor(CreditTransaction tx) {
    final desc = (tx.description ?? '').toLowerCase();

    if (desc.contains('viaje') ||
        desc.contains('completar') ||
        desc.contains('minuto') ||
        desc.contains('transmit')) {
      return (icon: Icons.directions_bus_rounded, color: AppColors.primary);
    }
    if (desc.contains('reporte') || desc.contains('confirmar')) {
      return (icon: Icons.report_rounded, color: AppColors.warning);
    }
    if (desc.contains('bienvenida') ||
        desc.contains('bono') ||
        desc.contains('bonus') ||
        desc.contains('premium') ||
        desc.contains('racha')) {
      return (icon: Icons.card_giftcard_rounded, color: AppColors.success);
    }
    if (desc.contains('bajada') ||
        desc.contains('alerta') ||
        desc.contains('dropoff')) {
      return (icon: Icons.notifications_active_rounded, color: AppColors.error);
    }
    if (desc.contains('referido') || desc.contains('amigo')) {
      return (icon: Icons.people_rounded, color: AppColors.success);
    }

    // Fallback por monto
    if (tx.amount >= 0) {
      return (icon: Icons.add_circle_rounded, color: AppColors.success);
    }
    return (icon: Icons.remove_circle_rounded, color: AppColors.error);
  }

  @override
  Widget build(BuildContext context) {
    final (:icon, :color) = _iconFor(transaction);
    final isEarn = transaction.amount >= 0;
    final amountColor = isEarn ? AppColors.success : AppColors.error;
    final amount = transaction.amount.abs();

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Row(
        children: <Widget>[
          // Ícono semántico
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(11),
            ),
            child: Icon(icon, color: color, size: 22),
          ),
          const SizedBox(width: 12),
          // Descripción + fecha
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  transaction.description ?? transaction.type,
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  transaction.createdAt?.formatDate() ?? AppStrings.notAvailable,
                  style: const TextStyle(
                    fontSize: 11,
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          // Monto
          Text(
            '${isEarn ? '+' : '-'}$amount',
            style: TextStyle(
              color: amountColor,
              fontWeight: FontWeight.w800,
              fontSize: 16,
            ),
          ),
        ],
      ),
    );
  }
}
