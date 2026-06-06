# StreamYard Live Q&A Filter — Build Spec (v1)

## 1. Context

An Islamic teacher runs live Q&A sessions on YouTube using StreamYard. StreamYard merges comments from every connected platform into one comment panel. During a session the teacher wants the incoming questions cleaned in real time so that:

1. The same question does not appear many times in the feed.
2. Each person is limited to one question, not two or three.

The operator (the teacher) is non-technical. The tool must run live during the stream and require no setup beyond installing the extension and opening StreamYard.

## 2. Hard constraint: no API

StreamYard has no public API, no webhooks for comments, and no SDK. This is confirmed by StreamYard's own help center. There is no official way to read the comment feed programmatically.

Therefore the only viable approach is a Chrome extension with a content script that reads StreamYard's comment panel directly from the page DOM in the browser, in real time. Everything in this spec is built on that single technical fact.

## 3. What we are building

A Manifest V3 Chrome extension that:

1. Injects a content script on the StreamYard studio page.
2. Watches the comments panel for new comments using a MutationObserver.
3. For each new comment, extracts the author handle, the platform if visible, the text, and a timestamp.
4. Runs two filtering layers (dedup, and one-question-per-person with continuation grouping).
5. Annotates the comments in place so the teacher sees a clean feed: duplicates collapsed, continuations merged into one block, extra questions flagged.

The teacher keeps using StreamYard exactly as before. The extension only changes how the comments look, so the teacher still features questions on screen through StreamYard's native controls.

## 4. The problems and the risks we are mitigating

### Problem A: Repeated questions
The same question is posted multiple times, by one person or by many. The feed clutters and the teacher wastes time reading the same thing.

**Mitigation:** a duplicate-detection layer that normalizes text and catches exact and near-duplicate repeats, then collapses them into a single entry with a count.

### Problem B: One person asking many questions
A single person posts two or three separate questions. The teacher wants each person limited to one.

**Mitigation:** a per-handle tracking layer that allows one logical question per handle and flags any genuine additional question.

### Risk 1 (the important one): split questions wrongly treated as a second question or as a duplicate
A person writes a long question, hits the platform character limit, and sends the rest in a second comment. A naive system would either flag the second comment as a banned second question, or mismark it as a duplicate. Either way the question gets broken and becomes unanswerable.

**Mitigation:** continuation grouping. Before treating a same-handle second comment as a new question, check a short time window plus continuation cues. If it looks like a continuation, merge it into the same question block instead of flagging it.

**Cost asymmetry to design around:** wrongly merging two separate questions only gives the teacher a slightly longer block he can split mentally. Wrongly hiding a continuation destroys a real question. So when the system is unsure inside the time window, it must lean toward merging, never toward hiding.

### Risk 2: cross-platform identity cannot be linked
A person commenting as "Ahmad" on YouTube and "Ahmad" on Facebook cannot be reliably confirmed as the same human. We will not promise cross-platform identity. The one-question-per-person rule applies within the same platform and same handle only. This limitation must be stated honestly and not engineered around in v1.

### Risk 3: DOM fragility
Because we read the page instead of an API, if StreamYard changes the structure of its comment panel the extension can break. 

**Mitigation:** isolate every StreamYard-specific selector in one module (`dom.js`) and one config block. The extension must fail safe: if selectors stop matching, it does nothing visible and logs a clear console warning rather than corrupting the feed.

### Risk 4: performance under high comment volume
Heavy comparison work on every comment could lag the studio.

**Mitigation:** debounce DOM processing, compare each new comment only against a recent buffer (last N comments and active question blocks, not the entire history), and keep matching cheap.

## 5. Core rule (the mental model)

One logical question per handle.

- Continuation fragments from the same handle, arriving close together with continuation cues, fold into that one question.
- Anything beyond that one logical question (a genuinely new, self-contained question later) is flagged as an extra question and is not surfaced as new.
- This single rule covers the two-question case, the three-question case, and the split-question case at the same time.

## 6. Processing pipeline (step by step)

For each new comment detected:

