# Bayān (بیان) - Live Q&A Filter for StreamYard

**Clean up your live stream's Q&A comments as they come in.**

**Bayān** (Arabic/Quranic: *clear exposition, eloquence, clarity*) is a Chrome (Manifest V3) extension that cleans the live comment feed during a StreamYard Q&A session. It is built for **Dari / Persian** comments: the audience asks questions in Dari, and the teacher answers them orally. It runs while you stream and does three things in real time:

1. Collapses repeated questions into a single entry with a count.
2. Merges a question that got split across two comments back into one block.
3. Flags when one person asks a second, separate question.

You keep using StreamYard exactly as before. The extension only changes how comments look, so you still feature questions through StreamYard's native controls.

## The one hard constraint: there is no API

StreamYard has no public API, no comment webhooks, and no SDK. The only way to read the comment feed is to read the page's DOM in the browser. Everything here is built on that single fact.

Because we read the page instead of an API, a StreamYard layout change can break comment reading. To contain that, **every StreamYard-specific selector lives in exactly two files: `src/config.js` and `src/dom.js`.** Nothing else in the codebase knows what StreamYard's HTML looks like. If selectors stop matching, the extension does nothing visible and logs a clear console warning. It never corrupts the feed.

## Install (load unpacked)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this project folder (the one with `manifest.json`).
4. Open a StreamYard studio (`https://streamyard.com/...`) with the comments panel visible.
5. Open DevTools (`Cmd+Option+I` on Mac) and check the Console. You should see lines tagged `[SYQF]`.

Click the Bayān icon in the toolbar to open the popup: one switch turns the filter on or off (persisted, applied to the live feed instantly). Off restores StreamYard's native feed exactly. Everything else is configured in `src/config.js`; there is no settings screen in v1.

## Project layout

```
manifest.json          MV3 manifest, content script scoped to streamyard.com
src/
  content.js           entry point: bootstraps the core, runs the MutationObserver + pipeline
  dom.js               ALL StreamYard selectors + comment extraction (the only fragile layer)
  normalize.js         text normalization (matchKey + displayText)
  dedup.js             exact + fuzzy duplicate detection
  grouping.js          continuation detection, one-question-per-person, pipeline order
  state.js             handle map, signature store, recent buffer
  ui.js                in-place annotation, badges, collapsing
  config.js            all thresholds, lists, feature flags, AND the StreamYard selectors
popup/
  popup.html|css|js    the toolbar popup: one on/off switch (chrome.storage.local)
fonts/
  Vazirmatn-Variable   bundled Persian UI font (OFL), used by badges, popup and demo
styles.css             badge + dim styles, @font-face, on/off CSS gating
test/
  mock-comments.js     scripted comment streams for testing without StreamYard
  run-tests.js         Node test runner for the matching core
  demo.html|js         visual simulation harness (npm run demo)
```

## The processing pipeline (order is fixed)

For each new comment: **extract → normalize → continuation check → duplicate check → new/extra-question check → render.**

The order is not negotiable. Continuation is checked first, before duplicate and before the one-question rule, so a split question is never wrongly flagged as a second question or wrongly collapsed as a duplicate. See the spec, Section 6.

Cost asymmetry we design around: wrongly merging two questions just gives you a slightly longer block to read. Wrongly hiding a real question destroys it. So inside the time window, ambiguity always resolves toward merging, never toward hiding.

## Human in the loop (v1)

Only high-confidence **exact** duplicates auto-collapse. Everything ambiguous (continuation merges, flagged second questions) is marked visually, never hidden. You stay the final judge.

## Testing the matching core

The matching logic (normalize, dedup, grouping, state) has zero dependency on StreamYard or the browser DOM. It is proven against scripted streams in `test/mock-comments.js` before it ever touches a real page.

```
npm test
```

## Language: Dari / Persian

Comments are read as Dari/Persian (the two share one script, so both work). Before matching, text is folded so that the same question typed different ways still counts as the same question:

- Arabic vs Persian letters are unified: `ي → ی`, `ك → ک`, alef and hamza forms (`أ إ آ ؤ ئ ة ۀ`) folded, standalone hamza dropped.
- Vowel marks (harakat), the tatweel stretch (`ـ`), and the zero-width non-joiner (so `می‌روم` = `میروم`) are stripped.
- Persian `۰۱۲۳` and Arabic-Indic `٠١٢٣` digits fold to `0123`.
- Leading greetings/honorifics (`سلام`, `سلام علیکم`, `استاد`, `شیخ`, `مولوی`, `صاحب`, ...) are stripped for matching only, never from what's shown.
- The Persian question mark `؟` and comma `،` are understood by the continuation logic.
- Handles are folded the same way for identity (no honorific stripping), so `کریم` typed on an Arabic keyboard (`كريم`) or `Ahmad` vs `ahmad` count as the same person for the one-question rule.

