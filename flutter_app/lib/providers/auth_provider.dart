// lib/providers/auth_provider.dart
import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import '../models/app_config.dart';
import '../models/auth_user.dart';

// Holds the currently signed-in user (null = not signed in)
class AuthNotifier extends StateNotifier<AuthUser?> {
  AuthNotifier() : super(null);

  /// Calls POST /api/auth/login. Returns null on success or an error string.
  Future<String?> login(String email, String password) async {
    try {
      final r = await http
          .post(
            Uri.parse('${AppConfig.backendBase}/api/auth/login'),
            headers: {'Content-Type': 'application/json'},
            body: json.encode({'email': email, 'password': password}),
          )
          .timeout(const Duration(seconds: 8));

      if (r.statusCode == 200) {
        state = AuthUser.fromJson(
          json.decode(r.body) as Map<String, dynamic>,
          email: email,
        );
        return null; // success
      } else if (r.statusCode == 401) {
        return 'Invalid email or password.';
      } else {
        return 'Server error (${r.statusCode}).';
      }
    } catch (_) {
      return 'Cannot reach server. Check network.';
    }
  }

  void logout() => state = null;
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthUser?>(
  (_) => AuthNotifier(),
);
