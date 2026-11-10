/**
 * Label rules shared by notes and users.
 */

export const MAX_LABELS_PER_NOTE = 10;
export const MAX_LABEL_LENGTH = 30;
/** Labels a user can create without attaching them to a note. */
export const MAX_USER_LABELS = 100;

/**
 * Normalizes a label list: trims, collapses inner whitespace, drops empties, and removes
 * case-insensitive duplicates (keeping the first spelling). Used as the schema setter so
 * every create and update stores labels the same way.
 *
 * @param {unknown[]} [values=[]] - Raw label values.
 * @returns {string[]} Clean, unique labels in their original order.
 */
export function normalizeLabels(values = []) {
  const seen = new Set();
  const labels = [];
  for (const value of values) {
    const label = String(value).trim().replace(/\s+/g, ' ');
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return labels;
}

/**
 * Case-insensitive comparison for sorting label names ("bedIQ" before "JavaScript").
 *
 * @param {string} a - First label.
 * @param {string} b - Second label.
 * @returns {number} Sort order.
 */
export function compareLabels(a, b) {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}
