// Offline tests for the Advanced 3D additions (2026-10): environment-light
// sources, 3D rotation arrays, camera lens, model fitting, settable/hidden
// property listing, full error text, and render.frame waiting for its PNG.
// Live behaviour (renders, round trips) is covered by
// research/tools/a3d_roundtrip.py against After Effects.

import { mkdtempSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { getOp } from "../src/registry.js";
// Importing the operation registry for its registration side effects.
import "../src/operations/index.js";

describe("light.set_source", () => {
  it("routes the source through AE.setLightSource, item refs and null included", () => {
    const op = getOp("light.set_source")!;
    const byLayer = op.toJsx({ comp: "Main", layer: "env", source: "hdri_layer" });
    expect(byLayer).toContain(
      'AE.setLightSource(_layer, "hdri_layer", { hide: true, makeEnvironment: true })',
    );
    const byItem = op.toJsx({ comp: "Main", layer: "env", source: { item: 43 }, hide: false });
    expect(byItem).toContain('AE.setLightSource(_layer, {"item":43}, { hide: false');
    expect(op.toJsx({ comp: "Main", layer: "env", source: null })).toContain(
      "AE.setLightSource(_layer, null,",
    );
  });

  it("is also reachable from layer.set_props and layer.create_light", () => {
    const sp = getOp("layer.set_props")!.toJsx({
      comp: "Main",
      layer: "env",
      props: { lightSource: "hdri_layer", name: "env2" },
    });
    expect(sp).toContain('AE.setLightSource(_l, "hdri_layer"');
    expect(sp).not.toContain('_l["lightSource"]');
    const cl = getOp("layer.create_light")!.toJsx({
      comp: "Main",
      lightType: "environment",
      source: { item: "hdri" },
    });
    expect(cl).toContain('var _srcArg = {"item":"hdri"};');
    expect(cl).toContain("AE.setLightSource(_layer, _srcArg");
  });
});

describe("transform.set 3D rotation", () => {
  const base = { comp: "Main", layer: 1 };

  it("maps [x,y,z] onto the X/Y/Z rotation streams", () => {
    const jsx = getOp("transform.set")!.toJsx({ ...base, rotation: [10, 20, 30] });
    expect(jsx).toContain('["ADBE Rotate X","ADBE Rotate Y","ADBE Rotate Z"]');
    expect(jsx).toContain("var _rot = [10,20,30];");
  });

  it("keeps a plain number as Z rotation and takes orientation arrays", () => {
    const jsx = getOp("transform.set")!.toJsx({ ...base, rotation: 15, orientation: [0, 90, 0] });
    expect(jsx).toContain('_xf.property("ADBE Rotate Z").setValue(15)');
    expect(jsx).toContain('_xf.property("ADBE Orientation")');
  });

  it("refuses malformed rotations before AE", () => {
    const op = getOp("transform.set")!;
    expect(op.toJsx({ ...base, rotation: [1, 2, 3, 4] })).toContain("array of 1-3 numbers");
    expect(op.toJsx({ ...base, rotation: ["a"] })).toContain("array of 1-3 numbers");
    expect(op.toJsx({ ...base, rotation: "x" })).toContain("must be a number or an array");
  });
});

describe("layer.create_camera lens", () => {
  it("turns focalLength into Zoom on a 36 mm film back", () => {
    const jsx = getOp("layer.create_camera")!.toJsx({
      comp: "Main",
      focalLength: 85,
      position: [960, 540, -2000],
      pointOfInterest: [960, 540, 0],
    });
    expect(jsx).toContain("_zm = _comp.width * _fl / 36");
    expect(jsx).toContain('"ADBE Anchor Point"'); // point of interest
  });

  it("refuses focalLength together with zoom, and non-positive lenses", () => {
    const op = getOp("layer.create_camera")!;
    expect(op.toJsx({ comp: "Main", focalLength: 50, zoom: 1000 })).toContain("not both");
    expect(op.toJsx({ comp: "Main", focalLength: 0 })).toContain("> 0 mm");
  });
});

describe("property ops", () => {
  it("property.list probes settable/hidden unless told not to", () => {
    const op = getOp("property.list")!;
    expect(op.toJsx({ comp: "Main", layer: 1, property: [] })).toContain("var _probe = true;");
    expect(op.toJsx({ comp: "Main", layer: 1, property: [], probe: false })).toContain(
      "var _probe = false;",
    );
  });

  it("property.set reports AE's full error with range instead of 50 characters", () => {
    const jsx = getOp("property.set")!.toJsx({
      comp: "Main",
      layer: 1,
      property: ["Mesh Options", "Ring Sides"],
      value: 128,
    });
    expect(jsx).toContain("AE.describeSetError(_node, e, _value)");
    expect(jsx).toContain("AE.childProperty(_node, _propPath[_pi])");
    expect(jsx).not.toContain("substring(0, 50)");
  });
});

describe("render.frame waits for its PNG", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mcp-ae-render-settle-"));

  it("passes a result whose file is on disk", async () => {
    const file = path.join(dir, "ok.png");
    writeFileSync(file, Buffer.alloc(64, 1));
    const result: Record<string, unknown> = { ok: true, writtenTo: file };
    await getOp("render.frame")!.afterJsx!(result, {});
    expect(result.ok).toBe(true);
    expect(result.bytes).toBe(64);
  });

  it("batch.run recounts after a child's follow-up fails", async () => {
    const ok = path.join(dir, "batch-ok.png");
    writeFileSync(ok, Buffer.alloc(8, 1));
    const result = {
      ok: true,
      error: null as string | null,
      failed: 0,
      results: [{ ok: true }, { ok: true, writtenTo: ok }] as Array<Record<string, unknown>>,
    };
    await getOp("batch.run")!.afterJsx!(result, {
      ops: [
        { operation: "transform.set", args: {} },
        { operation: "render.frame", args: {} },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.results[1].bytes).toBe(8);
    // A child that already failed in JSX keeps the batch failed.
    const failing = { ok: true, error: null, failed: 0, results: [{ ok: false }, { ok: true }] };
    await getOp("batch.run")!.afterJsx!(failing, {
      ops: [
        { operation: "transform.set", args: {} },
        { operation: "comp.info", args: {} },
      ],
    });
    expect(failing.ok).toBe(false);
    expect(failing.failed).toBe(1);
  });
});
