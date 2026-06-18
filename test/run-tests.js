/*
 * run-tests.js - Node test runner for the matching core (spec Section 14 +
 * acceptance criteria 1-5), now exercised on Dari/Persian fixtures. Zero deps.
 *
 * The matching core is pure (no DOM, no chrome.*), so it runs here exactly as in
 * the browser. dom.js / ui.js / content.js are browser-only and verified live.
 */

import assert from "node:assert/strict";

import { CONFIG } from "../src/config.js";
import { normalize } from "../src/normalize.js";
import { createState, identityKey } from "../src/state.js";
import { jaccard } from "../src/dedup.js";
import { processComment } from "../src/grouping.js";
import { STREAMS } from "./mock-comments.js";

let passed = 0;
let failed = 0;
function group(name) {
  console.log(`\n${name}`);
}
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

function runStream(stream) {
  const state = createState();
  const decisions = stream.map((c) => processComment({ ...c }, state, CONFIG));
  return { state, decisions };
}

const key = (s) => normalize(s, CONFIG).matchKey;

// =====================================================================
group("normalize.js - Persian/Dari");

test("folds Arabic yeh/kaf and removes tatweel (same question, two keyboards)", () => {
  const persian = STREAMS.variantSpelling[0].displayText;
  const arabic = STREAMS.variantSpelling[1].displayText;
  assert.notEqual(persian, arabic, "fixtures must differ at the byte level");
  assert.equal(key(arabic), key(persian));
});

test("strips harakat (vowel marks)", () => {
  assert.equal(key("مُحَمَّد"), "محمد");
});

test("normalizes ZWNJ (می‌روم == میروم)", () => {
  assert.equal(key("می‌روم"), key("میروم"));
});

test("folds Persian and Arabic-Indic digits to ASCII", () => {
  assert.equal(key("۱۲۳"), "123");
  assert.equal(key("٤٥٦"), "456");
});

test("strips a leading Dari honorific/greeting", () => {
  assert.equal(key("سلام استاد، وقت نماز صبح چه وقت است؟"), key("وقت نماز صبح چه وقت است؟"));
});

test("still normalizes Latin text (safe fallback)", () => {
  assert.equal(key("Café"), "cafe");
});

// =====================================================================
group("dedup.js (jaccard token-set similarity)");

test("identical token sets => 1.0", () => {
  assert.equal(jaccard(["a", "b", "c"], ["a", "b", "c"]), 1);
});

test("disjoint token sets => 0.0", () => {
  assert.equal(jaccard(["a", "b"], ["c", "d"]), 0);
});

test("reordered Dari question scores at/above the 0.85 threshold", () => {
  const a = key(STREAMS.nearDuplicate[0].displayText).split(" ");
  const b = key(STREAMS.nearDuplicate[1].displayText).split(" ");
  assert.ok(jaccard(a, b) >= CONFIG.FUZZY_THRESHOLD, `jaccard was ${jaccard(a, b)}`);
});

// =====================================================================
group("state.js");

test("identity key is platform + handle (no cross-platform linking)", () => {
  assert.notEqual(
    identityKey({ handle: "احمد", platform: "youtube" }),
    identityKey({ handle: "احمد", platform: "facebook" })
  );
});

test("identity folds the handle: Arabic vs Persian keyboard spelling = same person", () => {
  assert.equal(
    identityKey({ handle: "كريم", platform: "youtube" }), // Arabic kaf + yeh
    identityKey({ handle: "کریم", platform: "youtube" }) // Persian keh + yeh
  );
});

test("identity folds Latin case and spacing: 'Ahmad  Khan' == 'ahmad khan'", () => {
  assert.equal(
    identityKey({ handle: "Ahmad  Khan", platform: "youtube" }),
    identityKey({ handle: "ahmad khan", platform: "youtube" })
  );
});

test("different names stay different people", () => {
  assert.notEqual(
    identityKey({ handle: "احمد", platform: "youtube" }),
    identityKey({ handle: "محمود", platform: "youtube" })
  );
});

// =====================================================================
group("Acceptance criteria (spec Section 15) - Dari");

test("1) same exact question x3 => shown once, count 3", () => {
  const { state, decisions } = runStream(STREAMS.exactTriplicate);
  assert.equal(decisions[0].type, "primary");
  assert.equal(decisions[1].type, "duplicate");
  assert.equal(decisions[2].type, "duplicate");
  assert.equal(decisions[2].count, 3);
  assert.equal(decisions[1].target, decisions[2].target);
  assert.equal(state.signatures.size, 1);
});

test("KEY: Arabic-keyboard spelling of the same question collapses as an exact duplicate", () => {
  const { state, decisions } = runStream(STREAMS.variantSpelling);
  assert.equal(decisions[0].type, "primary");
  assert.equal(decisions[1].type, "duplicate");
  assert.equal(decisions[1].kind, "exact");
  assert.equal(state.signatures.size, 1);
});

