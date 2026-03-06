// lib/screens/role_select_screen.dart
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'soldier_home_screen.dart';
import 'commander_map_screen.dart';

class RoleSelectScreen extends StatelessWidget {
  const RoleSelectScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1A2E),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              // Logo / title
              const Icon(
                Icons.military_tech,
                size: 80,
                color: Color(0xFF4CAF50),
              ),
              const SizedBox(height: 16),
              Text(
                "Dismounted\nCommander's Associate",
                textAlign: TextAlign.center,
                style: GoogleFonts.inter(
                  fontSize: 26,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
              Text(
                'RDF R&D Prototype v0.1',
                style: GoogleFonts.inter(
                  fontSize: 12,
                  color: Colors.white38,
                  letterSpacing: 1.4,
                ),
              ),
              const SizedBox(height: 60),
              Text(
                'SELECT ROLE',
                style: GoogleFonts.inter(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: Colors.white38,
                  letterSpacing: 2,
                ),
              ),
              const SizedBox(height: 20),

              // ── Soldier button ──────────────────────────────────────────
              _RoleCard(
                icon: Icons.directions_walk,
                title: 'SOLDIER',
                subtitle:
                    'Streams your sensor data\nand current activity status',
                color: const Color(0xFF4CAF50),
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const SoldierHomeScreen()),
                ),
              ),
              const SizedBox(height: 16),

              // ── Commander button ────────────────────────────────────────
              _RoleCard(
                icon: Icons.map_outlined,
                title: 'COMMANDER',
                subtitle: 'Real-time map of\nall section members',
                color: const Color(0xFF1976D2),
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const CommanderMapScreen()),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RoleCard extends StatelessWidget {
  const _RoleCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.color,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color.withOpacity(0.12),
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 24),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: color.withOpacity(0.5)),
          ),
          child: Row(
            children: [
              Icon(icon, size: 40, color: color),
              const SizedBox(width: 20),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: GoogleFonts.inter(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                  Text(
                    subtitle,
                    style: GoogleFonts.inter(
                      fontSize: 12,
                      color: Colors.white60,
                    ),
                  ),
                ],
              ),
              const Spacer(),
              Icon(Icons.arrow_forward_ios, color: color, size: 16),
            ],
          ),
        ),
      ),
    );
  }
}
