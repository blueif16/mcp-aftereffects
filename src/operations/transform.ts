// Transform operations — set position, scale, rotation, opacity, anchor point.

import { registerOp, jsxVal, jsxFail, jsxCompPreamble } from "../registry.js";

/** Transform values transform.set writes; layer.set_props routes the same keys here. */
export const TRANSFORM_VALUE_KEYS = [
  "position",
  "scale",
  "rotation",
  "orientation",
  "opacity",
  "anchorPoint",
] as const;

/**
 * JSX statements that write transform values on `_l` (its Transform group in
 * `_xf`), pushing per-key failures onto `_w`. Shared by transform.set and
 * layer.set_props so a transform key means the same thing in both.
 */
export function transformWriteLines(
  args: Record<string, unknown>,
): { lines: string[] } | { error: string } {
  const sets: string[] = [];
  if (args.threeDLayer !== undefined)
    sets.push(
      `try { _l.threeDLayer = ${jsxVal(args.threeDLayer)}; } catch(e) { _w.push("3D: " + AE.errText(e)); }`,
    );
  // Position goes through AE.writeValue: after Separate Dimensions (and on
  // shape layers made from vector layers) setValue on the leader throws.
  if (args.position !== undefined)
    sets.push(
      `try { AE.writeValue(_xf.position, ${jsxVal(args.position)}); } catch(e) { _w.push("position: " + AE.describeSetError(_xf.position, e, ${jsxVal(args.position)})); }`,
    );
  if (args.scale !== undefined)
    sets.push(
      `try { AE.writeValue(_xf.scale, ${jsxVal(args.scale)}); } catch(e) { _w.push("scale: " + AE.describeSetError(_xf.scale, e, ${jsxVal(args.scale)})); }`,
    );
  if (Array.isArray(args.rotation)) {
    const rot = args.rotation as unknown[];
    if (rot.length < 1 || rot.length > 3 || !rot.every((n) => typeof n === "number")) {
      return { error: "rotation must be a number or an array of 1-3 numbers [x,y,z]" };
    }
    // [z] alone is plain Z; [x,y] / [x,y,z] address the 3D streams.
    const streams =
      rot.length === 1 ? ["ADBE Rotate Z"] : ["ADBE Rotate X", "ADBE Rotate Y", "ADBE Rotate Z"];
    sets.push(`
                var _rot = ${jsxVal(rot)};
                var _rs = ${jsxVal(streams)};
                var _rot3d = (_l instanceof CameraLayer) || (_l instanceof LightLayer) || AE.safeGet(function () { return _l.threeDLayer === true; }, false);
                if (_rs.length > 1 && !_rot3d && (_rot[0] !== 0 || _rot[1] !== 0)) {
                    _w.push("rotation: X/Y rotation needs a 3D layer (pass threeDLayer: true); only Z was set");
                }
                for (var _ri = 0; _ri < _rs.length && _ri < _rot.length; _ri++) {
                    if (!_rot3d && _rs[_ri] !== "ADBE Rotate Z") continue;
                    var _rp = _xf.property(_rs[_ri]);
                    // An axis already at the asked value is left alone: on lights some
                    // rotation axes are hidden (an environment light only turns on Y).
                    if (AE.safeGet(function () { return _rp.numKeys === 0 && Math.abs(_rp.value - _rot[_ri]) < 1e-9; }, false)) continue;
                    try { _rp.setValue(_rot[_ri]); } catch (e) { _w.push("rotation: " + AE.describeSetError(_rp, e, _rot[_ri])); }
                }`);
  } else if (args.rotation !== undefined) {
    if (typeof args.rotation !== "number") {
      return { error: "rotation must be a number or an array [x,y,z]" };
    }
    sets.push(
      `try { _xf.property("ADBE Rotate Z").setValue(${jsxVal(args.rotation)}); } catch(e) { _w.push("rotation: " + AE.describeSetError(_xf.property("ADBE Rotate Z"), e, ${jsxVal(args.rotation)})); }`,
    );
  }
  if (args.orientation !== undefined) {
    sets.push(`
                var _or = _xf.property("ADBE Orientation");
                if (!_or) _w.push("orientation: layer has no Orientation (2D layer? pass threeDLayer: true)");
                else { try { AE.writeValue(_or, ${jsxVal(args.orientation)}); } catch (e) { _w.push("orientation: " + AE.describeSetError(_or, e, ${jsxVal(args.orientation)})); } }`);
  }
  if (args.opacity !== undefined)
    sets.push(
      `try { _xf.opacity.setValue(${jsxVal(args.opacity)}); } catch(e) { _w.push("opacity: " + AE.describeSetError(_xf.opacity, e, ${jsxVal(args.opacity)})); }`,
    );
  if (args.anchorPoint !== undefined)
    sets.push(
      `try { AE.writeValue(_xf.anchorPoint, ${jsxVal(args.anchorPoint)}); } catch(e) { _w.push("anchorPoint: " + AE.errText(e)); }`,
    );
  return { lines: sets };
}

registerOp({
  name: "transform.set",
  category: "transform",
  description:
    "Set transform properties on one or more layers. layer can be index, name, 'selected', or 'all'. For keyframes use keyframe.add. " +
    "rotation is degrees: a number sets Z rotation; [x,y,z] sets X/Y/Z Rotation on 3D layers, cameras and lights. orientation is [x,y,z] degrees (3D only).",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "layer",
      type: "any",
      description: "Layer index (number), name (string), 'selected', or 'all'",
      required: true,
    },
    { name: "position", type: "array", description: "[x,y] or [x,y,z]", required: false },
    {
      name: "scale",
      type: "array",
      description: "[sx,sy] or [sx,sy,sz] in percent",
      required: false,
    },
    {
      name: "rotation",
      type: "any",
      description: "Degrees: a number (Z rotation) or [x,y,z] (X/Y/Z Rotation, 3D layers)",
      required: false,
    },
    {
      name: "orientation",
      type: "array",
      description: "[x,y,z] Orientation in degrees (3D layers, cameras, lights)",
      required: false,
    },
    { name: "opacity", type: "number", description: "Opacity 0-100", required: false },
    { name: "anchorPoint", type: "array", description: "[x,y] or [x,y,z]", required: false },
    { name: "threeDLayer", type: "boolean", description: "Enable/disable 3D", required: false },
  ],
  toJsx(args) {
    const w = transformWriteLines(args);
    if ("error" in w) return jsxFail(w.error);
    const sets = w.lines;
    return `
            ${jsxCompPreamble(args)}
            var _layers = AE.resolveLayers(_comp, ${jsxVal(args.layer)});
            if (_layers.length === 0) return { ok: false, error: "no layers matched" };
            var _results = [];
            for (var _li = 0; _li < _layers.length; _li++) {
                var _l = _layers[_li];
                var _xf = _l.transform;
                var _w = [];
                ${sets.join("\n")}
                _results.push({ name: _l.name, warnings: _w });
            }
            // Every layer refusing every write is a failed call, not a success with notes.
            var _anyClean = false, _allW = [];
            for (var _ci = 0; _ci < _results.length; _ci++) {
                if (_results[_ci].warnings.length === 0) _anyClean = true;
                for (var _wi = 0; _wi < _results[_ci].warnings.length; _wi++) _allW.push(_results[_ci].name + ": " + _results[_ci].warnings[_wi]);
            }
            var _res = { ok: true, count: _results.length, layers: _results };
            if (!_anyClean && _allW.length) { _res.ok = false; _res.error = _allW.join("; "); }
            return _res;
        `;
  },
});
