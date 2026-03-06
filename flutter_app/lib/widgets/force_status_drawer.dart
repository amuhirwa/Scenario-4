// lib/widgets/force_status_drawer.dart
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';

import '../models/soldier_status.dart';
import 'activity_badge.dart';

/// Side drawer for the commander map showing the full section/platoon list.
class ForceStatusDrawer extends StatelessWidget {
  const ForceStatusDrawer({super.key, required this.soldiers});

  final List<SoldierStatus> soldiers;

  @override
  Widget build(BuildContext context) {
    final sorted = [...soldiers]
      ..sort((a, b) {
        // Alerts first, then alphabetical
        if (a.alert != b.alert) return a.alert ? -1 : 1;
        return a.soldierId.compareTo(b.soldierId);
      });

    return Drawer(
      backgroundColor: const Color(0xFF0D1117),
      child: SafeArea(
        child: Column(
          children: [
            // Header
            Container(
              padding: const EdgeInsets.all(16),
              color: const Color(0xFF161B22),
              child: Row(
                children: [
                  const Icon(Icons.people, color: Color(0xFF4CAF50)),
                  const SizedBox(width: 10),
                  Text(
                    'FORCE PICTURE',
                    style: GoogleFonts.inter(
                      fontSize: 14,
                      letterSpacing: 2,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                  const Spacer(),
                  Text(
                    '${soldiers.length}',
                    style: GoogleFonts.inter(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: const Color(0xFF4CAF50),
                    ),
                  ),
                ],
              ),
            ),

            // Summary chips
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              child: Wrap(
                spacing: 8,
                runSpacing: 6,
                children: _activitySummary(soldiers).entries.map((e) {
                  return Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: Color(e.value.$2).withOpacity(0.15),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: Color(e.value.$2).withOpacity(0.5),
                      ),
                    ),
                    child: Text(
                      '${e.value.$1}× ${e.key}',
                      style: GoogleFonts.inter(
                        fontSize: 10,
                        color: Color(e.value.$2),
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  );
                }).toList(),
              ),
            ),

            const Divider(color: Colors.white12, height: 1),

            // Soldier list
            Expanded(
              child: ListView.separated(
                itemCount: sorted.length,
                separatorBuilder: (_, __) =>
                    const Divider(color: Colors.white12, height: 1, indent: 16),
                itemBuilder: (_, i) => _SoldierTile(status: sorted[i]),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Map<String, (int, int)> _activitySummary(List<SoldierStatus> soldiers) {
    final m = <String, (int, int)>{};
    for (final s in soldiers) {
      final info = s.activityInfo;
      final count = (m[s.activity]?.$1 ?? 0) + 1;
      m[s.activity] = (count, info.colorHex);
    }
    return m;
  }
}

class _SoldierTile extends StatelessWidget {
  const _SoldierTile({required this.status});
  final SoldierStatus status;

  @override
  Widget build(BuildContext context) {
    final info = status.activityInfo;

    return ListTile(
      leading: Stack(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: Color(info.colorHex).withOpacity(0.15),
              border: Border.all(
                color: status.alert
                    ? Colors.redAccent
                    : Color(info.colorHex).withOpacity(0.5),
              ),
            ),
            child: Center(
              child: Text(info.emoji, style: const TextStyle(fontSize: 20)),
            ),
          ),
          if (status.alert)
            Positioned(
              right: 0,
              top: 0,
              child: Container(
                width: 12,
                height: 12,
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.redAccent,
                ),
              ),
            ),
        ],
      ),
      title: Row(
        children: [
          Text(
            status.soldierId,
            style: GoogleFonts.inter(
              fontSize: 14,
              fontWeight: FontWeight.bold,
              color: Colors.white,
            ),
          ),
          const SizedBox(width: 8),
          ActivityBadge(activity: status.activity, compact: true),
        ],
      ),
      subtitle: Text(
        '${status.location.latitude.toStringAsFixed(4)}°N  '
        '${status.location.longitude.toStringAsFixed(4)}°E  •  '
        '${DateFormat('HH:mm:ss').format(status.timestamp.toLocal())}',
        style: GoogleFonts.inter(fontSize: 10, color: Colors.white38),
      ),
      trailing: Text(
        '${(status.confidence * 100).toStringAsFixed(0)}%',
        style: GoogleFonts.inter(
          fontSize: 13,
          fontWeight: FontWeight.bold,
          color: Color(info.colorHex),
        ),
      ),
    );
  }
}
