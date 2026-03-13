import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/domain/models/user.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/extensions/datetime_extensions.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/app_snackbar.dart';
import '../../../shared/widgets/error_view.dart';
import '../../../shared/widgets/loading_indicator.dart';
import '../../auth/providers/auth_notifier.dart';
import '../providers/profile_notifier.dart';
import '../providers/profile_state.dart';
import '../widgets/premium_card.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(profileNotifierProvider);

    if (state is ProfileLoading) {
      return const Scaffold(body: LoadingIndicator());
    }

    if (state is ProfileError) {
      return ErrorView(
        message: state.message,
        onRetry: () => ref.read(profileNotifierProvider.notifier).load(),
      );
    }

    final ready = state as ProfileReady;
    return _ProfileReadyView(state: ready);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

class _ProfileReadyView extends ConsumerWidget {
  final ProfileReady state;
  const _ProfileReadyView({required this.state});

  String _initials(String name) {
    final parts = name.trim().split(' ').where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts[0][0].toUpperCase();
    return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final User user = state.user;
    final topPad = MediaQuery.of(context).padding.top;
    final trialActive = user.trialExpiresAt != null &&
        user.trialExpiresAt!.isAfter(DateTime.now());

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            // ── Hero header ──────────────────────────────────────────────
            Container(
              color: AppColors.primaryDark,
              padding: EdgeInsets.fromLTRB(20, topPad + 16, 20, 24),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: <Widget>[
                  CircleAvatar(
                    radius: 34,
                    backgroundColor: AppColors.accent,
                    child: Text(
                      _initials(user.name),
                      style: const TextStyle(
                        color: AppColors.primaryDark,
                        fontWeight: FontWeight.w800,
                        fontSize: 22,
                      ),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          user.name,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          user.email,
                          style: const TextStyle(
                            color: Colors.white60,
                            fontSize: 13,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 10),
                        Wrap(
                          spacing: 6,
                          runSpacing: 6,
                          children: <Widget>[
                            if (user.role == 'admin')
                              const _HeaderChip(label: 'Admin', color: AppColors.accent),
                            if (user.hasActivePremium && user.premiumExpiresAt != null)
                              _HeaderChip(
                                label:
                                    '${AppStrings.premiumChipActive} ${user.premiumExpiresAt!.formatDate()}',
                                color: AppColors.success,
                              )
                            else if (user.hasActivePremium)
                              const _HeaderChip(
                                label: AppStrings.premiumChipActive,
                                color: AppColors.success,
                              ),
                            if (trialActive)
                              _HeaderChip(
                                label:
                                    '${AppStrings.trialUntilLabel} ${user.trialExpiresAt!.formatDate()}',
                                color: AppColors.accent,
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            // ── Contenido ─────────────────────────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 20, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  // ── Tarjeta de créditos ─────────────────────────────
                  _SectionCard(
                    child: Row(
                      children: <Widget>[
                        Container(
                          width: 50,
                          height: 50,
                          decoration: BoxDecoration(
                            color: AppColors.accent.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(13),
                          ),
                          child: const Icon(
                            Icons.monetization_on_rounded,
                            color: AppColors.accent,
                            size: 28,
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Text(
                                '${state.balance}',
                                style: const TextStyle(
                                  fontSize: 30,
                                  fontWeight: FontWeight.w800,
                                  color: AppColors.accent,
                                  height: 1,
                                ),
                              ),
                              const SizedBox(height: 2),
                              const Text(
                                AppStrings.creditsLabel,
                                style: TextStyle(
                                  color: AppColors.textSecondary,
                                  fontSize: 13,
                                ),
                              ),
                            ],
                          ),
                        ),
                        TextButton(
                          onPressed: () => context.push('/profile/credits'),
                          child: const Text(AppStrings.viewHistory),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 12),

                  // ── Menú de navegación ──────────────────────────────
                  _SectionCard(
                    padding: EdgeInsets.zero,
                    child: Column(
                      children: <Widget>[
                        _MenuTile(
                          icon: Icons.directions_bus_rounded,
                          iconColor: AppColors.primary,
                          title: AppStrings.tripHistoryLink,
                          onTap: () => context.push('/profile/trips'),
                        ),
                        const Divider(height: 1, indent: 56, endIndent: 16),
                        _ReferralTile(user: user, context: context),
                      ],
                    ),
                  ),

                  const SizedBox(height: 12),

                  // ── Premium card ────────────────────────────────────
                  PremiumCard(user: user),

                  const SizedBox(height: 24),

                  // ── Logout ──────────────────────────────────────────
                  AppButton.destructive(
                    label: AppStrings.logoutLabel,
                    onPressed: () async {
                      await ref.read(authNotifierProvider.notifier).logout();
                    },
                  ),

                  const SizedBox(height: 16),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

}

// ─────────────────────────────────────────────────────────────────────────────
// Widgets internos
// ─────────────────────────────────────────────────────────────────────────────

class _SectionCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;
  const _SectionCard({required this.child, this.padding});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: padding ?? const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        boxShadow: const <BoxShadow>[
          BoxShadow(color: Color(0x0D000000), blurRadius: 8, offset: Offset(0, 2)),
        ],
      ),
      child: child,
    );
  }
}

class _MenuTile extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String title;
  final VoidCallback onTap;

  const _MenuTile({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
      leading: Container(
        width: 36,
        height: 36,
        decoration: BoxDecoration(
          color: iconColor.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(9),
        ),
        child: Icon(icon, color: iconColor, size: 20),
      ),
      title: Text(
        title,
        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
      ),
      trailing: const Icon(Icons.chevron_right, color: AppColors.textSecondary, size: 20),
      onTap: onTap,
    );
  }
}

class _ReferralTile extends StatelessWidget {
  final User user;
  final BuildContext context;

  const _ReferralTile({required this.user, required this.context});

  @override
  Widget build(BuildContext ctx) {
    final code = user.referralCode;
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
      leading: Container(
        width: 36,
        height: 36,
        decoration: BoxDecoration(
          color: AppColors.success.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(9),
        ),
        child: const Icon(Icons.people_rounded, color: AppColors.success, size: 20),
      ),
      title: const Text(
        AppStrings.referralCodeSection,
        style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
      ),
      subtitle: code != null
          ? Text(
              code,
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                letterSpacing: 2.5,
                color: AppColors.primary,
              ),
            )
          : const Text(
              AppStrings.referralCodeNone,
              style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
            ),
      trailing: code != null
          ? IconButton(
              icon: const Icon(Icons.copy_rounded, size: 20, color: AppColors.textSecondary),
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: code));
                if (context.mounted) {
                  AppSnackbar.show(
                    context,
                    AppStrings.referralCodeCopied,
                    SnackbarType.success,
                  );
                }
              },
            )
          : null,
      isThreeLine: false,
    );
  }
}

class _HeaderChip extends StatelessWidget {
  final String label;
  final Color color;

  const _HeaderChip({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.18),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}
