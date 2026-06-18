/*
 * config.js - the single place to tune behavior AND the single place (with
 * dom.js) that knows what StreamYard's HTML looks like. Spec Section 11.
 *
 * This build targets Dari / Persian comments (same script). The word lists,
 * punctuation, and UI labels below are Persian. Everything here is meant to be
 * edited by hand; the matching core reads these values and hard-codes nothing.
 */

export const CONFIG = {
  // --- Continuation grouping (grouping.js, spec Section 8) ---

  CONTINUATION_WINDOW_MS: 25000,
  NEAR_LIMIT_CHARS: 200,

  // The most comments a single logical question may occupy: the question itself
  // plus its continuation fragments. 2 = the original + ONE continuation. A
  // further fragment is blocked (treated as an extra question) even if it looks
  // like a continuation, so one person can never flood the teacher with a
  // three-, four-, five-part run. This is the teacher's "one continuation only"
  // rule. Raise it only if real questions routinely arrive in 3+ pieces.
  MAX_COMMENTS_PER_QUESTION: 2,

  // Persian connecting words. Used two ways: a previous fragment ENDING in one
  // is a continuation cue, and a new fragment STARTING with one is a cue too.
  // و (and) که (that) یا (or) اما/ولی (but) چون/زیرا (because) تا (so that)
  // به از برای با در (prepositions) را (object marker) هم/نیز (also)
  CONNECTOR_WORDS: [
    "و", "که", "یا", "اما", "ولی", "چون", "زیرا", "تا",
    "به", "از", "برای", "با", "در", "را", "هم", "نیز",
  ],

  // Terminal punctuation. A previous fragment NOT ending in one of these looks
  // unfinished -> continuation cue. «؟» is the Persian question mark.
  TERMINAL_PUNCTUATION: [".", "?", "!", "؟"],

  // Trailing comma / semicolon -> the sentence is mid-thought (continuation cue).
  // «،» Persian comma, «؛» Persian semicolon.
  SENTENCE_COMMA: ["،", "؛", ","],

  // --- Normalization (normalize.js, spec Section 7) ---

  // Leading honorifics / greetings stripped from the match key (never from the
  // displayed text). Written in folded Persian form (ک not ك, ی not ي), because
  // stripping runs AFTER letter folding. Dari-flavored. Edit freely.
  // Multi-word greetings are matched longest-first automatically.
  HONORIFICS_TO_STRIP: [
    "السلام علیکم", "سلام علیکم", "وعلیکم السلام", "علیکم السلام", "صبح بخیر",
    "سلام", "استاد", "معلم", "شیخ", "مولوی", "مولانا", "قاری", "حافظ",
    "علامه", "حاجی", "حاج", "جناب", "آقای", "آقا", "خانم", "محترم",
    "برادر", "خواهر", "دوست", "عزیز", "جان", "صاحب",
  ],

  // --- Duplicate detection (dedup.js, spec Section 9) ---

  FUZZY_THRESHOLD: 0.85,
  FUZZY_LENGTH_RATIO: 0.6,
  DEDUP_BUFFER_SIZE: 100,

  // Optional Levenshtein fallback for very short questions (spec 9, off by default).
  ENABLE_LEVENSHTEIN_SHORT: false,
  SHORT_QUESTION_MAX_TOKENS: 3,
  LEVENSHTEIN_THRESHOLD: 0.85,

  // --- UI behavior (ui.js, spec Section 10) ---

  AUTO_COLLAPSE_EXACT_DUPLICATES: true,
  // Must stay false in v1: ambiguous cases are marked, never hidden.
  AUTO_HIDE_ANYTHING_AMBIGUOUS: false,

  // The teacher wants a clean feed: one question per person, no repeats, nothing
  // extra to read. When true, a confirmed second question from the same handle
  // (and any over-the-cap continuation fragment) is collapsed out of the feed
  // instead of just dimmed. The data is retained in state and the popup OFF
  // switch reveals StreamYard's full native feed, so nothing is ever destroyed.
  // Set to false to keep them visible-but-dimmed instead (the old v1 behavior).
  HIDE_EXTRA_QUESTIONS: true,

  // Safety lever for the live-test phase. When true, an extra that lands INSIDE
  // the continuation window is only DIMMED, not hidden, because it MIGHT be a
  // continuation the detector missed (hiding a real question is the costliest
  // mistake). Default false: hide every extra, in or out of the window, which is
  // what the teacher wants - he never sees a second question at all. Flip to true
  // only if a live session shows a real question disappearing; then a quick
  // second comment stays visible-but-dim instead of vanishing.
  DIM_IN_WINDOW_EXTRAS: false,

  // Right-to-left UI for Persian. Counts use Western digits (3) for legibility,
  // since Persian-Indic digits (۳) are hard to read at badge size. Flip to true
  // if you prefer Persian digits.
  UI_DIRECTION: "rtl",
  USE_PERSIAN_DIGITS_IN_UI: false,

  // Dari badge + popup labels. Edit the wording here; nothing else needs to
  // change. {n} in COUNT is replaced with the (optionally Persian) digit count.
  LABELS: {
    joined: "ادامه سوال قبلی",       // "continuation of the previous question"
    askedTimes: "{n} بار پرسیده شد", // "asked {n} times"
    possibleDuplicate: "شاید تکراری باشد", // "it may be a duplicate"
    secondQuestion: "سوال دوم این شخص", // "this person's second question"

    // Popup (the bar that opens when the extension icon is clicked).
    popupTagline: "فلتر سوالات پخش زنده",          // "live stream question filter"
    popupStatusOn: "فعال",                          // "on"
    popupStatusOff: "غیرفعال",                      // "off"
    popupHintOn: "سوال‌های تکراری جمع می‌شوند و سوال‌های اضافه نشانی می‌شوند",
    popupHintOff: "ستون نظرات بدون هیچ تغییری نمایش داده می‌شود",
    popupFooter: "روی StreamYard کار می‌کند",       // "works on StreamYard"
  },
};

/*
 * chrome.storage keys shared by the popup and the content script. The popup
 * writes, the content script reads + listens. Default is enabled; only an
 * explicit `false` turns the filter off.
 */
export const STORAGE_KEYS = {
  enabled: "bayanEnabled",
};

/*
 * StreamYard DOM selectors. UNCONFIRMED PLACEHOLDERS (spec Section 12). Confirm
 * on a live studio, set CONFIRMED: true, then change nothing else. Selectors are
 * language-agnostic, so Dari support does not affect this block.
 */
export const SELECTORS = {
  CONFIRMED: false,
  commentContainer: '[data-testid="comments-list"], [class*="commentsList"]',
  commentNode: '[data-testid="comment"], [class*="comment_"], li[class*="comment"]',
  authorHandle: '[data-testid="comment-author"], [class*="author"], [class*="name"]',
  text: '[data-testid="comment-text"], [class*="commentText"], [class*="message"]',
  platformIndicator: '[data-testid="comment-platform"], [class*="platform"], [class*="source"] img',
};
