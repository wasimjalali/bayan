/*
 * dom.js - the ONLY fragile layer. Everything StreamYard-specific about reading
 * the page lives here (and the selector strings in config.js). Nothing else in
 * the codebase touches StreamYard's HTML. Spec Sections 4 (Risk 3) and 12.
 *
 * Browser-only module: it uses `document`. It is never imported by the matching
 * core or the Node tests. If selectors stop matching, every function here fails
 * safe (returns null / empty and logs a single clear warning) so the native
 * feed is left untouched.
 */

import { SELECTORS } from "./config.js";

const TAG = "[Bayān]";

// Warn at most once per failure kind so a broken selector cannot spam the
// console hundreds of times under live comment volume.
const warnedOnce = new Set();
function warnOnce(key, message) {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  console.warn(`${TAG} ${message}`);
}

/** True only when the operator has verified the selectors on a live studio. */
export function selectorsConfirmed() {
  return SELECTORS.CONFIRMED === true;
}

/**
 * Find the element that contains all comments. Returns null and warns once if
 * the container selector matches nothing (StreamYard changed, or wrong page).
 */
export function findCommentContainer(root = document) {
  const container = root.querySelector(SELECTORS.commentContainer);
  if (!container) {
    warnOnce(
      "container",
      `comments container not found. Selectors are unconfirmed or StreamYard's ` +
        `layout changed. Doing nothing (fail-safe). Update SELECTORS in config.js.`
    );
    return null;
  }
  return container;
}

/** Get every comment node currently in the container (for the initial scan). */
export function collectCommentNodes(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(SELECTORS.commentNode));
}

/**
 * Given any node added to the DOM, return the comment row it belongs to (or
 * null). Handles both "the comment node itself was added" and "a child of it
 * was added" cases that a MutationObserver can surface.
 */
export function closestCommentNode(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
  if (node.matches?.(SELECTORS.commentNode)) return node;
  return node.closest?.(SELECTORS.commentNode) ?? null;
}

function readText(el) {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Read a platform label (youtube / facebook / ...) from a comment node, or null
 * if StreamYard renders no indicator. Tries an alt/title/aria-label first
 * (icons), then falls back to text content.
 */
function extractPlatform(commentNode) {
  const el = commentNode.querySelector(SELECTORS.platformIndicator);
  if (!el) return null;
  const label =
    el.getAttribute?.("alt") ||
    el.getAttribute?.("title") ||
    el.getAttribute?.("aria-label") ||
    readText(el);
  const cleaned = (label || "").toLowerCase().trim();
  return cleaned.length ? cleaned : null;
}

/**
 * Extract one comment from a comment node into the plain object the matching
 * core expects: { handle, platform, displayText, timestamp, el }.
 *
 * Returns null if the row has no handle or no text (can't be processed safely).
 * `timestamp` is arrival time (Date.now) because StreamYard exposes no reliable
 * per-comment time; the core only ever compares timestamps, never parses them.
 */
export function extractComment(commentNode) {
  if (!commentNode) return null;

  const handleEl = commentNode.querySelector(SELECTORS.authorHandle);
  const textEl = commentNode.querySelector(SELECTORS.text);

  const handle = readText(handleEl);
  const displayText = readText(textEl);

  if (!handle || !displayText) {
    warnOnce(
      "fields",
      `found comment node(s) but could not read handle or text. Author/text ` +
        `selectors are likely stale. Update SELECTORS in config.js.`
    );
    return null;
  }

  return {
    handle,
    platform: extractPlatform(commentNode),
    displayText,
    timestamp: Date.now(),
    el: commentNode,
  };
}
