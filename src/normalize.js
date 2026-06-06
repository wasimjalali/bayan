/*
 * normalize.js - text normalization (spec Section 7). Pure: no DOM, no chrome.*.
 *
 * Targets Dari / Persian (Perso-Arabic script). The hard problem this solves:
 * two comments that look identical to a human are often different byte strings,
 * because people type on Arabic vs Persian keyboards, with or without vowel
 * marks, and with or without the zero-width non-joiner. Without folding all of
 * that away, the duplicate detector would never match them.
 *
 * Output:
 *   matchKey    - aggressively folded, used ONLY for matching (dedup).
 *   displayText - original text, used for display AND continuation cue detection
 *                 (script, punctuation and ZWNJ must survive for correct display).
 */

// Arabic -> Persian letter folding, plus hamza-carrier simplification. Keys are
// the variant code points; values are the canonical Persian form.
const FOLD = {
  "ي": "ی", // ARABIC YEH ي -> PERSIAN YEH ی
  "ى": "ی", // ALEF MAKSURA ى -> ی
  "ئ": "ی", // YEH WITH HAMZA ئ -> ی
  "ك": "ک", // ARABIC KAF ك -> PERSIAN KEH ک
  "ؤ": "و", // WAW WITH HAMZA ؤ -> WAW و
  "ة": "ه", // TEH MARBUTA ة -> HEH ه
  "ۀ": "ه", // HEH WITH YEH ABOVE ۀ -> ه
  "أ": "ا", // ALEF WITH HAMZA ABOVE أ -> ALEF ا
  "إ": "ا", // ALEF WITH HAMZA BELOW إ -> ا
  "آ": "ا", // ALEF WITH MADDA آ -> ا
  "ٱ": "ا", // ALEF WASLA ٱ -> ا
  "ء": "", // standalone HAMZA ء -> removed
};

// Persian (۰-۹) and Arabic-Indic (٠-٩) digits -> ASCII.
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
for (let i = 0; i < 10; i++) {
  FOLD[PERSIAN_DIGITS[i]] = String(i);
  FOLD[ARABIC_DIGITS[i]] = String(i);
}

// Zero-width joiners, bidi controls, BOM, and the tatweel elongation char. These
// are removed (not spaced) so "می‌روم" and "میروم" fold together.
const CONTROL_CHARS = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\u061c\ufeff\u0640]/g;

// Combining marks to strip: Latin diacritics + Arabic harakat / Quranic marks.
const COMBINING_MARKS = /[\u0300-\u036f\u064b-\u065f\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7\u06e8\u06ea-\u06ed]/g;

function foldChars(str) {
  let out = "";
  for (const ch of str) out += FOLD[ch] ?? ch;
  return out;
}

/**
 * @param {string} text - raw comment text.
 * @param {object} config - CONFIG (uses HONORIFICS_TO_STRIP).
 * @returns {{ matchKey: string, displayText: string }}
 */
export function normalize(text, config) {
  const raw = typeof text === "string" ? text : "";

  // displayText: original, outer whitespace collapsed/trimmed. Case, script,
  // punctuation and ZWNJ are preserved (Section 8 cue detection needs them).
  const displayText = raw.replace(/\s+/g, " ").trim();

  // matchKey pipeline.
  let key = displayText
    .toLowerCase()
    .replace(CONTROL_CHARS, ""); // drop ZWNJ / bidi / tatweel before folding
  key = foldChars(key); // Arabic->Persian letters, hamza carriers, digits
  key = key
    .normalize("NFD")
    .replace(COMBINING_MARKS, "") // harakat + Latin diacritics
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // punctuation -> space (keep letters/numbers)
    .replace(/\s+/g, " ")
    .trim();

  const stripped = stripLeadingHonorifics(key, config.HONORIFICS_TO_STRIP);

  // If stripping removed everything (e.g. a bare "سلام"), fall back to the
  // pre-strip key so unrelated greetings aren't all collapsed into one signature.
  const matchKey = stripped.length > 0 ? stripped : key;

  return { matchKey, displayText };
}

/**
 * Fold a handle / display name into a stable identity form. The same person
 * often arrives spelled two ways (Arabic vs Persian keyboard, Ahmad vs ahmad,
 * stray ZWNJ or double spaces), and the one-question-per-person rule must not
 * split them into two people. Honorifics are NOT stripped (a display name may
 * legitimately contain one) and punctuation/emoji are kept (they can be the
 * only thing distinguishing two names on the same platform).
 */
export function foldHandle(handle) {
  const raw = typeof handle === "string" ? handle : "";
  let key = raw.toLowerCase().replace(CONTROL_CHARS, "");
  key = foldChars(key);
  return key
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Remove leading honorific / greeting phrases. Matched as whole leading tokens,
 * longest phrase first, repeating so "سلام استاد" peels off both. Input is
 * already folded + punctuation-free.
 */
function stripLeadingHonorifics(key, honorifics) {
  if (!honorifics || honorifics.length === 0) return key;

  const phrases = [...honorifics].sort(
    (a, b) => b.split(" ").length - a.split(" ").length || b.length - a.length
  );

  let result = key;
  let changed = true;
  while (changed) {
    changed = false;
    for (const phrase of phrases) {
      if (result === phrase) {
        result = "";
        changed = true;
        break;
      }
      if (result.startsWith(phrase + " ")) {
        result = result.slice(phrase.length + 1).trim();
        changed = true;
        break;
      }
    }
  }
  return result;
}
