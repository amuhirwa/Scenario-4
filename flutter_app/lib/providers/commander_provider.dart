// lib/providers/commander_provider.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/soldier_status.dart';
import '../services/api_service.dart';

/// Maintains a live map of all soldiers the commander can see.
class CommanderNotifier extends StateNotifier<Map<String, SoldierStatus>> {
  CommanderNotifier() : super({}) {
    _connect();
  }

  void _connect() {
    ApiService().connectCommanderWebSocket().listen((status) {
      state = {...state, status.soldierId: status};
    });
  }

  List<SoldierStatus> get soldiers => state.values.toList();
  List<SoldierStatus> get alerts => state.values.where((s) => s.alert).toList();
}

final commanderProvider =
    StateNotifierProvider<CommanderNotifier, Map<String, SoldierStatus>>(
      (ref) => CommanderNotifier(),
    );

final alertCountProvider = Provider((ref) {
  final soldiers = ref.watch(commanderProvider);
  return soldiers.values.where((s) => s.alert).length;
});
