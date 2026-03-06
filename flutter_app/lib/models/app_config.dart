// lib/models/app_config.dart

/// Central configuration — update BACKEND_HOST for deployment.
class AppConfig {
  // Change this to your server IP / domain when running on device
  // static const String backendHost = '10.0.2.2'; // Android emulator → localhost
  static const String backendHost = '192.168.0.105'; // Android emulator → localhost
  static const int backendPort = 8000;
  static const String backendBase = 'http://$backendHost:$backendPort';
  static const String wsBase = 'ws://$backendHost:$backendPort';

  // Inference
  static const String tfliteAsset =
      'assets/models/tactical_lstm_quantised.tflite';
  static const String metadataAsset = 'assets/models/model_metadata.json';

  // Sensor collection
  static const int samplingHz = 50; // 50 Hz target
  static const int windowSamples = 128;
  static const double windowOverlap = 0.5; // 50% overlap
  static const int stepSamples = 64; // samples before new inference

  // Distress threshold (consecutive PRONE_STILL windows before alert)
  static const int proneAlertWindows = 10;
}
