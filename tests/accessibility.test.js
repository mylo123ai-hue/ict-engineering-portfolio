import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

function declarationsFor(selector) {
  const values = new Map();
  const rules = /([^{}]+)\{([^{}]*)\}/g;
  for (const [, selectors, body] of css.matchAll(rules)) {
    if (!selectors.split(",").some(item => item.trim() === selector)) continue;
    for (const [, property, value] of body.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)) {
      values.set(property, value.trim());
    }
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

test("operational labels retain readable color contrast", () => {
  const root = declarationsFor(":root");
  const background = root.get("--canvas");
  const surface = root.get("--surface");
  const pairs = [
    [".main-area .page-heading .eyebrow", background],
    [".main-area .priority", surface],
    [".main-area .priority.high", surface],
    [".main-area .sim-tag", background],
    [".main-area .network-intro p", background],
    [".main-area .note-items>div>span", surface],
    [".main-area .note-items p", surface],
    [".main-area .sequence-item>span", declarationsFor(".sequence-item>span").get("background")],
    [".main-area .sequence-item.sequence-pass>span", declarationsFor(".sequence-item.sequence-pass>span").get("background")],
    [".main-area .sequence-item.sequence-fail>span", declarationsFor(".sequence-item.sequence-fail>span").get("background")],
    [".main-area .sequence-item.sequence-warning>span", declarationsFor(".sequence-item.sequence-warning>span").get("background")],
    [".main-area .sequence-item.sequence-blocked>span", declarationsFor(".sequence-item.sequence-blocked>span").get("background")],
    [".main-area .sequence-item small", surface],
    [".main-area .result-summary strong", "#fff7e9"],
    [".main-area .check-row", surface],
    [".main-area .check-pass", surface],
    [".main-area .check-warning", surface],
    [".main-area .check-fail", surface],
    [".main-area .check-blocked", surface],
    [".status-pill.recovery-verification-required", "#fff7e9"],
    [".text-action", surface],
    [".dialog-root .dialog-hint", "#f7f8fb"],
    [".main-area .sla-pill", declarationsFor(".sla-pill").get("background")],
    [".main-area .sla-due-soon", declarationsFor(".sla-due-soon").get("background")],
    [".main-area .sla-breached", declarationsFor(".sla-breached").get("background")]
  ];

  for (const [selector, backgroundColor] of pairs) {
    const foreground = declarationsFor(selector).get("color");
    assert.ok(foreground, `${selector} must declare an accessible text color`);
    const ratio = contrastRatio(foreground, backgroundColor);
    assert.ok(ratio >= 4.5, `${selector} contrast ${ratio.toFixed(2)}:1 is below 4.5:1`);
  }
});

test("maintenance guidance describes service verification after rollback", () => {
  assert.match(app, /Record rollback, then verify service against its pre-change baseline\./);
});
