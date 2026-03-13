import 'package:flutter/material.dart';

abstract final class AppColors {
  // Paleta principal — alineada con el logo MiBus
  static const primary = Color(0xFF1A5080);        // Azul medio: botones, tabs activos, links
  static const primaryDark = Color(0xFF0B2F52);    // Azul Real Profundo: headers, nav bar, splash
  static const accent = Color(0xFFE7B342);         // Amarillo Mostaza: badges, bordes, detalles
  static const critical = Color(0xFFCD1C2B);       // Rojo Vibrante: acciones críticas

  static const success = Color(0xFF10B981);
  static const warning = Color(0xFFE7B342);        // Usa el mismo amarillo del logo
  static const error = Color(0xFFCD1C2B);          // Usa el mismo rojo del logo
  static const background = Color(0xFFF5F7FA);     // Gris Claro Neutro
  static const surface = Color(0xFFFFFFFF);
  static const textPrimary = Color(0xFF111827);
  static const textSecondary = Color(0xFF6B7280);
  static const divider = Color(0xFFE5E7EB);

  static const routeA = Color(0xFF3B82F6);
  static const routeB = Color(0xFF10B981);
  static const routeC = Color(0xFFF97316);
  static const routeD = Color(0xFF8B5CF6);
  static const routeDefault = Color(0xFF6B7280);

  static Color forRouteCode(String code) {
    if (code.isEmpty) return routeDefault;

    return switch (code[0].toUpperCase()) {
      'A' => routeA,
      'B' => routeB,
      'C' => routeC,
      'D' => routeD,
      _ => routeDefault,
    };
  }

  static Color forDistance(int meters) {
    if (meters <= 300) return success;
    if (meters <= 600) return warning;
    return error;
  }
}
