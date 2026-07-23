/*
 * popup.js - wires the on/off switch to chrome.storage.local. The content
 * script listens for the change and applies it to the live feed instantly.
 *
 * Fail-safe: when chrome.storage is unavailable (e.g. the file is previewed
 * over plain http for a screenshot), the switch still works visually but
 * nothing is persisted, and one clear warning says so.
 */

import { CONFIG, STORAGE_KEYS } from "../src/config.js";

const L = CONFIG.LABELS;
const $ = (id) => document.getElementById(id);

$("tagline").textContent = L.popupTagline;
$("foot-text").textContent = L.popupFooter;

const hasStorage =
  typeof chrome !== "undefined" && !!chrome.storage?.local;
const manifest =
  typeof chrome !== "undefined" && chrome.runtime?.getManifest
    ? chrome.runtime.getManifest()
    : null;
$("version").textContent = manifest ? `v${manifest.version}` : "";

const toggle = $("toggle");
const pill = $("status-pill");

function paint(enabled) {
  toggle.setAttribute("aria-checked", String(enabled));
  document.body.classList.toggle("is-off", !enabled);
  pill.hidden = false;
  pill.textContent = enabled ? L.popupStatusOn : L.popupStatusOff;
  $("hint").textContent = enabled ? L.popupHintOn : L.popupHintOff;
}

let enabled = true;

if (hasStorage) {
  chrome.storage.local.get(STORAGE_KEYS.enabled).then(
    (items) => {
      enabled = items[STORAGE_KEYS.enabled] !== false; // default: enabled
      paint(enabled);
    },
    // Rejection handler only (not a chained catch), so an exception inside
    // paint() above can't trigger a second paint call here.
    () => {
      console.warn("[Bayān] could not read the saved state; showing enabled.");
      paint(enabled);
    }
  );
} else {
  console.warn(
    "[Bayān] chrome.storage unavailable (preview mode); the switch is not persisted."
  );
  paint(enabled);
}

toggle.addEventListener("click", () => {
  enabled = !enabled;
  paint(enabled);
  if (hasStorage) {
    chrome.storage.local.set({ [STORAGE_KEYS.enabled]: enabled });
  }
});
