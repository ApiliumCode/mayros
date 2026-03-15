/**
 * PIN Authentication for Remote Exec
 *
 * Scrypt-based PIN hashing and verification with lockout logic.
 * Uses only node:crypto — no npm dependencies.
 */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

// ============================================================================
// Types
// ============================================================================

export type PinConfig = {
  pinHash: string | null; // "scrypt:<b64salt>:<b64hash>" or null (disabled)
  pinLockoutMs: number; // default 300_000 (5 min)
  pinMaxAttempts: number; // default 3
  pinAutoLockMs: number; // default 300_000 (5 min inactivity -> re-lock)
};

export type PinSessionState = {
  pinUnlocked: boolean;
  pinFailures: number;
  pinLockedUntil: number | null;
  pinLastActivity: number;
};

// ============================================================================
// Constants
// ============================================================================

const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_LEN = 32;
const HASH_PREFIX = "scrypt";

// ============================================================================
// Hashing & Verification
// ============================================================================

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_LEN);
  const derived = (await scryptAsync(pin, salt, SCRYPT_KEYLEN)) as Buffer;
  return `${HASH_PREFIX}:${salt.toString("base64")}:${derived.toString("base64")}`;
}

export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(":");
  if (parts.length !== 3 || parts[0] !== HASH_PREFIX) return false;

  const salt = Buffer.from(parts[1]!, "base64");
  const expected = Buffer.from(parts[2]!, "base64");
  const derived = (await scryptAsync(pin, salt, SCRYPT_KEYLEN)) as Buffer;

  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

// ============================================================================
// Session State
// ============================================================================

export function createPinState(): PinSessionState {
  return {
    pinUnlocked: false,
    pinFailures: 0,
    pinLockedUntil: null,
    pinLastActivity: 0,
  };
}

export function checkPinLock(
  state: PinSessionState,
  config: PinConfig,
  now = Date.now(),
): { locked: true; reason: string } | { locked: false } {
  // PIN disabled — always unlocked
  if (!config.pinHash) return { locked: false };

  // Lockout active
  if (state.pinLockedUntil && now < state.pinLockedUntil) {
    const remainSec = Math.ceil((state.pinLockedUntil - now) / 1000);
    return { locked: true, reason: `Locked out. Try again in ${remainSec}s.` };
  }

  // Lockout expired — reset failures
  if (state.pinLockedUntil && now >= state.pinLockedUntil) {
    state.pinLockedUntil = null;
    state.pinFailures = 0;
  }

  // Not yet unlocked
  if (!state.pinUnlocked) {
    return { locked: true, reason: "Session locked. Use /run unlock <pin> to unlock." };
  }

  // Auto-lock on inactivity
  if (state.pinLastActivity > 0 && now - state.pinLastActivity > config.pinAutoLockMs) {
    state.pinUnlocked = false;
    return {
      locked: true,
      reason: "Session auto-locked due to inactivity. Use /run unlock <pin>.",
    };
  }

  return { locked: false };
}

export async function attemptUnlock(
  pin: string,
  state: PinSessionState,
  config: PinConfig,
): Promise<{ success: boolean; message: string }> {
  if (!config.pinHash) {
    return { success: true, message: "PIN authentication is not configured." };
  }

  // Check lockout
  const now = Date.now();
  if (state.pinLockedUntil && now < state.pinLockedUntil) {
    const remainSec = Math.ceil((state.pinLockedUntil - now) / 1000);
    return { success: false, message: `Locked out. Try again in ${remainSec}s.` };
  }

  // Reset lockout if expired
  if (state.pinLockedUntil && now >= state.pinLockedUntil) {
    state.pinLockedUntil = null;
    state.pinFailures = 0;
  }

  const valid = await verifyPin(pin, config.pinHash);

  if (valid) {
    state.pinUnlocked = true;
    state.pinFailures = 0;
    state.pinLockedUntil = null;
    state.pinLastActivity = now;
    const autoLockMin = Math.round(config.pinAutoLockMs / 60_000);
    return { success: true, message: `Unlocked. Auto-locks after ${autoLockMin}m inactivity.` };
  }

  state.pinFailures++;
  const remaining = config.pinMaxAttempts - state.pinFailures;

  if (remaining <= 0) {
    state.pinLockedUntil = now + config.pinLockoutMs;
    state.pinFailures = 0;
    const lockoutSec = Math.round(config.pinLockoutMs / 1000);
    return { success: false, message: `Incorrect PIN. Locked out for ${lockoutSec}s.` };
  }

  return {
    success: false,
    message: `Incorrect PIN. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`,
  };
}
