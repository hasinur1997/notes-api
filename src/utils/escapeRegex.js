/**
 * Escapes every regex metacharacter so user input is matched literally.
 * Prevents regex injection and catastrophic backtracking (ReDoS) from search terms.
 *
 * @param {string} text - Untrusted text, e.g. a search query.
 * @returns {string} Text safe to pass to `new RegExp()`.
 */
export function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
