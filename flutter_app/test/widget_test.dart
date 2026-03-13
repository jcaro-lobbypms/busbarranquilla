import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mibus_flutter/app.dart';

void main() {
  testWidgets('App renders MaterialApp', (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MiBusApp(),
      ),
    );

    expect(find.byType(MaterialApp), findsOneWidget);
  });
}