1. **Extract** handle, platform (if present), raw text, timestamp.
2. **Normalize** the text (see Section 7).
3. **Continuation check** against the same handle's open question block (see Section 8). If it is a continuation, merge and stop.
4. **Duplicate check** against the recent signature store across all handles (see Section 9). If it is a duplicate, collapse and stop.
5. **New question check:** if the handle already has a completed question this session, flag this as an extra question. Otherwise register it as the handle's one logical question.
6. **Render** the resulting state in place (see Section 10).

Order matters. Continuation is checked before duplicate and before the extra-question rule, because a continuation must never be misclassified as either.

## 7. Normalization (`normalize.js`)

Produce a normalized form used for matching:

- Lowercase.
- Trim and collapse internal whitespace to single spaces.
- Remove diacritics and combining marks.
- Strip punctuation for the match key (keep an unmodified copy for display and for cue detection in Section 8).
- Optionally strip a configurable list of leading honorifics and greetings (for example "salam", "assalamu alaikum", "sheikh", "ustadh"). This is domain-specific and must be a config list, easy to edit, defaulting to a small safe set.

Output: `matchKey` (punctuation-stripped, normalized) and `displayText` (original).

## 8. Continuation grouping (`grouping.js`)

State per handle: an optional open question block with `lastTimestamp`, accumulated `displayText`, and `status`.

When a comment arrives from a handle that already has an open block, classify it as a continuation if BOTH the time condition and at least one cue hold.

Time condition:
- Gap since the block's `lastTimestamp` is within `CONTINUATION_WINDOW_MS` (default 25000, configurable).

