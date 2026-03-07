// lib/screens/commander_map_screen.dart
import 'package:badges/badges.dart' as badges;
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:latlong2/latlong.dart';

import '../models/soldier_status.dart';
import '../providers/commander_provider.dart';
import '../widgets/activity_badge.dart';
import '../widgets/force_status_drawer.dart';

class CommanderMapScreen extends ConsumerStatefulWidget {
  const CommanderMapScreen({super.key});

  @override
  ConsumerState<CommanderMapScreen> createState() => _CommanderMapScreenState();
}

class _CommanderMapScreenState extends ConsumerState<CommanderMapScreen> {
  final MapController _mapController = MapController();

  // Default centre — Musanze/Ruhengeri area, Northern Province, Rwanda
  static const LatLng _defaultCentre = LatLng(-1.4993, 29.6340);
  static const double _defaultZoom = 14.5;

  SoldierStatus? _selected;

  @override
  Widget build(BuildContext context) {
    final soldiers = ref.watch(commanderProvider);
    final alertCount = ref.watch(alertCountProvider);

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: const Color(0xFF161B22),
        title: Row(
          children: [
            const Icon(Icons.radar, color: Color(0xFF4CAF50), size: 20),
            const SizedBox(width: 8),
            Text(
              'MAP',
              style: GoogleFonts.inter(
                fontSize: 14,
                letterSpacing: 2,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: Colors.green.withOpacity(0.15),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: Colors.green.withOpacity(0.5)),
              ),
              child: Text(
                '${soldiers.length} SOLDIERS',
                style: GoogleFonts.inter(
                  fontSize: 10,
                  color: Colors.greenAccent,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ),
        actions: [
          // Alert badge
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: badges.Badge(
              showBadge: alertCount > 0,
              badgeContent: Text(
                '$alertCount',
                style: const TextStyle(color: Colors.white, fontSize: 10),
              ),
              badgeStyle: const badges.BadgeStyle(badgeColor: Colors.redAccent),
              child: IconButton(
                icon: const Icon(Icons.warning_amber_rounded),
                color: alertCount > 0 ? Colors.redAccent : Colors.white38,
                onPressed: () => _showAlerts(context, soldiers),
              ),
            ),
          ),
          // Force picture drawer
          Builder(
            builder: (ctx) => IconButton(
              icon: const Icon(Icons.view_list_rounded),
              onPressed: () => Scaffold.of(ctx).openEndDrawer(),
            ),
          ),
        ],
      ),
      endDrawer: ForceStatusDrawer(soldiers: soldiers.values.toList()),

      body: Stack(
        children: [
          // ── Full-screen map ─────────────────────────────────────────────
          FlutterMap(
            mapController: _mapController,
            options: MapOptions(
              initialCenter: _defaultCentre,
              initialZoom: _defaultZoom,
              onTap: (_, __) => setState(() => _selected = null),
            ),
            children: [
              // OSM tile layer (works offline if tiles are cached)
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.rdf.dismountedassociate',
              ),
              // Soldier markers
              MarkerLayer(
                markers: soldiers.values.map((s) => _buildMarker(s)).toList(),
              ),
            ],
          ),

          // ── Legend ──────────────────────────────────────────────────────
          Positioned(top: 12, left: 12, child: _Legend()),

          // ── Selected soldier detail card ──────────────────────────────
          if (_selected != null)
            Positioned(
              bottom: 0,
              left: 0,
              right: 0,
              child: _SoldierDetailCard(
                status: _selected!,
                onClose: () => setState(() => _selected = null),
              ),
            ),
        ],
      ),
    );
  }

  Marker _buildMarker(SoldierStatus s) {
    final info = s.activityInfo;
    final color = Color(info.colorHex);
    final isSelected = _selected?.soldierId == s.soldierId;

    return Marker(
      point: s.location,
      width: isSelected ? 80 : 60,
      height: isSelected ? 80 : 60,
      child: GestureDetector(
        onTap: () {
          setState(() => _selected = s);
          _mapController.move(s.location, _mapController.camera.zoom);
        },
        child: Column(
          children: [
            // Pulsing alert ring
            AnimatedContainer(
              duration: const Duration(milliseconds: 300),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: s.alert ? Colors.red : color,
                  width: isSelected ? 3 : 2,
                ),
                color: color.withOpacity(0.25),
                boxShadow: s.alert
                    ? [
                        BoxShadow(
                          color: Colors.red.withOpacity(0.6),
                          blurRadius: 12,
                          spreadRadius: 4,
                        ),
                      ]
                    : [],
              ),
              width: isSelected ? 50 : 40,
              height: isSelected ? 50 : 40,
              child: Center(
                child: Text(
                  info.emoji,
                  style: TextStyle(fontSize: isSelected ? 22 : 18),
                ),
              ),
            ),
            // Call-sign label
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
              decoration: BoxDecoration(
                color: Colors.black87,
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                s.soldierId,
                style: GoogleFonts.inter(
                  fontSize: 9,
                  color: color,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showAlerts(BuildContext context, Map<String, SoldierStatus> soldiers) {
    final alerts = soldiers.values.where((s) => s.alert).toList();
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF1A1A2E),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '⚠️  ACTIVE ALERTS',
              style: GoogleFonts.inter(
                fontWeight: FontWeight.bold,
                fontSize: 16,
                color: Colors.redAccent,
              ),
            ),
            const Divider(color: Colors.white12),
            if (alerts.isEmpty)
              Text(
                'No active alerts',
                style: GoogleFonts.inter(color: Colors.white38),
              )
            else
              ...alerts.map(
                (s) => ListTile(
                  leading: const Icon(
                    Icons.warning_amber_rounded,
                    color: Colors.redAccent,
                  ),
                  title: Text(
                    s.soldierId,
                    style: GoogleFonts.inter(color: Colors.white),
                  ),
                  subtitle: Text(
                    s.alertMessage ?? '',
                    style: GoogleFonts.inter(
                      color: Colors.redAccent,
                      fontSize: 12,
                    ),
                  ),
                  trailing: Text(
                    DateFormat('HH:mm:ss').format(s.timestamp.toLocal()),
                    style: GoogleFonts.inter(
                      color: Colors.white38,
                      fontSize: 11,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

// ─── Legend ───────────────────────────────────────────────────────────────────
class _Legend extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    const items = [
      ('🚶', 'WALKING', 0xFF4CAF50),
      ('🏃', 'RUNNING', 0xFF2196F3),
      ('🪖', 'CRAWLING', 0xFFFF9800),
      ('🎯', 'KNEELING', 0xFFFFEB3B),
      ('⚠️', 'PRONE / ALERT', 0xFFF44336),
    ];
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.75),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: items
            .map(
              (it) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(it.$1, style: const TextStyle(fontSize: 13)),
                    const SizedBox(width: 6),
                    Text(
                      it.$2,
                      style: TextStyle(
                        fontSize: 10,
                        color: Color(it.$3),
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              ),
            )
            .toList(),
      ),
    );
  }
}

// ─── Selected soldier detail card ─────────────────────────────────────────────
class _SoldierDetailCard extends StatelessWidget {
  const _SoldierDetailCard({required this.status, required this.onClose});
  final SoldierStatus status;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final info = status.activityInfo;
    final color = Color(info.colorHex);

    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF161B22),
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        border: Border(
          top: BorderSide(color: color.withOpacity(0.4), width: 1.5),
        ),
      ),
      padding: const EdgeInsets.all(20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Text(info.emoji, style: const TextStyle(fontSize: 36)),
              const SizedBox(width: 14),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    status.soldierId,
                    style: GoogleFonts.inter(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                  Text(
                    info.label,
                    style: GoogleFonts.inter(fontSize: 14, color: color),
                  ),
                ],
              ),
              const Spacer(),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    '${(status.confidence * 100).toStringAsFixed(0)}%',
                    style: GoogleFonts.inter(
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                      color: color,
                    ),
                  ),
                  Text(
                    'confidence',
                    style: GoogleFonts.inter(
                      fontSize: 10,
                      color: Colors.white38,
                    ),
                  ),
                ],
              ),
              const SizedBox(width: 8),
              IconButton(
                onPressed: onClose,
                icon: const Icon(Icons.close, color: Colors.white38),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              const Icon(Icons.location_pin, size: 14, color: Colors.white38),
              const SizedBox(width: 4),
              Text(
                '${status.location.latitude.toStringAsFixed(5)}°N  '
                '${status.location.longitude.toStringAsFixed(5)}°E  '
                '${status.altitude.toStringAsFixed(0)}m',
                style: GoogleFonts.inter(fontSize: 11, color: Colors.white54),
              ),
              const Spacer(),
              Text(
                DateFormat('HH:mm:ss').format(status.timestamp.toLocal()),
                style: GoogleFonts.inter(fontSize: 11, color: Colors.white38),
              ),
            ],
          ),
          if (status.alert) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.red.withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.redAccent.withOpacity(0.4)),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.warning_amber_rounded,
                    color: Colors.redAccent,
                    size: 16,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      status.alertMessage ?? 'DISTRESS',
                      style: GoogleFonts.inter(
                        color: Colors.redAccent,
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
