/**
 * Shared constants for lightweight command detection.
 *
 * These are commands that should be allowed to run even when
 * the configuration is invalid (e.g. doctor, help, health).
 */

export const ALLOWED_INVALID_COMMANDS = new Set(["doctor", "logs", "health", "help", "status"]);

export const ALLOWED_INVALID_GATEWAY_SUBCOMMANDS = new Set([
  "status",
  "probe",
  "health",
  "discover",
  "call",
  "install",
  "uninstall",
  "start",
  "stop",
  "restart",
]);
