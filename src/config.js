// Product brand configuration — provisional naming.
//
// The product name ("Seren"/"Serendipity") is NOT legally vetted. Every
// user-facing product name must derive from BRAND so a rename is a one-line
// (or one-env-var) change: set BRAND_NAME / BRAND_TAGLINE in the environment.
//
// Technical identifiers are intentionally NOT derived from BRAND:
//   - npm package name (renaming a published package is irreversible)
//   - localStorage key prefix (STORAGE_PREFIX below — changing it logs out
//     existing members; a rename needs a migration, not a find-replace)
//   - SQLite filename (a rename orphans existing databases)
// See PRODUCT_AUDIT.md §4–§6.

export const BRAND = Object.freeze({
  /** Display name, e.g. "SEREN". Provisional. */
  name: process.env.BRAND_NAME || 'SEREN',
  /** One-line positioning. Provisional. */
  tagline:
    process.env.BRAND_TAGLINE ||
    'A consent-first space for meaningful connection',
  /** Support boundary notice shown in product surfaces. */
  get supportNote() {
    return `${this.name} is a connection platform, not medical, mental-health, legal, or emergency support.`;
  },
});

/**
 * Client storage namespace (localStorage keys look like `${STORAGE_PREFIX}.*`).
 * Centralized here so a future rename touches one place — but changing the
 * VALUE forces every existing member to re-onboard on their devices.
 */
export const STORAGE_PREFIX = process.env.STORAGE_PREFIX || 'seren';
