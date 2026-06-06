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
 *   { type: 'continuation', comment, block }
 *   { type: 'duplicate',    comment, target, count }
 *   { type: 'primary',      comment, block }
 *   { type: 'extra',        comment, block }
 */
export function processComment(comment, state, config) {
  // 1 + 2. Normalize. Attach the derived fields to the comment.
  const { matchKey, displayText } = normalize(comment.displayText, config);
  comment.matchKey = matchKey;
  comment.displayText = displayText;

  const key = identityKey(comment);
  const record = getOrCreateHandle(state, key);

  // 3. Continuation check against this handle's open block. Merge and stop.
  if (isContinuation(record.open, comment, config)) {
    mergeContinuation(record.open, comment);
    return { type: "continuation", comment, block: record.open };
  }

  // Not a continuation: the open block's window has ended. Close it.
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
  const block = openBlock(comment, "extra");
  record.open = block;
  registerSignature(comment, state, config);
  return { type: "extra", comment, block };
}
