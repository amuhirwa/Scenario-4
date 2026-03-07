// lib/services/sensor_service.dart
import 'dart:async';
import 'package:sensors_plus/sensors_plus.dart';

import '../models/app_config.dart';

typedef SampleCallback = void Function(List<double> sample);

/// Collects 6-channel IMU samples at ~50 Hz and emits completed 128-sample
/// windows to the registered callback, with 50% overlap.
/// Channel order: body_acc_xyz, body_gyro_xyz
/// (model v0.2 — hardware-agnostic, no total_acc)
class SensorService {
  static const int _channels = 6;
  static const int _winSize = AppConfig.windowSamples;
  static const int _step = AppConfig.stepSamples;

  final void Function(List<List<double>> window) onWindow;
  SensorService({required this.onWindow});

  final List<List<double>> _buffer = List.generate(
    _channels,
    (_) => <double>[],
  );

  StreamSubscription<UserAccelerometerEvent>? _bodyAccSub;
  StreamSubscription<GyroscopeEvent>? _gyroSub;

  // Latest raw values to assemble a synchronised sample
  List<double> _latestBodyAcc = [0, 0, 0];
  List<double> _latestGyro = [0, 0, 0];

  Timer? _sampleTimer;

  void start() {
    _bodyAccSub =
        userAccelerometerEventStream(
          samplingPeriod: const Duration(microseconds: 20000), // ~50 Hz
        ).listen((e) {
          _latestBodyAcc = [e.x, e.y, e.z];
        });

    _gyroSub =
        gyroscopeEventStream(
          samplingPeriod: const Duration(microseconds: 20000),
        ).listen((e) {
          _latestGyro = [e.x, e.y, e.z];
        });

    // Sample timer fires at 50 Hz to create synchronised windows
    _sampleTimer = Timer.periodic(
      Duration(microseconds: (1000000 / AppConfig.samplingHz).round()),
      (_) => _pushSample(),
    );
  }

  void _pushSample() {
    final sample = [
      ..._latestBodyAcc, // channels 0-2  acc_xyz
      ..._latestGyro,    // channels 3-5  gyro_xyz
    ];

    for (int c = 0; c < _channels; c++) {
      _buffer[c].add(sample[c]);
    }

    // When we have a full window and it's on a step boundary, emit
    final n = _buffer[0].length;
    if (n >= _winSize && (n - _winSize) % _step == 0) {
      final window = List.generate(
        _channels,
        (c) => _buffer[c].sublist(_buffer[c].length - _winSize),
      );
      onWindow(window);
    }

    // Keep buffer bounded (retain last 2 windows max)
    if (n > _winSize * 2) {
      for (int c = 0; c < _channels; c++) {
        _buffer[c].removeRange(0, _step);
      }
    }
  }

  void stop() {
    _sampleTimer?.cancel();
    _bodyAccSub?.cancel();
    _gyroSub?.cancel();
  }
}
