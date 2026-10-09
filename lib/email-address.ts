// Before the @: pieces separated by single dots (no leading, trailing or doubled dot). After it: labels separated by dots. Dots are kept out of
// the character classes so the pattern cannot backtrack badly.
const EMAIL_RE = /^[^\s@.]+(?:\.[^\s@.]+)*@[^\s@.]+(?:\.[^\s@.]+)+$/;

/** A sensible-looking email address (not a promise that it exists): the one check used before a code is sent to it. */
export function isPlausibleEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}
