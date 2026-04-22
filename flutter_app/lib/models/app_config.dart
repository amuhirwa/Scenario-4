// lib/models/app_config.dart

/// Central configuration — update BACKEND_HOST for deployment.
class AppConfig {
  // Change this to your server IP / domain when running on device
  // static const String backendHost = '10.0.2.2'; // Android emulator → localhost
  static const String backendHost = '192.168.0.205'; // Android emulator → localhost
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
  static const double windowOverlap = 0.75; // 75% overlap → 0.64s update interval
  static const int stepSamples = 32; // samples before new inference (halved for faster updates)

  // Distress threshold (consecutive STATIONARY windows before alert)
  static const int proneAlertWindows = 20;
}
