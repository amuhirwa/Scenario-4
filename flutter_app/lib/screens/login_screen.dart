// lib/screens/login_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../providers/auth_provider.dart';
import 'commander_map_screen.dart';
import 'soldier_home_screen.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey     = GlobalKey<FormState>();
  final _emailCtrl   = TextEditingController();
  final _passCtrl    = TextEditingController();
  bool  _obscure     = true;
  bool  _loading     = false;
  String? _error;

  @override
  void dispose() {
    _emailCtrl.dispose();
    _passCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() { _loading = true; _error = null; });

    final err = await ref.read(authProvider.notifier).login(
      _emailCtrl.text.trim(),
      _passCtrl.text,
    );

    if (!mounted) return;
    setState(() => _loading = false);

    if (err != null) {
      setState(() => _error = err);
      return;
    }

    final user = ref.read(authProvider)!;
    final destination = user.isCommander
        ? const CommanderMapScreen()
        : const SoldierHomeScreen();

    Navigator.pushReplacement(
      context,
      MaterialPageRoute(builder: (_) => destination),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D1117),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 40),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // ── Logo / title ──────────────────────────────────────
                  const Icon(
                    Icons.military_tech_rounded,
                    size: 64,
                    color: Color(0xFF4CAF50),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    "DISMOUNTED\nCOMMANDER'S ASSOCIATE",
                    textAlign: TextAlign.center,
                    style: GoogleFonts.inter(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                      letterSpacing: 1.2,
                      height: 1.4,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'RDF R&D PROTOTYPE v0.2',
                    textAlign: TextAlign.center,
                    style: GoogleFonts.inter(
                      fontSize: 11,
                      color: Colors.white38,
                      letterSpacing: 2,
                    ),
                  ),

                  const SizedBox(height: 48),

                  // ── Sign-in card ──────────────────────────────────────
                  Container(
                    padding: const EdgeInsets.all(28),
                    decoration: BoxDecoration(
                      color: const Color(0xFF161B22),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: const Color(0xFF30363D),
                        width: 1,
                      ),
                    ),
                    child: Form(
                      key: _formKey,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            'SIGN IN',
                            style: GoogleFonts.inter(
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                              color: Colors.white70,
                              letterSpacing: 2,
                            ),
                          ),
                          const SizedBox(height: 20),

                          // Email field
                          TextFormField(
                            controller: _emailCtrl,
                            keyboardType: TextInputType.emailAddress,
                            autocorrect: false,
                            style: GoogleFonts.jetBrainsMono(
                              fontSize: 14,
                              color: Colors.white,
                            ),
                            decoration: _inputDecoration(
                              label: 'Email',
                              icon: Icons.alternate_email_rounded,
                            ),
                            validator: (v) =>
                                (v == null || !v.contains('@'))
                                    ? 'Enter a valid email'
                                    : null,
                          ),
                          const SizedBox(height: 16),

                          // Password field
                          TextFormField(
                            controller: _passCtrl,
                            obscureText: _obscure,
                            style: GoogleFonts.jetBrainsMono(
                              fontSize: 14,
                              color: Colors.white,
                            ),
                            decoration: _inputDecoration(
                              label: 'Password',
                              icon: Icons.lock_outline_rounded,
                            ).copyWith(
                              suffixIcon: IconButton(
                                icon: Icon(
                                  _obscure
                                      ? Icons.visibility_outlined
                                      : Icons.visibility_off_outlined,
                                  color: Colors.white38,
                                  size: 20,
                                ),
                                onPressed: () =>
                                    setState(() => _obscure = !_obscure),
                              ),
                            ),
                            onFieldSubmitted: (_) => _submit(),
                            validator: (v) =>
                                (v == null || v.isEmpty)
                                    ? 'Enter your password'
                                    : null,
                          ),

                          // Error message
                          if (_error != null) ...[
                            const SizedBox(height: 12),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 12,
                                vertical: 10,
                              ),
                              decoration: BoxDecoration(
                                color: Colors.red.withOpacity(0.1),
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(
                                  color: Colors.redAccent.withOpacity(0.4),
                                ),
                              ),
                              child: Row(
                                children: [
                                  const Icon(Icons.error_outline,
                                      color: Colors.redAccent, size: 16),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      _error!,
                                      style: GoogleFonts.inter(
                                        fontSize: 12,
                                        color: Colors.redAccent,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],

                          const SizedBox(height: 20),

                          // Submit button
                          SizedBox(
                            height: 48,
                            child: ElevatedButton(
                              onPressed: _loading ? null : _submit,
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFF238636),
                                foregroundColor: Colors.white,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(10),
                                ),
                              ),
                              child: _loading
                                  ? const SizedBox(
                                      width: 20,
                                      height: 20,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: Colors.white,
                                      ),
                                    )
                                  : Text(
                                      'AUTHENTICATE',
                                      style: GoogleFonts.inter(
                                        fontWeight: FontWeight.bold,
                                        letterSpacing: 1.5,
                                        fontSize: 13,
                                      ),
                                    ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),

                  const SizedBox(height: 24),

                  // hint for demo
                  _HintTile(
                    icon: Icons.map_outlined,
                    role: 'Commander',
                    email: 'commander@rdf.mil',
                    password: 'command3r!',
                  ),
                  const SizedBox(height: 8),
                  _HintTile(
                    icon: Icons.directions_walk_rounded,
                    role: 'Soldier',
                    email: 'soldier@rdf.mil',
                    password: 'soldier123',
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  InputDecoration _inputDecoration({
    required String label,
    required IconData icon,
  }) {
    return InputDecoration(
      labelText: label,
      labelStyle: GoogleFonts.inter(fontSize: 13, color: Colors.white38),
      prefixIcon: Icon(icon, size: 18, color: Colors.white38),
      filled: true,
      fillColor: const Color(0xFF0D1117),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: Color(0xFF30363D)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: Color(0xFF4CAF50), width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: Colors.redAccent),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: Colors.redAccent, width: 1.5),
      ),
    );
  }
}

// ─── Demo-credentials hint tile ───────────────────────────────────────────────
class _HintTile extends StatelessWidget {
  const _HintTile({
    required this.icon,
    required this.role,
    required this.email,
    required this.password,
  });

  final IconData icon;
  final String role, email, password;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFF161B22).withOpacity(0.6),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFF30363D).withOpacity(0.6)),
      ),
      child: Row(
        children: [
          Icon(icon, size: 16, color: Colors.white38),
          const SizedBox(width: 10),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                role,
                style: GoogleFonts.inter(
                  fontSize: 11,
                  color: Colors.white54,
                  fontWeight: FontWeight.w600,
                ),
              ),
              Text(
                '$email  ·  $password',
                style: GoogleFonts.jetBrainsMono(
                  fontSize: 10,
                  color: Colors.white38,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
