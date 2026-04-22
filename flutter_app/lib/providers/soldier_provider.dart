// lib/providers/soldier_provider.dart
import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../models/soldier_status.dart';
import '../services/api_service.dart';
import '../services/sensor_service.dart';

// ─── Soldier identity ─────────────────────────────────────────────────────────
final soldierIdProvider = StateProvider<String>((ref) => 'S001');
final callSignProvider = StateProvider<String>((ref) => 'HAWK-1');

// ─── Current tactical state ────────────────────────────────────────────────────
class SoldierNotifier extends StateNotifier<SoldierStatus?> {
  SoldierNotifier(this._ref) : super(null);

  final Ref _ref;
  SensorService? _sensorService;
  Position? _lastPosition;
  bool _running = false;

  Future<void> start() async {
    if (_running) return;
    _running = true;

    final api = ApiService();
    // Register with backend — non-blocking, continues if server is unreachable
    unawaited(
      api.registerSoldier(
        soldierId: _ref.read(soldierIdProvider),
        callSign: _ref.read(callSignProvider),
        unit: '1 Platoon',
      ),
    );

    // Start GPS
    final permission = await Geolocator.requestPermission().timeout(
      const Duration(seconds: 10),
      onTimeout: () => LocationPermission.denied,
    );
    Geolocator.getPositionStream(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 1,
      ),
    ).listen((pos) => _lastPosition = pos);

    // Start sensors — each window is sent to the backend for inference.
    // If the server is unreachable the window is skipped and state holds the
    // last known value until connectivity is restored.
    _sensorService = SensorService(
      onWindow: (channels) async {
        if (_lastPosition == null) return;
        final serverState = await api.sendSensorWindow(
          soldierId: _ref.read(soldierIdProvider),
          position: _lastPosition!,
          sensorChannels: channels,
        );
        if (serverState != null) {
          state = serverState;
        }
      },
    );
    _sensorService!.start();
  }

  void stop() {
    _sensorService?.stop();
    _running = false;
  }
}

final soldierNotifierProvider =
    StateNotifierProvider<SoldierNotifier, SoldierStatus?>(
      (ref) => SoldierNotifier(ref),
    );
