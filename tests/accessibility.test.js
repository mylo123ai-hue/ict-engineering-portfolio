import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

function declarationsFor(selector) {
  const values = new Map();
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors.split(",").some(item => item.trim() === selector)) continue;
    for (const [, property, value] of body.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)) values.set(property, value.trim());
  }
  return values;
}

function color(value) {
  const match = value?.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  assert.ok(match, `expected a hex color, received ${value}`);
  const hex = match[1].length === 3 ? [...match[1]].map(char => char + char).join("") : match[1];
  return [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
}

function contrastRatio(foreground, background) {
  const luminance = rgb => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const [lighter, darker] = [luminance(color(foreground)), luminance(color(background))].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test("operational status and diagnostic labels retain readable contrast", () => {
  const root = declarationsFor(":root");
  const background = root.get("--canvas");
  const surface = root.get("--surface");
  const pairs = [
    [".eyebrow", background], [".priority", surface], [".priority.high", surface],
    [".sim-tag", background], [".network-intro p", background],
    [".note-items>div>span", surface], [".note-items p", surface],
    [".sequence-item>span", "#f3f5fa"],
    [".sequence-item.sequence-pass>span", "#eaf8f3"],
    [".sequence-item.sequence-fail>span", "#fff0ef"],
    [".sequence-item.sequence-warning>span", "#fff7e8"],
    [".sequence-item.sequence-blocked>span", "#f1f3f6"],
    [".sequence-item small", surface], [".diagnostic-result-head p", surface],
    [".result-summary strong", "#fff7e9"], [".result-summary p", "#fff7e9"],
    [".next-test p", surface], [".check-row", surface], [".check-index", surface],
    [".check-pass", surface], [".check-warning", surface], [".check-fail", surface],
    [".check-blocked", surface], [".text-action", surface], [".dialog-hint", "#f7f8fb"],
    [".sla-pill", "#edf8f3"], [".sla-due-soon", "#fff7e8"], [".sla-breached", "#fff0ef"]
  ];

  for (const [selector, backgroundColor] of pairs) {
    const foreground = declarationsFor(selector).get("color");
    assert.ok(foreground, `${selector} must declare a text color`);
    const ratio = contrastRatio(foreground, backgroundColor);
    assert.ok(ratio >= 4.5, `${selector} contrast ${ratio.toFixed(2)}:1 is below 4.5:1`);
  }
});
