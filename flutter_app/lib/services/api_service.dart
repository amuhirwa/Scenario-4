// lib/services/api_service.dart
import 'dart:async';
import 'dart:convert';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';

import '../models/app_config.dart';
import '../models/soldier_status.dart';

class ApiService {
  static ApiService? _instance;
  ApiService._();
  factory ApiService() => _instance ??= ApiService._();

  // ─── HTTP ──────────────────────────────────────────────────────────────────

  Future<void> registerSoldier({
    required String soldierId,
    required String callSign,
    required String unit,
  }) async {
    try {
      await http
          .post(
            Uri.parse('${AppConfig.backendBase}/api/soldier/register'),
            headers: {'Content-Type': 'application/json'},
            body: json.encode({
              'soldier_id': soldierId,
              'call_sign': callSign,
              'unit': unit,
            }),
          )
          .timeout(const Duration(seconds: 5));
    } catch (_) {
      // Backend unreachable — continue offline
    }
  }

  Future<SoldierStatus?> sendSensorWindow({
    required String soldierId,
    required Position position,
    required List<List<double>> sensorChannels,
  }) async {
    final body = {
      'soldier_id': soldierId,
      'timestamp': DateTime.now().toUtc().toIso8601String(),
      'location': {
        'latitude': position.latitude,
        'longitude': position.longitude,
        'altitude_m': position.altitude,
        'accuracy_m': position.accuracy,
      },
      'body_acc_x': sensorChannels[0],
      'body_acc_y': sensorChannels[1],
      'body_acc_z': sensorChannels[2],
      'body_gyro_x': sensorChannels[3],
      'body_gyro_y': sensorChannels[4],
      'body_gyro_z': sensorChannels[5],
      'total_acc_x': sensorChannels[6],
      'total_acc_y': sensorChannels[7],
      'total_acc_z': sensorChannels[8],
    };

    try {
      final r = await http
          .post(
            Uri.parse('${AppConfig.backendBase}/api/soldier/report'),
            headers: {'Content-Type': 'application/json'},
            body: json.encode(body),
          )
          .timeout(const Duration(seconds: 5));
      if (r.statusCode == 200) {
        return SoldierStatus.fromJson(
          json.decode(r.body) as Map<String, dynamic>,
        );
      }
    } catch (_) {
      // Offline — swallow and retry next window
    }
    return null;
  }

  Future<List<SoldierStatus>> getForceStatus() async {
    final r = await http
        .get(Uri.parse('${AppConfig.backendBase}/api/force/status'))
        .timeout(const Duration(seconds: 5));
    final data = json.decode(r.body) as Map<String, dynamic>;
    final soldiers = data['soldiers'] as List;
    return soldiers
        .map((s) => SoldierStatus.fromJson(s as Map<String, dynamic>))
        .toList();
  }

  // ─── WebSocket (commander) ─────────────────────────────────────────────────

  WebSocketChannel? _commanderChannel;
  StreamController<SoldierStatus>? _statusController;

  Stream<SoldierStatus> connectCommanderWebSocket() {
    _statusController?.close();
    _statusController = StreamController<SoldierStatus>.broadcast();

    final uri = Uri.parse('${AppConfig.wsBase}/ws/commander');
    _commanderChannel = WebSocketChannel.connect(uri);

    _commanderChannel!.stream.listen(
      (raw) {
        final msg = json.decode(raw as String) as Map<String, dynamic>;
        final event = msg['event'] as String;

        if (event == 'state_update' || event == 'alert') {
          final status = SoldierStatus.fromJson(
            msg['payload'] as Map<String, dynamic>,
          );
          _statusController?.add(status);
        } else if (event == 'force_picture') {
          final soldiers = (msg['payload']['soldiers'] as List)
              .cast<Map<String, dynamic>>();
          for (final s in soldiers) {
            _statusController?.add(SoldierStatus.fromJson(s));
          }
        }
      },
      onError: (_) => _reconnectCommander(),
      onDone: () => _reconnectCommander(),
    );

    // Keep-alive ping every 20 s
    Timer.periodic(const Duration(seconds: 20), (_) {
      try {
        _commanderChannel?.sink.add('ping');
      } catch (_) {}
    });

    return _statusController!.stream;
  }

  Future<void> _reconnectCommander() async {
    await Future.delayed(const Duration(seconds: 3));
    connectCommanderWebSocket();
  }

  void dispose() {
    _commanderChannel?.sink.close();
    _statusController?.close();
  }
}
