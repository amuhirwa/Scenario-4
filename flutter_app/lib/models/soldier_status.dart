// lib/models/soldier_status.dart
import 'package:latlong2/latlong.dart';

/// Maps to TacticalState from the backend.
class SoldierStatus {
  final String soldierId;
  final DateTime timestamp;
  final LatLng location;
  final double altitude;
  final String activity;
  final double confidence;
  final Map<String, double> allProbs;
  final bool alert;
  final String? alertMessage;

  const SoldierStatus({
    required this.soldierId,
    required this.timestamp,
    required this.location,
    required this.altitude,
    required this.activity,
    required this.confidence,
    required this.allProbs,
    required this.alert,
    this.alertMessage,
  });

  factory SoldierStatus.fromJson(Map<String, dynamic> json) {
    final loc = json['location'] as Map<String, dynamic>;
    return SoldierStatus(
      soldierId: json['soldier_id'] as String,
      timestamp: DateTime.parse(json['timestamp'] as String),
      location: LatLng(
        (loc['latitude'] as num).toDouble(),
        (loc['longitude'] as num).toDouble(),
      ),
      altitude: (loc['altitude_m'] as num?)?.toDouble() ?? 0.0,
      activity: json['activity'] as String,
      confidence: (json['confidence'] as num).toDouble(),
      allProbs: (json['all_probs'] as Map<String, dynamic>).map(
        (k, v) => MapEntry(k, (v as num).toDouble()),
      ),
      alert: json['alert'] as bool? ?? false,
      alertMessage: json['alert_message'] as String?,
    );
  }

  // Color and icon helpers for the UI
  ActivityInfo get activityInfo =>
      _activityMap[activity] ?? ActivityInfo.unknown;
}

class ActivityInfo {
  final String label;
  final String emoji;
  final int colorHex;
  final String description;

  const ActivityInfo({
    required this.label,
    required this.emoji,
    required this.colorHex,
    required this.description,
  });

  static const ActivityInfo unknown = ActivityInfo(
    label: 'UNKNOWN',
    emoji: '❓',
    colorHex: 0xFF9E9E9E,
    description: 'Status unknown',
  );
}

const Map<String, ActivityInfo> _activityMap = {
  'WALKING': ActivityInfo(
    label: 'WALKING',
    emoji: '🚶',
    colorHex: 0xFF4CAF50,
    description: 'Moving on foot',
  ),
  'RUNNING': ActivityInfo(
    label: 'RUNNING',
    emoji: '🏃',
    colorHex: 0xFF2196F3,
    description: 'Fast movement',
  ),
  'CRAWLING': ActivityInfo(
    label: 'CRAWLING',
    emoji: '🪖',
    colorHex: 0xFFFF9800,
    description: 'Low-profile infiltration',
  ),
  'KNEELING_READY': ActivityInfo(
    label: 'KNEELING',
    emoji: '🎯',
    colorHex: 0xFFFFEB3B,
    description: 'Stationary — alert',
  ),
  'PRONE_STILL': ActivityInfo(
    label: 'PRONE',
    emoji: '⚠️',
    colorHex: 0xFFF44336,
    description: 'Prone / possible distress',
  ),
};
