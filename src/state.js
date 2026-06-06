/*
 * state.js - the session's data structures (spec Section 13). Pure: no DOM,
 * no chrome.*. Holds the per-handle map, the duplicate signature store, and the
 * recent-key buffer. The algorithms live in dedup.js / grouping.js; this module
 * only owns the shape of the data and small accessors.
 */

import { foldHandle } from "./normalize.js";

/**
 * @typedef {Object} HandleRecord
 * @property {QuestionBlock|null} open  the handle's currently-open block (for
 *   continuation merging), or null if no question is open.
 * @property {boolean} hasPrimaryQuestion  whether the handle has already had its
 *   one allowed logical question registered this session.
 */

export function createState() {
  return {
    // identityKey (platform::handle) -> HandleRecord
    handles: new Map(),
    // matchKey -> signature entry { matchKey, displayText, handle, platform,
    //   count, duplicates: [] }
    signatures: new Map(),
    // rolling list of recent distinct matchKeys for fuzzy comparison, capped at
    // DEDUP_BUFFER_SIZE (oldest dropped first).
    recentKeys: [],
  };
}

/**
 * Identity is platform + folded handle. We never link the same name across
 * platforms (spec Risk 2): the one-question rule applies within a single
 * platform/handle. The handle is folded (case, Arabic↔Persian letters, ZWNJ,
 * harakat, spacing) so the same person typed two ways is one person.
 */
export function identityKey(comment) {
  const platform = comment.platform ?? "?";
  return `${platform}::${foldHandle(comment.handle)}`;
}

/** Get the handle's record, creating an empty one on first sight. */
export function getOrCreateHandle(state, key) {
  let record = state.handles.get(key);
  if (!record) {
    record = { open: null, hasPrimaryQuestion: false };
    state.handles.set(key, record);
  }
  return record;
}
