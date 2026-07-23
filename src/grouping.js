/*
 * grouping.js - the core rule (spec Section 5) and the fixed processing
 * pipeline (Section 6). Pure: no DOM, no chrome.*.
 *
 * Core rule: one logical question per handle. Continuation fragments fold into
 * that one question; anything beyond it is flagged as an extra question.
 *
 * processComment() is the SINGLE source of truth for pipeline order:
 *   normalize -> continuation check -> duplicate check -> new/extra -> (render).
 * Both content.js (live) and the test runner (mocks) call it, so the order is
 * never duplicated and can never drift.
 *
 * Order is not negotiable. Continuation is checked BEFORE duplicate and BEFORE
 * the extra-question rule, so a split question is never misclassified as either.
 */

import { normalize } from "./normalize.js";
import { identityKey, getOrCreateHandle } from "./state.js";
import { checkDuplicate, collapseOnto, registerSignature } from "./dedup.js";

function lastChar(text) {
  return text.length ? text[text.length - 1] : "";
}

function firstWord(text) {
  const m = text.trim().match(/^([\p{L}\p{N}']+)/u);
  return m ? m[1] : "";
}

function endsWithConnector(text, connectors) {
  const words = text.trim().toLowerCase().match(/[\p{L}\p{N}']+/gu);
  if (!words || words.length === 0) return false;
  return connectors.includes(words[words.length - 1]);
}

/**
 * Is `comment` a continuation of the handle's open `block`? Requires BOTH the
 * time condition AND at least one continuation cue (spec Section 8).
 *
 * Tuning rule: inside the window, ambiguity resolves toward continuation,
 * because wrongly splitting is cheap and wrongly hiding a real question is not.
 */
export function isContinuation(block, comment, config) {
  if (!block) return false;

  // Time condition: within the window since the block's last fragment.
  const gap = comment.timestamp - block.lastTimestamp;
  if (gap > config.CONTINUATION_WINDOW_MS) return false;

  const prev = block.lastDisplayText.trim();
  const next = comment.displayText.trim();

  const cueNoTerminal = prev.length > 0 && !config.TERMINAL_PUNCTUATION.includes(lastChar(prev));
  const cueConnectorEnd =
    config.SENTENCE_COMMA.includes(lastChar(prev)) || endsWithConnector(prev, config.CONNECTOR_WORDS);
  const cueNearLimit = prev.length >= config.NEAR_LIMIT_CHARS;

  const fw = firstWord(next);
  const startsLowercase = fw.length > 0 && fw[0] === fw[0].toLowerCase() && fw[0] !== fw[0].toUpperCase();
  const startsWithConnector = config.CONNECTOR_WORDS.includes(fw.toLowerCase());
  const cueNewStart = startsLowercase || startsWithConnector;

  return cueNoTerminal || cueConnectorEnd || cueNearLimit || cueNewStart;
}

function openBlock(comment, status) {
  return {
    status, // 'question' (the one allowed) | 'extra' (a flagged extra)
    matchKey: comment.matchKey,
    displayText: comment.displayText,
    lastDisplayText: comment.displayText,
    lastTimestamp: comment.timestamp,
    fragmentCount: 1,
    fragments: [comment],
  };
}

function mergeContinuation(block, comment) {
  block.displayText = `${block.displayText} ${comment.displayText}`.trim();
  block.lastDisplayText = comment.displayText;
  block.lastTimestamp = comment.timestamp;
  block.fragmentCount += 1;
  block.fragments.push(comment);
  return block;
}

/**
 * Run one comment through the full pipeline. Mutates `state`. Returns a decision
 * the UI (and tests) act on:
 *
 *   { type: 'greeting',     comment }                  // salutation, not a question
 *   { type: 'continuation', comment, block }
 *   { type: 'duplicate',    comment, target, count }
 *   { type: 'primary',      comment, block }
 *   { type: 'extra',        comment, block, withinWindow }  // withinWindow flags an in-window (ambiguous) extra
 */
export function processComment(comment, state, config) {
  // 1 + 2. Normalize. Attach the derived fields to the comment.
  const { matchKey, displayText, isGreetingOnly } = normalize(comment.displayText, config);
  comment.matchKey = matchKey;
  comment.displayText = displayText;

  // 2b. Pre-filter: a comment that is ONLY a greeting/honorific («سلام»،
  // «السلام علیکم») is a salutation, not a question. It must never consume the
  // person's one question slot, anchor a duplicate, or be hidden as an extra,
  // otherwise a viewer who greets first would have their REAL question filtered
  // out. Leave it exactly as-is and stop. This sits before the pipeline and does
  // not affect the fixed order for real questions.
  if (isGreetingOnly) {
    return { type: "greeting", comment };
  }

  const key = identityKey(comment);
  const record = getOrCreateHandle(state, key);

  // 3. Continuation check against this handle's open block. Merge and stop, but
  // only while the block is under the cap. Once it already holds
  // MAX_COMMENTS_PER_QUESTION comments (the question plus its one allowed
  // continuation), a further fragment is NOT merged even if it looks like a
  // continuation: it falls through to be treated as an extra question. This is
  // what stops one person turning a single question into a three- or four-part
  // run that the teacher has to wade through.
  const atFragmentCap =
    record.open && record.open.fragmentCount >= config.MAX_COMMENTS_PER_QUESTION;

  // 3a. Double-send guard. The same person re-sending the SAME text (identical
  // matchKey after folding) is a duplicate, never a continuation: nobody
  // continues a question by repeating it verbatim, so this cannot be the split
  // question the continuation-first order protects. Merging it would double the
  // block's text and burn the one continuation slot. Collapse it onto the
  // existing signature and leave the block OPEN, so a genuine continuation
  // arriving after the re-send can still merge.
  if (record.open && comment.matchKey && comment.matchKey === record.open.matchKey) {
    const dup = checkDuplicate(comment.matchKey, state, config);
    if (dup.isDuplicate) {
      collapseOnto(dup.entry, comment);
      return { type: "duplicate", kind: dup.kind, comment, target: dup.entry, count: dup.entry.count };
    }
  }

  if (!atFragmentCap && isContinuation(record.open, comment, config)) {
    mergeContinuation(record.open, comment);
    // A fragment that continues an already-flagged EXTRA question is itself an
    // extra, but it arrived inside the window (it passed the continuation test),
    // so it is ambiguous and must be dimmed, never hidden. A fragment of the kept
    // primary question shows the "joined" badge.
    if (record.open.status === "extra") {
      return { type: "extra", comment, block: record.open, withinWindow: true };
    }
    return { type: "continuation", comment, block: record.open };
  }

  // Capture, BEFORE closing the block, whether this comment landed inside the
  // continuation window of the handle's still-open block. An "extra" inside that
  // window is ambiguous (a continuation we failed to detect, or an over-the-cap
  // fragment of a real question) and must be DIMMED, never hidden. Only an extra
  // clearly OUTSIDE the window is a genuine, separate second question that is
  // safe to filter out of the feed. This is the cost-asymmetry invariant: inside
  // the window, ambiguity never resolves toward hiding.
  const openAtEntry = record.open;
  const withinWindow =
    !!openAtEntry &&
    comment.timestamp - openAtEntry.lastTimestamp <= config.CONTINUATION_WINDOW_MS;

  // Not a continuation (or the block is at its cap): the open block's window has
  // ended. Close it.
  record.open = null;

  // 4. Duplicate check against the recent signature store (across all handles).
  const dup = checkDuplicate(comment.matchKey, state, config);
  if (dup.isDuplicate) {
    collapseOnto(dup.entry, comment);
    // kind distinguishes 'exact' (safe to auto-collapse) from 'fuzzy' (marked
    // only, never hidden in v1). The UI relies on this distinction.
    return { type: "duplicate", kind: dup.kind, comment, target: dup.entry, count: dup.entry.count };
  }

  // 5. New question vs extra question.
  if (!record.hasPrimaryQuestion) {
    record.hasPrimaryQuestion = true;
    const block = openBlock(comment, "question");
    record.open = block;
    registerSignature(comment, state, config);
    return { type: "primary", comment, block };
  }

  // The handle already used its one logical question -> flag this as extra.
  // Still open a block so a split of THIS extra question merges instead of
  // double-flagging, and still register its signature so others can dedup it.
  // `withinWindow` tells the UI whether this is safe to hide (clearly separate,
  // later) or must only be dimmed (ambiguous, inside the window).
  const block = openBlock(comment, "extra");
  record.open = block;
  registerSignature(comment, state, config);
  return { type: "extra", comment, block, withinWindow };
}
