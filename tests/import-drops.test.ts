// Import must report lost data (found 2026-11-08: a text animator whose properties sat outside
// "ADBE Text Animator Properties" imported with zero properties and `warnings: []`).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { annotateDrops, droppedFrom } from "../src/tools/import-drops.js";

const read = (f: string) => readFileSync(fileURLToPath(new URL(`../jsx/${f}`, import.meta.url)), "utf8");

describe("import never drops silently", () => {
  it("import.jsx warns DROPPED for a leaf with data that cannot be found or added", () => {
    const src = read("import.jsx");
    const i = src.indexOf("if (!prop) {\n                // Some properties");
    expect(i, "leaf-missing branch not found").toBeGreaterThan(0);
    const branch = src.slice(i, i + 900);
    expect(branch).toContain("DROPPED: property");
    expect(branch).toContain("carries");
  });

  it("import.jsx warns DROPPED when a placeholder is matched by display name only and cannot be added", () => {
    const src = read("import.jsx");
    const i = src.indexOf("A listed-but-never-added member");
    expect(i).toBeGreaterThan(0);
    const branch = src.slice(i, i + 900);
    expect(branch).toContain("DROPPED: property");
    expect(branch).toContain("continue;");
  });

  it("import.jsx warns DROPPED for a group that cannot be added when it holds data", () => {
    const src = read("import.jsx");
    expect(src).toContain("AE._groupCarriesData(gspec)");
    expect(src).toContain("DROPPED: group");
  });

  it("annotateDrops lists dropped values and a hint; nothing dropped = untouched", () => {
    const clean = { ok: true, result: { warnings: ["some other note"] } };
    expect(annotateDrops(clean)).toEqual([]);
    expect(clean.result).not.toHaveProperty("dropped");

    const lossy = { ok: true, result: { warnings: ["DROPPED: property 'ADBE Text Opacity' not found and cannot be added under 'ADBE Text Animator'", "x"] } };
    expect(droppedFrom(lossy)).toHaveLength(1);
    expect(annotateDrops(lossy)).toHaveLength(1);
    const r = lossy.result as Record<string, unknown>;
    expect(r.dropped).toHaveLength(1);
    expect(String(r.hint)).toContain("ADBE Text Animator Properties");
  });

  it("a result with no warnings array reads as nothing dropped, not as a crash", () => {
    expect(droppedFrom({ ok: true })).toEqual([]);
    expect(droppedFrom({ ok: true, result: {} })).toEqual([]);
    expect(droppedFrom({ ok: true, result: "text" })).toEqual([]);
  });

  it("the import tool exposes strict and fails with PARTIAL_IMPORT", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/tools/project-import.ts", import.meta.url)), "utf8");
    expect(src).toContain("strict: z");
    expect(src).toContain('"PARTIAL_IMPORT"');
  });
});