**To change wording or word lists**, edit `src/config.js`:
- `LABELS` - the four Dari badge texts.
- `HONORIFICS_TO_STRIP` - greetings/titles peeled off the front (written in folded Persian: `ک` not `ك`, `ی` not `ي`).
- `CONNECTOR_WORDS` - Persian words that signal a continuation.

The badges render right-to-left. Counts show in Persian digits (toggle with `USE_PERSIAN_DIGITS_IN_UI`).

## Tuning (Phase 6)

Every knob lives in `src/config.js`. There is no settings UI in v1; you edit the file and reload the extension. Tune against a real or recorded session. Symptom to knob:

| You see... | Turn this knob |
| --- | --- |
| Real continuations getting flagged as a 2nd question | Raise `CONTINUATION_WINDOW_MS` (give the second fragment more time), or add the connector word you keep seeing to `CONNECTOR_WORDS`. |
| Two genuinely separate questions getting merged | Lower `CONTINUATION_WINDOW_MS`. Remember the cost asymmetry: a wrong merge is cheap, so lean conservative here. |
| Obvious repeats not collapsing | Lower `FUZZY_THRESHOLD` (e.g. 0.85 to 0.80). Watch for false merges as you go down. |
| Different questions wrongly called duplicates | Raise `FUZZY_THRESHOLD`, or raise `FUZZY_LENGTH_RATIO` so a short question can't match a long one. |
| Greetings/honorifics splitting otherwise-identical questions | Add the word/phrase to `HONORIFICS_TO_STRIP`. |
| Very short repeats ("when?", "link?") slipping through | Set `ENABLE_LEVENSHTEIN_SHORT: true` and tune `LEVENSHTEIN_THRESHOLD`. |
| Studio feels laggy under heavy volume | Lower `DEDUP_BUFFER_SIZE`. |

`AUTO_HIDE_ANYTHING_AMBIGUOUS` must stay `false` in v1.

## Out of scope for v1

- Semantic deduplication (two people asking the same thing in totally different words). Needs an LLM/embedding call. Deferred to v2.
- Cross-platform identity linking. "Ahmad" on YouTube and "Ahmad" on Facebook cannot be reliably confirmed as the same person. The one-question rule applies within the same platform and handle only.
- Any auto-hiding of ambiguous cases. Marking only.
- A settings UI. Config lives in `config.js`.

## Build status

This project is built in phases (spec Section 14). Current status:

- [x] Phase 1: Skeleton (manifest + content script logging on streamyard.com)
- [x] Phase 2: DOM discovery layer built with clearly-marked placeholder selectors (`SELECTORS.CONFIRMED: false`). Real selectors still need confirming on a live studio.
- [x] Phase 3: Matching core, proven on mocks (`npm test`: 24/24, acceptance criteria 1-5)
- [x] Phase 4: Core wired to the live DOM (observer + pipeline + fail-safe; gated behind `CONFIRMED`)
- [x] Phase 5: UI layer (in-place annotation with confidence tiers)
- [~] Phase 6: Tuning playbook + centralized knobs ready. Live threshold tuning needs a real session (see Tuning above).
- [x] Dari/Persian localization: script normalization, Dari word lists + labels, RTL UI, proven on Dari fixtures (`npm test`)
- [x] Brand: name **Bayān**, crescent logo (`icons/`, master at `icons/logo.svg`), premium emerald + gold + ivory palette, polished RTL badges
- [x] Popup with on/off switch (persisted in `chrome.storage.local`; off restores the native feed exactly)
- [x] Bundled Vazirmatn variable font (OFL) for crisp Persian rendering in badges, popup and demo

### To go fully live

The build is complete and the logic is proven. Two operator steps remain because they need your StreamYard login, which I can't access:

1. Confirm the real selectors on a live studio (spec Section 12), drop them into `SELECTORS` in `src/config.js`, and set `SELECTORS.CONFIRMED: true`.
2. Tune thresholds against a real or recorded session using the table above.

## License

MIT. See [LICENSE](LICENSE).