Continuation cues (any one is enough):
- The previous fragment's display text does not end with terminal punctuation (`.`, `?`, `!`).
- The previous fragment ends with a comma or a connecting word (configurable list: and, or, but, because, that, which, who, to, of, for, with, the).
- The previous fragment length is at or near the platform character limit (configurable `NEAR_LIMIT_CHARS`, default 200, which matches YouTube live chat's per-message limit).
- The new fragment starts lowercase, or starts with a connecting word.

If classified as continuation:
- Append the new `displayText` to the block.
- Update `lastTimestamp`.
- Do not flag, do not count as a new question, do not run duplicate logic on the fragment alone.

If not a continuation:
- Close the handle's existing block (the window has effectively ended).
- Proceed to duplicate check, then to the new-question / extra-question decision.

Tuning rule: inside the time window, ambiguity resolves toward continuation (merge), because the cost of wrongly splitting is far lower than the cost of wrongly hiding a real question.

## 9. Duplicate detection (`dedup.js`)

Maintain a recent signature store: a map from `matchKey` to the first comment that produced it, plus a small rolling buffer of recent `matchKey`s for fuzzy comparison.

Exact duplicate:
- If an incoming `matchKey` already exists in the store, it is an exact duplicate. Increment that entry's count.

Near-duplicate (fuzzy):
- Compare the incoming `matchKey` against the recent buffer using token-set Jaccard similarity (split into word tokens, compare as sets). This handles reordered or slightly reworded repeats cheaply and is order-independent.
- If similarity is at or above `FUZZY_THRESHOLD` (default 0.85) and token counts are within a reasonable length ratio, treat as a duplicate of the matched entry.
- A normalized Levenshtein ratio may be added as a secondary check for very short questions where token-set similarity is unreliable. Keep this optional and behind a config flag.

Buffer scope: compare only against the last `DEDUP_BUFFER_SIZE` distinct questions (default 100), not the entire session, for performance.

Output of a duplicate match: collapse into the original entry and show a count badge (for example "asked 3 times"). Do not destroy the duplicates' data; keep a list so the teacher can expand if wanted.

## 10. UI behavior (`ui.js`, `styles.css`)

Primary approach: annotate StreamYard's comments in place. Confidence-tiered behavior:

- **Exact and high-confidence fuzzy duplicates:** safe to collapse or grey out, with a count badge. This is low risk because the text is genuinely the same.
- **Continuation merges:** show as one grouped block with a small badge such as "joined" so the teacher knows two comments were combined. Never hide a fragment.
- **Extra questions (a handle's second logical question):** mark with a visible badge such as "2nd question from this person" and dim, but do not hard-delete in v1. The teacher stays the final judge on the ambiguous cases.

Human-in-the-loop principle for v1: only the high-confidence exact duplicates may auto-collapse. Everything ambiguous is marked, not hidden.

Fallback approach if in-place annotation proves too fragile against StreamYard's DOM: render a separate floating "Clean Question Queue" panel injected by the extension, read-only, showing the deduplicated and grouped questions. The teacher triages from this panel and features the chosen question through StreamYard normally. Decide between in-place and panel after inspecting the live DOM (see Section 12).

## 11. Configuration (`config.js`)

All of the following must be editable in one place:

- `CONTINUATION_WINDOW_MS` (default 25000)
- `NEAR_LIMIT_CHARS` (default 200)
- `CONNECTOR_WORDS` (list)
- `HONORIFICS_TO_STRIP` (list)
- `FUZZY_THRESHOLD` (default 0.85)
- `DEDUP_BUFFER_SIZE` (default 100)
- `AUTO_COLLAPSE_EXACT_DUPLICATES` (default true)
- `AUTO_HIDE_ANYTHING_AMBIGUOUS` (default false, must stay false in v1)
- StreamYard DOM selectors (the comment container, a single comment node, the author handle node, the text node, the platform indicator node).

## 12. StreamYard DOM discovery (do this first)

The exact selectors are not known in advance and must be discovered by inspecting a live StreamYard studio with the comments panel open. The developer should:

1. Open a real StreamYard studio with comments visible.
2. Identify the stable container that holds all comments, a single comment node, and within it the handle, the text, and any platform indicator.
3. Record these selectors only in `config.js` and `dom.js`. No selector should appear anywhere else in the codebase.
4. If a robust attribute or data hook exists, prefer it over brittle class names that look auto-generated.

Until selectors are confirmed, use clearly marked placeholders and a mock comment source so the matching logic can be built and tested independently of StreamYard.

## 13. Suggested file structure

```
streamyard-qa-filter/
  manifest.json          MV3 manifest, content script scoped to streamyard.com, minimal permissions
  src/
    content.js           entry point, sets up the MutationObserver and the pipeline
    dom.js               all StreamYard selectors and comment extraction (the only fragile layer)
    normalize.js         text normalization
    dedup.js             exact and fuzzy duplicate detection
    grouping.js          continuation detection and one-question-per-person logic
    state.js             handle map, signature store, recent buffer
    ui.js                in-place annotation, badges, collapsing
    config.js            all thresholds, lists, feature flags, selectors
  styles.css             badge and dim styles
  test/
    mock-comments.js     scripted comment streams for testing without StreamYard
```

## 14. Build order (phases)

1. **Skeleton:** MV3 manifest, content script that loads on streamyard.com and logs to console.
2. **DOM discovery:** confirm selectors against a live studio, fill `dom.js` and `config.js`, prove that new comments can be read in real time.
3. **Matching core, tested on mocks:** normalize, dedup, grouping, state. Build and test against `mock-comments.js` with no StreamYard dependency.
4. **Wire core to live DOM:** feed real extracted comments into the matching core.
5. **UI layer:** in-place annotation with confidence tiers. Implement the panel fallback only if in-place proves too fragile.
6. **Tuning pass:** run against a real or recorded session, adjust thresholds and the continuation window.

## 15. Acceptance criteria

The build is acceptable for v1 when, on a live or realistically mocked comment stream:

1. The same exact question posted three times shows once, with a count of 3.
2. A reworded near-duplicate (same meaning, light rewording or reordering) is caught as a duplicate at the default threshold.
3. A long question split across two comments by the same handle, second arriving within the window with a continuation cue, is shown as one merged question and is not flagged as a second question and not marked as a duplicate.
4. A genuine second, self-contained question from the same handle later in the session is flagged as an extra question.
5. Two different short questions from two different handles are never merged with each other.
6. When StreamYard selectors fail to match, the extension does nothing visible and logs a clear warning, leaving the native feed untouched.
7. The teacher can still feature any question through StreamYard's normal controls.

## 16. Explicitly out of scope for v1

- Semantic deduplication, meaning two people asking the identical question in completely different words with no shared tokens. This needs an LLM or embedding call per comment, with cost and latency. Defer to v2 and only add if the simple layer proves insufficient on real sessions.
- Cross-platform identity linking. Not reliable, not promised.
- Any auto-hiding of ambiguous cases. Marking only in v1.
- A settings UI. Config lives in `config.js` for v1.
