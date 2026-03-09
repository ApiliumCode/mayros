/**
 * Minimum cortex binary version required by this MAYROS release.
 *
 * Bump this constant whenever a MAYROS release depends on new cortex
 * features or API changes.  `mayros update` and the sidecar startup
 * check will compare the installed binary against this value.
 */
export const REQUIRED_CORTEX_VERSION = "0.4.1";
