// lib/widgets/activity_badge.dart
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../models/soldier_status.dart';

/// A compact badge showing the tactical state with colour coding.
class ActivityBadge extends StatelessWidget {
  const ActivityBadge({
    super.key,
    required this.activity,
    this.compact = false,
  });

  final String activity;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final info = _activityMap[activity] ?? ActivityInfo.unknown;
    final color = Color(info.colorHex);

    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: compact ? 6 : 10,
        vertical: compact ? 2 : 5,
      ),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(compact ? 6 : 10),
        border: Border.all(color: color.withOpacity(0.5)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(info.emoji, style: TextStyle(fontSize: compact ? 12 : 16)),
          SizedBox(width: compact ? 4 : 6),
          Text(
            info.label,
            style: GoogleFonts.inter(
              fontSize: compact ? 10 : 12,
              color: color,
              fontWeight: FontWeight.bold,
              letterSpacing: 0.5,
            ),
          ),
        ],
      ),
    );
  }
}

const _activityMap = <String, ActivityInfo>{
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
    description: 'Stationary, alert',
  ),
  'PRONE_STILL': ActivityInfo(
    label: 'PRONE',
    emoji: '⚠️',
    colorHex: 0xFFF44336,
    description: 'Prone / possible distress',
  ),
};
