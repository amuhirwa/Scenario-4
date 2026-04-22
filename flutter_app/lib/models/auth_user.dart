// lib/models/auth_user.dart

class AuthUser {
  final String email;
  final String role; // "commander" | "soldier"
  final String name;
  final String unit;
  final String? soldierId;
  final String? callSign;

  const AuthUser({
    required this.email,
    required this.role,
    required this.name,
    required this.unit,
    this.soldierId,
    this.callSign,
  });

  bool get isCommander => role == 'commander';
  bool get isSoldier   => role == 'soldier';

  factory AuthUser.fromJson(Map<String, dynamic> json, {required String email}) {
    return AuthUser(
      email:      email,
      role:       json['role']       as String,
      name:       json['name']       as String,
      unit:       json['unit']       as String,
      soldierId:  json['soldier_id'] as String?,
      callSign:   json['call_sign']  as String?,
    );
  }
}
