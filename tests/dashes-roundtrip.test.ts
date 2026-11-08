// Stroke > Dashes round trip (found 2026-11-08): AE lists Dash 2..3, Gap 1..3 and
// Offset from the start but hides them until addProperty. Export used to write
// all of them with defaults, import wrote them through setValue (throws, hidden)
// and the stroke stayed solid. These are static guards; the live check is
// research/tools/dash_animator_roundtrip.py in the main repo.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(fileURLToPath(new URL(`../jsx/${f}`, import.meta.url)), "utf8");

describe("stroke dashes round trip", () => {
  it("export skips dash slots that were never added", () => {
    const src = read("helpers.jsx");
    const line = src.split("\n").find((l) => l.includes('"ADBE Vector Stroke Dashes"'));
    expect(line, "export filter for the Dashes group is missing").toBeTruthy();
    expect(line).toContain("canSetExpression");
    expect(line).toContain("continue");
  });

  it("import adds each dash slot before writing it", () => {
    const src = read("import.jsx");
    const i = src.indexOf('target.matchName === "ADBE Vector Stroke Dashes"');
    expect(i, "importShapeContents must special-case the Dashes group").toBeGreaterThan(0);
    expect(src.slice(i, i + 220)).toContain("AE._addChild(target, ps.matchName)");
  });
});
