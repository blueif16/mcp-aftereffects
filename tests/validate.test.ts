// Unit tests for the Node-side schema validator. Runs without AE.

import { describe, expect, it } from "vitest";

import { SCHEMA_VERSION } from "../src/schema.js";
import { validateAeProjectDoc } from "../src/validate.js";

interface TestCase {
  name: string;
  input: unknown;
  expectOk: boolean;
  expectIssuePaths?: string[];
  expectWarningPaths?: string[];
  expectNoWarnings?: boolean;
}

const cases: TestCase[] = [
  {
    name: "items in the root folder (id 0) do not warn",
    input: {
      schemaVersion: SCHEMA_VERSION,
      items: [{ id: 5, name: "f", type: "FolderItem", parentFolderId: 0 }],
    },
    expectOk: true,
    expectNoWarnings: true,
  },
  {
    name: "v4 footage: sequence, interpretation, proxy, placeholder",
    input: {
      schemaVersion: SCHEMA_VERSION,
      items: [
        {
          id: 1,
          name: "seq",
          type: "FootageItem",
          parentFolderId: null,
          sourceKind: "file",
          file: "D:/m/hf_1001.png",
          width: 640,
          height: 360,
          duration: 1,
          sequence: { start: 1001, end: 1030, digits: 4 },
          interpretation: {
            alphaMode: "STRAIGHT",
            fieldSeparationType: 5613,
            invertAlpha: false,
            conformFrameRate: 29.97,
            loop: 1,
            premulColor: [0, 0, 0],
          },
          proxy: { sourceKind: "placeholder", useProxy: false, width: 320, height: 180 },
        },
        {
          id: 2,
          name: "ph",
          type: "FootageItem",
          parentFolderId: null,
          sourceKind: "placeholder",
          width: 1280,
          height: 720,
          duration: 5,
        },
        {
          id: 3,
          name: "c",
          type: "CompItem",
          parentFolderId: null,
          width: 100,
          height: 100,
          duration: 1,
          frameRate: 30,
          proxy: { sourceKind: "file", useProxy: true, file: "D:/m/p.mov" },
        },
      ],
    },
    expectOk: true,
  },
  {
    name: "v4 footage: bad sequence, interpretation and proxy",
    input: {
      schemaVersion: SCHEMA_VERSION,
      items: [
        {
          id: 1,
          name: "seq",
          type: "FootageItem",
          parentFolderId: null,
          sourceKind: "file",
          file: "a.png",
          sequence: { start: 10, end: 5 },
          interpretation: { alphaMode: "not a name!", premulColor: [0, 0], invertAlpha: 1 },
          proxy: { sourceKind: "file", useProxy: "yes" },
        },
        { id: 2, name: "ph", type: "FootageItem", parentFolderId: null, sourceKind: "placeholder" },
      ],
    },
    expectOk: false,
    expectIssuePaths: [
      "items[0].sequence",
      "items[0].interpretation.alphaMode",
      "items[0].interpretation.invertAlpha",
      "items[0].interpretation.premulColor",
      "items[0].proxy.useProxy",
      "items[0].proxy.file",
      "items[1]",
    ],
  },
  {
    name: "valid minimal doc",
    input: {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: "now",
      aeVersion: "26.0",
      project: { file: null, bitsPerChannel: 8, timeDisplayType: "0" },
      items: [],
    },
    expectOk: true,
  },
  {
    name: "missing schemaVersion",
    input: { items: [] },
    expectOk: false,
    expectIssuePaths: ["schemaVersion"],
  },
  {
    name: "items not an array",
    input: { schemaVersion: 2, items: "nope" },
    expectOk: false,
    expectIssuePaths: ["items"],
  },
  {
    name: "valid doc with one folder",
    input: {
      schemaVersion: 2,
      items: [
        {
          id: 1,
          name: "folder1",
          type: "FolderItem",
          parentFolderId: null,
          parentFolderName: null,
          label: 0,
          comment: "",
        },
      ],
    },
    expectOk: true,
  },
  {
    name: "duplicate item ids",
    input: {
      schemaVersion: 2,
      items: [
        {
          id: 1,
          name: "a",
          type: "FolderItem",
          parentFolderId: null,
          parentFolderName: null,
          label: 0,
          comment: "",
        },
        {
          id: 1,
          name: "b",
          type: "FolderItem",
          parentFolderId: null,
          parentFolderName: null,
          label: 0,
          comment: "",
        },
      ],
    },
    expectOk: false,
    expectIssuePaths: ["items[1].id"],
  },
  {
    name: "comp missing width",
    input: {
      schemaVersion: 2,
      items: [
        {
          id: 1,
          name: "comp",
          type: "CompItem",
          parentFolderId: null,
          parentFolderName: null,
          label: 0,
          comment: "",
          height: 1080,
          duration: 5,
          frameRate: 30,
        },
      ],
    },
    expectOk: false,
    expectIssuePaths: ["items[0].width"],
  },
  {
    name: "layer sourceId references missing item (warning only)",
    input: {
      schemaVersion: 2,
      items: [
        {
          id: 1,
          name: "comp",
          type: "CompItem",
          parentFolderId: null,
          parentFolderName: null,
          label: 0,
          comment: "",
          width: 1920,
          height: 1080,
          duration: 5,
          frameRate: 30,
          layers: [
            {
              index: 1,
              name: "layer",
              type: "AVLayer",
              enabled: true,
              solo: false,
              shy: false,
              locked: false,
              inPoint: 0,
              outPoint: 5,
              startTime: 0,
              stretch: 100,
              parentIndex: null,
              label: 0,
              sourceId: 9999,
            },
          ],
        },
      ],
    },
    expectOk: true,
    expectWarningPaths: ["items[0].layers[0].sourceId"],
  },
  {
    name: "parentFolderId dangling reference",
    input: {
      schemaVersion: 2,
      items: [
        {
          id: 1,
          name: "a",
          type: "FolderItem",
          parentFolderId: 99,
          parentFolderName: null,
          label: 0,
          comment: "",
        },
      ],
    },
    expectOk: true,
    expectWarningPaths: ["items[0].parentFolderId"],
  },
  {
    name: "parentFolderId points at a non-folder",
    input: {
      schemaVersion: 2,
      items: [
        {
          id: 1,
          name: "c",
          type: "CompItem",
          parentFolderId: null,
          parentFolderName: null,
          label: 0,
          comment: "",
          width: 100,
          height: 100,
          duration: 1,
          frameRate: 30,
        },
        {
          id: 2,
          name: "x",
          type: "FolderItem",
          parentFolderId: 1,
          parentFolderName: null,
          label: 0,
          comment: "",
        },
      ],
    },
    expectOk: true,
    expectWarningPaths: ["items[1].parentFolderId"],
  },
  {
    // Documented policy: refuse documents newer than the runtime schema.
    // Users can force an import with skipValidation.
    name: "newer schema version is a validation error",
    input: { schemaVersion: 99, items: [] },
    expectOk: false,
    expectIssuePaths: ["schemaVersion"],
  },
];

describe("validateAeProjectDoc", () => {
  for (const tc of cases) {
    it(tc.name, () => {
      const result = validateAeProjectDoc(tc.input);
      expect(
        result.ok,
        `ok mismatch — issues: ${JSON.stringify(result.issues)}, warnings: ${JSON.stringify(result.warnings)}`,
      ).toBe(tc.expectOk);
      for (const p of tc.expectIssuePaths ?? []) {
        expect(result.issues.map((i) => i.path)).toContain(p);
      }
      if (tc.expectNoWarnings) expect(result.warnings).toEqual([]);
      for (const p of tc.expectWarningPaths ?? []) {
        expect(result.warnings.map((w) => w.path)).toContain(p);
      }
    });
  }
});
