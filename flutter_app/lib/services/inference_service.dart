// lib/services/inference_service.dart
import 'dart:convert';
import 'dart:math' as math;
import 'package:flutter/services.dart';
import 'package:tflite_flutter/tflite_flutter.dart';

import '../models/app_config.dart';

/// Runs the quantised LSTM TFLite model on 128×9 IMU windows.
/// This mirrors TacticalInferencePipeline in the Python ML notebook.
class InferenceService {
  static InferenceService? _instance;
  InferenceService._();
  factory InferenceService() => _instance ??= InferenceService._();

  late Interpreter _interpreter;
  late List<String> _labels;
  late List<double> _rawMean; // length 9
  late List<double> _rawStd; // length 9
  bool _initialised = false;

  Future<void> init() async {
    if (_initialised) return;

    // Load TFLite model
    _interpreter = await Interpreter.fromAsset(AppConfig.tfliteAsset);

    // Load metadata JSON
    final metaStr = await rootBundle.loadString(AppConfig.metadataAsset);
    final meta = json.decode(metaStr) as Map<String, dynamic>;
    _labels = List<String>.from(meta['label_classes'] as List);
    _rawMean = List<double>.from(
      (meta['raw_mean'] as List).map((e) => (e as num).toDouble()),
    );
    _rawStd = List<double>.from(
      (meta['raw_std'] as List).map((e) => (e as num).toDouble()),
    );

    _initialised = true;
  }

  /// sensor: List of 9 channels × 128 samples
  /// Returns {activity, confidence, allProbs}
  Map<String, dynamic> predict(List<List<double>> sensorChannels) {
    assert(sensorChannels.length == 9, 'Need 9 channels');
    assert(
      sensorChannels[0].length == AppConfig.windowSamples,
      'Need 128 samples',
    );

    // Build (1, 128, 9) input tensor normalised by per-channel stats
    final input = List.generate(128, (t) {
      return List.generate(9, (c) {
        return ((sensorChannels[c][t] - _rawMean[c]) / _rawStd[c]);
      });
    });
    final inputTensor = [input]; // shape (1, 128, 9)

    // Output: (1, n_classes)
    final outputTensor = [List<double>.filled(_labels.length, 0.0)];

    _interpreter.run(inputTensor, outputTensor);
    final probs = outputTensor[0];
    final maxIdx = probs.indexOf(probs.reduce(math.max));

    return {
      'activity': _labels[maxIdx],
      'confidence': probs[maxIdx],
      'allProbs': {
        for (int i = 0; i < _labels.length; i++) _labels[i]: probs[i],
      },
    };
  }
}
