/*
 * ui.js - in-place annotation of StreamYard's comments (spec Section 10).
 * Browser-only (uses document). It NEVER reads StreamYard's structure: it only
 * decorates the exact comment node dom.js already located. All StreamYard
 * selector knowledge stays in config.js / dom.js.
 *
 * All visible text comes from CONFIG.LABELS (Dari), and badges render
 * right-to-left so Persian shows correctly. Confidence tiers (Section 10 + the
 * v1 human-in-the-loop rule):
 *   - Exact duplicate     -> collapse (hide) + count badge on the original, but
 *                            ONLY if AUTO_COLLAPSE_EXACT_DUPLICATES.
 *   - Fuzzy / near dup     -> marked + dimmed, NEVER hidden.
 *   - Continuation merge   -> "joined" badge, both fragments stay visible.
 *   - Extra (2nd) question -> "2nd question" badge + dimmed, NEVER hidden.
 *
 * AUTO_HIDE_ANYTHING_AMBIGUOUS stays false in v1: nothing ambiguous is hidden.
 */

const ANNOTATED_ATTR = "data-syqf-annotated";
const COUNT_CLASS = "syqf-count";
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

function digits(n, persian) {
  return persian ? String(n).replace(/[0-9]/g, (d) => FA_DIGITS[d]) : String(n);
}

function ensureBadge(node, kind, text, dir) {
  if (!node) return null;
  let badge = node.querySelector(`.syqf-badge.syqf-badge--${kind}`);
  if (!badge) {
    badge = document.createElement("span");
    badge.className = `syqf-badge syqf-badge--${kind}`;
    node.appendChild(badge);
  }
  badge.setAttribute("dir", dir);
  badge.textContent = text;
  return badge;
}

function setCountBadge(originalNode, count, config) {
  if (!originalNode) return;
  let badge = originalNode.querySelector(`.${COUNT_CLASS}`);
  if (!badge) {
    badge = document.createElement("span");
    badge.className = `syqf-badge ${COUNT_CLASS}`;
    originalNode.appendChild(badge);
  }
  badge.setAttribute("dir", config.UI_DIRECTION);
  badge.textContent = config.LABELS.askedTimes.replace(
    "{n}",
    digits(count, config.USE_PERSIAN_DIGITS_IN_UI)
  );
}

function originalNodeOf(decision) {
  return decision.target?.firstComment?.el ?? null;
}

/**
 * Act on a pipeline decision. Always fail safe: missing node -> do nothing
 * (a throw is also caught upstream in content.js).
 */
export function render(decision, config) {
  const node = decision.comment?.el ?? null;
  if (!node) return;
  const dir = config.UI_DIRECTION;

  switch (decision.type) {
    case "primary":
      node.classList.add("syqf-primary");
      break;

    case "continuation":
      node.classList.add("syqf-joined");
      ensureBadge(node, "joined", config.LABELS.joined, dir);
      break;

    case "duplicate": {
      setCountBadge(originalNodeOf(decision), decision.count, config);
      const isExact = decision.kind === "exact";
      if (isExact && config.AUTO_COLLAPSE_EXACT_DUPLICATES && !config.AUTO_HIDE_ANYTHING_AMBIGUOUS) {
        node.classList.add("syqf-collapsed"); // data retained in state; only hidden
      } else {
        node.classList.add("syqf-dim");
        ensureBadge(node, "dup", config.LABELS.possibleDuplicate, dir);
      }
      break;
    }

    case "extra":
      node.classList.add("syqf-dim");
      ensureBadge(node, "extra", config.LABELS.secondQuestion, dir);
      break;

    default:
      break;
  }

  node.setAttribute(ANNOTATED_ATTR, decision.type);
}
