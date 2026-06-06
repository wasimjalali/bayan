/*
 * dedup.js - exact + fuzzy duplicate detection (spec Section 9). Pure: no DOM,
 * no chrome.*. Operates on the signature store and recent-key buffer owned by
 * state.js.
 *
 * Exact:   the incoming matchKey already exists in the store.
 * Fuzzy:   token-set Jaccard similarity against the recent buffer is >= the
 *          threshold AND the token counts are within a sane length ratio. This
 *          catches reordered / lightly reworded repeats cheaply and is
 *          order-independent.
 */

/** Token-set Jaccard similarity. Order-independent, duplicates collapsed. */
export function jaccard(tokensA, tokensB) {
  const a = new Set(tokensA);
  const b = new Set(tokensB);
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return intersection / union;
}

/** Normalized Levenshtein ratio in [0,1]; 1 means identical strings. */
export function levenshteinRatio(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function tokensOf(matchKey) {
  return matchKey.length ? matchKey.split(" ") : [];
}

function lengthRatio(aCount, bCount) {
  if (aCount === 0 && bCount === 0) return 1;
  if (aCount === 0 || bCount === 0) return 0;
  return Math.min(aCount, bCount) / Math.max(aCount, bCount);
}

/**
 * Decide whether an incoming matchKey duplicates something already seen.
 *
 * @returns {{ isDuplicate: boolean, entry: object|null, kind: 'exact'|'fuzzy'|null }}
 */
export function checkDuplicate(matchKey, state, config) {
  // An empty key (e.g. a bare greeting) is never treated as a duplicate; we do
  // not want every empty signature collapsing together.
  if (!matchKey) return { isDuplicate: false, entry: null, kind: null };

  // Exact: O(1) map lookup.
  const exact = state.signatures.get(matchKey);
  if (exact) return { isDuplicate: true, entry: exact, kind: "exact" };

  // Fuzzy: compare only against the recent buffer (bounded work, spec 9).
  const incomingTokens = tokensOf(matchKey);
  const useLevenshtein =
    config.ENABLE_LEVENSHTEIN_SHORT &&
    incomingTokens.length <= config.SHORT_QUESTION_MAX_TOKENS;

  for (let i = state.recentKeys.length - 1; i >= 0; i--) {
    const candidateKey = state.recentKeys[i];
    if (candidateKey === matchKey) continue;
    const candidateTokens = tokensOf(candidateKey);

    if (lengthRatio(incomingTokens.length, candidateTokens.length) < config.FUZZY_LENGTH_RATIO) {
      continue;
    }

    const sim = jaccard(incomingTokens, candidateTokens);
    let isDup = sim >= config.FUZZY_THRESHOLD;

    // Optional secondary check for very short questions where token-set Jaccard
    // is unreliable (spec 9, behind a config flag).
    if (!isDup && useLevenshtein) {
      isDup = levenshteinRatio(matchKey, candidateKey) >= config.LEVENSHTEIN_THRESHOLD;
    }

    if (isDup) {
      const entry = state.signatures.get(candidateKey);
      if (entry) return { isDuplicate: true, entry, kind: "fuzzy" };
    }
  }

  return { isDuplicate: false, entry: null, kind: null };
}

/** Collapse an incoming comment onto an existing entry (keeps the data). */
export function collapseOnto(entry, comment) {
  entry.count += 1;
  entry.duplicates.push(comment);
  return entry;
}

/**
 * Register a brand-new question's signature so later comments can collapse onto
 * it. Maintains the bounded recent-key buffer (oldest dropped first).
 */
export function registerSignature(comment, state, config) {
  const matchKey = comment.matchKey;
  if (!matchKey) return null;

  const entry = {
    matchKey,
    displayText: comment.displayText,
    handle: comment.handle,
    platform: comment.platform ?? null,
    count: 1,
    duplicates: [],
    // The comment that first produced this signature. In the browser it carries
    // `.el` (the DOM node) so the UI can update the count badge on the original.
    firstComment: comment,
  };
  state.signatures.set(matchKey, entry);

  // keep the buffer distinct + bounded
  const existingIdx = state.recentKeys.indexOf(matchKey);
  if (existingIdx !== -1) state.recentKeys.splice(existingIdx, 1);
  state.recentKeys.push(matchKey);
  if (state.recentKeys.length > config.DEDUP_BUFFER_SIZE) {
    state.recentKeys.shift();
  }

  return entry;
}
