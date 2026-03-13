import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/l10n/strings.dart';
import 'core/storage/onboarding_storage.dart' show onboardingDoneProvider;
import 'core/theme/app_theme.dart';
import 'features/auth/providers/auth_notifier.dart';
import 'features/auth/providers/auth_state.dart';
import 'features/auth/screens/login_screen.dart';
import 'features/auth/screens/onboarding_screen.dart';
import 'features/auth/screens/register_screen.dart';
import 'features/auth/screens/splash_screen.dart';
import 'features/map/screens/map_pick_screen.dart';
import 'features/map/screens/map_screen.dart';
import 'features/planner/screens/planner_screen.dart';
import 'features/profile/screens/credits_history_screen.dart';
import 'features/profile/screens/profile_screen.dart';
import 'features/profile/screens/trip_history_screen.dart';
import 'features/shell/main_shell.dart';
import 'features/trip/screens/active_trip_screen.dart';
import 'features/trip/screens/boarding_confirm_screen.dart';
import 'features/trip/screens/boarding_screen.dart';
import 'features/trip/screens/stop_select_screen.dart';

// Notifier that lets GoRouter re-evaluate its redirect when auth/onboarding
// state changes, without recreating the GoRouter instance.
class _RouterRefreshNotifier extends ChangeNotifier {
  void notify() => notifyListeners();
}

final appRouterProvider = Provider<GoRouter>((ref) {
  final refreshNotifier = _RouterRefreshNotifier();

  // Listen to auth and onboarding changes — only notify GoRouter to
  // re-run redirect, never rebuild the router itself.
  ref.listen(authNotifierProvider, (_, __) => refreshNotifier.notify());
  ref.listen(onboardingDoneProvider, (_, __) => refreshNotifier.notify());
  ref.onDispose(refreshNotifier.dispose);

  return GoRouter(
    initialLocation: '/map',
    refreshListenable: refreshNotifier,
    redirect: (context, state) {
      // Read current values at redirect time (not captured at build time).
      final authState = ref.read(authNotifierProvider);
      final onboardingAsync = ref.read(onboardingDoneProvider);

      final isGoingToAuth =
          state.matchedLocation == '/login' || state.matchedLocation == '/register';
      final isLoading = state.matchedLocation == '/loading';
      final isOnboarding = state.matchedLocation == '/onboarding';

      // Onboarding takes priority — skip auth redirect entirely until done.
      final onboardingDone = onboardingAsync.valueOrNull ?? true;
      if (!onboardingDone) {
        return isOnboarding ? null : '/onboarding';
      }

      return switch (authState) {
        AuthInitial() || AuthLoading() => isLoading ? null : '/loading',
        Authenticated() => isLoading || isGoingToAuth ? '/map' : null,
        Unauthenticated() || AuthErrorState() => isGoingToAuth ? null : '/login',
      };
    },
    routes: <RouteBase>[
      GoRoute(
        path: '/loading',
        builder: (BuildContext context, GoRouterState state) => const SplashScreen(),
      ),
      GoRoute(
        path: '/onboarding',
        builder: (BuildContext context, GoRouterState state) => const OnboardingScreen(),
      ),
      GoRoute(
        path: '/login',
        builder: (BuildContext context, GoRouterState state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/register',
        builder: (BuildContext context, GoRouterState state) => const RegisterScreen(),
      ),
      GoRoute(
        path: '/trip/confirm',
        builder: (BuildContext context, GoRouterState state) {
          final routeId = int.tryParse(state.uri.queryParameters['routeId'] ?? '');
          if (routeId == null) {
            return const Scaffold(
              body: Center(child: Text(AppStrings.tripStartError)),
            );
          }
          final destLat = double.tryParse(state.uri.queryParameters['destLat'] ?? '');
          final destLng = double.tryParse(state.uri.queryParameters['destLng'] ?? '');
          return BoardingConfirmScreen(
            routeId: routeId,
            destLat: destLat,
            destLng: destLng,
          );
        },
      ),
      GoRoute(
        path: '/trip/stop-select',
        builder: (BuildContext context, GoRouterState state) {
          final routeId = int.tryParse(state.uri.queryParameters['routeId'] ?? '');
          if (routeId == null) {
            return const Scaffold(
              body: Center(child: Text(AppStrings.tripStartError)),
            );
          }
          final setDestination =
              state.uri.queryParameters['setDestination'] == 'true';
          return StopSelectScreen(routeId: routeId, setDestination: setDestination);
        },
      ),
      GoRoute(
        path: '/profile/credits',
        builder: (BuildContext context, GoRouterState state) => const CreditsHistoryScreen(),
      ),
      GoRoute(
        path: '/profile/trips',
        builder: (BuildContext context, GoRouterState state) => const TripHistoryScreen(),
      ),
      GoRoute(
        path: '/map-pick',
        builder: (BuildContext context, GoRouterState state) {
          final lat = double.tryParse(state.uri.queryParameters['lat'] ?? '');
          final lng = double.tryParse(state.uri.queryParameters['lng'] ?? '');
          return MapPickScreen(initialLat: lat, initialLng: lng);
        },
      ),
      ShellRoute(
        builder: (BuildContext context, GoRouterState state, Widget child) {
          return MainShell(child: child);
        },
        routes: <RouteBase>[
          GoRoute(
            path: '/map',
            builder: (BuildContext context, GoRouterState state) => const MapScreen(),
          ),
          GoRoute(
            path: '/planner',
            builder: (BuildContext context, GoRouterState state) => const PlannerScreen(),
          ),
          GoRoute(
            path: '/trip',
            builder: (BuildContext context, GoRouterState state) => const ActiveTripScreen(),
          ),
          GoRoute(
            path: '/trip/boarding',
            builder: (BuildContext context, GoRouterState state) => const BoardingScreen(),
          ),
          GoRoute(
            path: '/profile',
            builder: (BuildContext context, GoRouterState state) => const ProfileScreen(),
          ),
        ],
      ),
    ],
  );
});

class MiBusApp extends ConsumerWidget {
  const MiBusApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // GoRouter is created once — do NOT watch auth state here.
    // Changes trigger GoRouter.refreshListenable instead.
    final router = ref.watch(appRouterProvider);

    return MaterialApp.router(
      title: AppStrings.appName,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      routerConfig: router,
    );
  }
}
