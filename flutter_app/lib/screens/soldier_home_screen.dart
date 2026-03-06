// lib/screens/soldier_home_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_spinkit/flutter_spinkit.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:fl_chart/fl_chart.dart';

import '../models/soldier_status.dart';
import '../models/app_config.dart';
import '../providers/soldier_provider.dart';
import '../widgets/activity_badge.dart';

class SoldierHomeScreen extends ConsumerStatefulWidget {
  const SoldierHomeScreen({super.key});

  @override
  ConsumerState<SoldierHomeScreen> createState() => _SoldierHomeScreenState();
}

class _SoldierHomeScreenState extends ConsumerState<SoldierHomeScreen> {
  bool _started = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      await ref.read(soldierNotifierProvider.notifier).start();
      setState(() => _started = true);
    });
  }

  @override
  void dispose() {
    ref.read(soldierNotifierProvider.notifier).stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final status = ref.watch(soldierNotifierProvider);

    return Scaffold(
      backgroundColor: const Color(0xFF0D1117),
      appBar: AppBar(
        backgroundColor: const Color(0xFF161B22),
        title: Text(
          'SOLDIER STATUS',
          style: GoogleFonts.inter(
            fontSize: 14,
            letterSpacing: 2,
            fontWeight: FontWeight.w600,
          ),
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: _started
                      ? Colors.green.withOpacity(0.2)
                      : Colors.grey.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: _started ? Colors.green : Colors.grey,
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 8,
                      height: 8,
                      decoration: BoxDecoration(
                        color: _started ? Colors.greenAccent : Colors.grey,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      _started ? 'LIVE' : 'STARTING',
                      style: GoogleFonts.inter(
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        color: _started ? Colors.greenAccent : Colors.grey,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
      body: status == null
          ? Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  SpinKitRipple(color: Colors.green.shade400, size: 80),
                  const SizedBox(height: 24),
                  Text(
                    'Initialising sensors…',
                    style: GoogleFonts.inter(color: Colors.white54),
                  ),
                ],
              ),
            )
          : _buildContent(context, status),
    );
  }

  Widget _buildContent(BuildContext context, SoldierStatus status) {
    final info = status.activityInfo;
    final color = Color(info.colorHex);

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Alert banner ─────────────────────────────────────────────────
          if (status.alert)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: Colors.red.withOpacity(0.15),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.red.shade400),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.warning_amber_rounded,
                    color: Colors.redAccent,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      status.alertMessage ?? 'DISTRESS DETECTED',
                      style: GoogleFonts.inter(
                        color: Colors.redAccent,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ),
            ),

          // ── Main activity card ────────────────────────────────────────────
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: color.withOpacity(0.08),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: color.withOpacity(0.4), width: 1.5),
            ),
            child: Column(
              children: [
                Text(info.emoji, style: const TextStyle(fontSize: 72)),
                const SizedBox(height: 12),
                Text(
                  info.label,
                  style: GoogleFonts.inter(
                    fontSize: 28,
                    fontWeight: FontWeight.bold,
                    color: color,
                  ),
                ),
                Text(
                  info.description,
                  style: GoogleFonts.inter(fontSize: 14, color: Colors.white54),
                ),
                const SizedBox(height: 16),
                // Confidence bar
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: LinearProgressIndicator(
                    value: status.confidence,
                    backgroundColor: Colors.white12,
                    valueColor: AlwaysStoppedAnimation<Color>(color),
                    minHeight: 10,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  '${(status.confidence * 100).toStringAsFixed(1)}% confidence',
                  style: GoogleFonts.inter(fontSize: 12, color: Colors.white38),
                ),
              ],
            ),
          ),

          const SizedBox(height: 20),

          // ── GPS info ──────────────────────────────────────────────────────
          _InfoTile(
            icon: Icons.location_on,
            label: 'LOCATION',
            value:
                '${status.location.latitude.toStringAsFixed(5)}°N  '
                '${status.location.longitude.toStringAsFixed(5)}°E  '
                '${status.altitude.toStringAsFixed(0)}m',
            color: Colors.blueAccent,
          ),
          const SizedBox(height: 10),
          _InfoTile(
            icon: Icons.access_time,
            label: 'LAST UPDATE',
            value: status.timestamp.toLocal().toString().substring(11, 19),
            color: Colors.white38,
          ),
          const SizedBox(height: 20),

          // ── Probability bars ──────────────────────────────────────────────
          Text(
            'ACTIVITY PROBABILITIES',
            style: GoogleFonts.inter(
              fontSize: 11,
              letterSpacing: 2,
              color: Colors.white38,
            ),
          ),
          const SizedBox(height: 10),
          ...status.allProbs.entries.map(
            (e) => _ProbBar(
              label: e.key,
              value: e.value,
              highlight: e.key == status.activity,
            ),
          ),

          const SizedBox(height: 24),
          Text(
            'Transmitting to backend: ${AppConfig.backendBase}',
            style: GoogleFonts.inter(fontSize: 10, color: Colors.white24),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

class _InfoTile extends StatelessWidget {
  const _InfoTile({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });
  final IconData icon;
  final String label, value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 16, color: color),
        const SizedBox(width: 8),
        Text(
          '$label  ',
          style: GoogleFonts.inter(fontSize: 11, color: Colors.white38),
        ),
        Expanded(
          child: Text(
            value,
            style: GoogleFonts.inter(
              fontSize: 13,
              color: Colors.white,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
      ],
    );
  }
}

class _ProbBar extends StatelessWidget {
  const _ProbBar({
    required this.label,
    required this.value,
    required this.highlight,
  });
  final String label;
  final double value;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    final info = _activityMap[label];
    final color = info != null ? Color(info.colorHex) : Colors.grey;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          SizedBox(
            width: 120,
            child: Text(
              label,
              style: GoogleFonts.inter(
                fontSize: 11,
                color: highlight ? color : Colors.white38,
                fontWeight: highlight ? FontWeight.bold : FontWeight.normal,
              ),
            ),
          ),
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: value,
                backgroundColor: Colors.white10,
                valueColor: AlwaysStoppedAnimation<Color>(
                  highlight ? color : color.withOpacity(0.4),
                ),
                minHeight: 8,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            '${(value * 100).toStringAsFixed(0)}%',
            style: GoogleFonts.inter(
              fontSize: 11,
              color: highlight ? color : Colors.white38,
            ),
          ),
        ],
      ),
    );
  }
}

// Re-export from soldier_status.dart for local use in this file
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
    description: 'Low-profile',
  ),
  'KNEELING_READY': ActivityInfo(
    label: 'KNEELING_READY',
    emoji: '🎯',
    colorHex: 0xFFFFEB3B,
    description: 'Alert',
  ),
  'PRONE_STILL': ActivityInfo(
    label: 'PRONE_STILL',
    emoji: '⚠️',
    colorHex: 0xFFF44336,
    description: 'Prone',
  ),
};