test("2) reworded/reordered near-duplicate is caught at default threshold", () => {
  const { decisions } = runStream(STREAMS.nearDuplicate);
  assert.equal(decisions[0].type, "primary");
  assert.equal(decisions[1].type, "duplicate");
  assert.equal(decisions[1].count, 2);
});

test("3) split question (same handle, in window, with cue) => one merged block", () => {
  const { state, decisions } = runStream(STREAMS.splitQuestion);
  assert.equal(decisions[0].type, "primary");
  assert.equal(decisions[1].type, "continuation");
  const block = decisions[1].block;
  assert.equal(block.fragmentCount, 2);
  assert.match(block.displayText, /میراث/);
  assert.match(block.displayText, /دارایی/);
  assert.equal(state.signatures.size, 1);
});

test("4) genuine second question later (outside window) => flagged extra", () => {
  const { decisions } = runStream(STREAMS.secondQuestionLater);
  assert.equal(decisions[0].type, "primary");
  assert.equal(decisions[1].type, "extra");
});

test("5) two different short questions from two handles => never merged", () => {
  const { state, decisions } = runStream(STREAMS.twoDifferentHandles);
  assert.equal(decisions[0].type, "primary");
  assert.equal(decisions[1].type, "primary");
  assert.equal(state.signatures.size, 2);
});

test("4b) distinct second question INSIDE window, no cue => extra", () => {
  const { decisions } = runStream(STREAMS.distinctSecondInsideWindow);
  assert.equal(decisions[0].type, "primary");
  assert.equal(decisions[1].type, "extra");
});

// =====================================================================
group("Cross-platform rules (your requirements)");

test("same text from two platforms => collapsed as a duplicate", () => {
  const { decisions } = runStream(STREAMS.crossPlatformDuplicate);
  assert.equal(decisions[0].type, "primary");
  assert.equal(decisions[1].type, "duplicate");
  assert.equal(decisions[1].count, 2);
});

test("same handle on two platforms, two questions => BOTH primary (no person-linking)", () => {
  const { state, decisions } = runStream(STREAMS.sameHandleCrossPlatform);
  assert.equal(decisions[0].type, "primary");
  assert.equal(decisions[1].type, "primary");
  assert.equal(state.signatures.size, 2);
});

test("duplicate that only matches after a leading honorific is stripped", () => {
  const { decisions } = runStream(STREAMS.honorificPrefixed);
  assert.equal(decisions[0].type, "primary");
  assert.equal(decisions[1].type, "duplicate");
});

test("same person, handle typed on two keyboards => second question flagged extra", () => {
  const { decisions } = runStream(STREAMS.variantHandleSecondQuestion);
  assert.equal(decisions[0].type, "primary");
  assert.equal(decisions[1].type, "extra");
});

// =====================================================================
group("Continuation cap & greeting pre-filter (new requirements)");

test("continuation is capped: question + ONE continuation kept, a third in-window fragment is blocked", () => {
  const { decisions } = runStream(STREAMS.cappedContinuation);
  assert.equal(decisions[0].type, "primary");
  assert.equal(decisions[1].type, "continuation");
  assert.equal(decisions[1].block.fragmentCount, 2);
  // The third comment still LOOKS like a continuation but is over the cap, so it
  // must be blocked (flagged extra), not merged into the question.
  assert.equal(decisions[2].type, "extra");
  // ...but it landed INSIDE the window, so it is dimmed (visible), NEVER hidden.
  // It may be the genuine tail of a real question; we must not destroy it.
  assert.equal(decisions[2].withinWindow, true);
});

test("a clearly separate, later second question is safe to HIDE (outside the window)", () => {
  const { decisions } = runStream(STREAMS.secondQuestionLater);
  assert.equal(decisions[1].type, "extra");
  assert.equal(decisions[1].withinWindow, false); // outside window => hidden
});

test("a second comment INSIDE the window is only dimmed, never hidden (cost-asymmetry)", () => {
  const { decisions } = runStream(STREAMS.distinctSecondInsideWindow);
  assert.equal(decisions[1].type, "extra");
  assert.equal(decisions[1].withinWindow, true); // inside window => dimmed, not hidden
});

test("MAX_COMMENTS_PER_QUESTION is honored as the cap value", () => {
  assert.equal(CONFIG.MAX_COMMENTS_PER_QUESTION, 2);
});

test("a greeting-only comment does not consume the person's one question slot", () => {
  const { decisions } = runStream(STREAMS.greetingThenQuestion);
  assert.equal(decisions[0].type, "greeting");
  // The real question, asked later, survives as primary instead of being
  // filtered out as the person's 'second' comment.
  assert.equal(decisions[1].type, "primary");
});

test("a bare greeting normalizes to isGreetingOnly", () => {
  assert.equal(normalize("سلام", CONFIG).isGreetingOnly, true);
  assert.equal(normalize("السلام علیکم", CONFIG).isGreetingOnly, true);
  // a real question is never a greeting, even with a leading honorific
  assert.equal(normalize("سلام استاد، حکم روزه چیست؟", CONFIG).isGreetingOnly, false);
});

// =====================================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
