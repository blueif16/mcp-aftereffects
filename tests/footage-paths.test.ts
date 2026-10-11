// Unit tests for footage path relinking (export relativeTo / import baseDir + pathMap).

import { describe, expect, it } from "vitest";

import {
  isAbsolutePath,
  relativizeFootagePaths,
  resolveFootagePaths,
} from "../src/footage-paths.js";

function doc(...files: Array<string | null>) {
  return {
    items: [
      ...files.map((file, i) => ({ id: i + 1, type: "FootageItem", sourceKind: "file", file })),
      {
        id: 99,
        type: "CompItem",
        proxy: { sourceKind: "file", useProxy: true, file: "D:/media/proxy/p_0001.png" },
      },
      { id: 100, type: "FootageItem", sourceKind: "solid", color: [1, 0, 0] },
    ],
  };
}

const files = (d: { items: Array<Record<string, unknown>> }) =>
  d.items.map((i) => (i.proxy ? (i.proxy as { file: string }).file : i.file));

describe("isAbsolutePath", () => {
  it.each([
    ["D:/a/b.png", true],
    ["d:\\a\\b.png", true],
    ["//server/share/x.mov", true],
    ["/home/ran/x.mov", true],
    ["assets/x.mov", false],
    ["./x.mov", false],
    ["../x.mov", false],
  ])("%s -> %s", (p, want) => expect(isAbsolutePath(p)).toBe(want));
});

describe("relativizeFootagePaths", () => {
  it("makes paths under the base relative, case-insensitively on drives, and leaves others", () => {
    const d = doc(
      "D:/media/assets/a.mov",
      "d:\\Media\\renders\\t_0001.png",
      "E:/other/c.wav",
      null,
    );
    const n = relativizeFootagePaths(d, "D:/media/");
    expect(n).toBe(3);
    expect(files(d)).toEqual([
      "assets/a.mov",
      "renders/t_0001.png",
      "E:/other/c.wav",
      null,
      "proxy/p_0001.png",
      undefined,
    ]);
  });

  it("does not match a sibling directory that shares the prefix", () => {
    const d = doc("D:/media-old/a.mov");
    relativizeFootagePaths(d, "D:/media");
    expect(files(d)[0]).toBe("D:/media-old/a.mov");
  });
});

describe("resolveFootagePaths", () => {
  it("joins relative paths onto baseDir and folds ./..", () => {
    const d = doc("assets/a.mov", "./renders/../renders/t_0001.png", "E:/abs.wav");
    const r = resolveFootagePaths(d, { baseDir: "D:/mirror/vid\\" });
    expect(r).toEqual({ rewritten: 2, unresolved: [] });
    expect(files(d).slice(0, 3)).toEqual([
      "D:/mirror/vid/assets/a.mov",
      "D:/mirror/vid/renders/t_0001.png",
      "E:/abs.wav",
    ]);
  });

  it("applies pathMap before baseDir, first match wins", () => {
    const d = doc("D:/old/a.mov", "rel/b.mov");
    resolveFootagePaths(d, {
      baseDir: "F:/base",
      pathMap: [
        { from: "d:/OLD", to: "E:/new" },
        { from: "D:/old", to: "X:/never" },
        { from: "rel", to: "G:/mapped" },
      ],
    });
    expect(files(d).slice(0, 2)).toEqual(["E:/new/a.mov", "G:/mapped/b.mov"]);
  });

  it("keeps UNC prefixes", () => {
    const d = doc("x/y.mov");
    resolveFootagePaths(d, { baseDir: "//wsl.localhost/Ubuntu/home/p" });
    expect(files(d)[0]).toBe("//wsl.localhost/Ubuntu/home/p/x/y.mov");
  });

  it("reports relative paths it cannot resolve", () => {
    const d = doc("assets/a.mov");
    expect(resolveFootagePaths(d, {}).unresolved).toEqual(["assets/a.mov"]);
  });

  it("round-trips with relativize", () => {
    const d = doc("D:/m/a/b.mov", "D:/m/seq/f_0001.png");
    relativizeFootagePaths(d, "D:/m");
    resolveFootagePaths(d, { baseDir: "E:/elsewhere" });
    expect(files(d).slice(0, 2)).toEqual(["E:/elsewhere/a/b.mov", "E:/elsewhere/seq/f_0001.png"]);
  });
});
