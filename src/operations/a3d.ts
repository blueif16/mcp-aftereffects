// Advanced 3D operations — environment-light sources and 3D model fitting.
// The A3D renderer ("ADBE Calder") lights shiny surfaces from what they
// reflect; the source of an environment light is a LAYER attribute
// (LightLayer.lightSource), not a property, so property.set cannot reach it.

import { registerOp, jsxVal, jsxCompLayerPreamble } from "../registry.js";

registerOp({
  name: "light.set_source",
  category: "light",
  description:
    "Set the source of an environment light (LightLayer.lightSource, AE 25.2+) — the HDRI/image/video/comp it lights and reflects with in the Advanced 3D renderer. " +
    "source: a 2D layer of the comp (index, name or { id }), or a project item ({ item: id|name }, or a name no layer has) such as an imported .hdr/.exr, which is added to the comp as a 2D layer with its video switched off (it lights, never draws). " +
    "Switches the light to environment if needed. source: null clears it. Saved in project JSON (attrs.lightSourceIndex).",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "layer",
      type: "any",
      description: "The light layer: 1-based index, name, or { id }",
      required: true,
    },
    {
      name: "source",
      type: "any",
      description:
        "Layer index / name / { id }, or { item: footageOrCompIdOrName }; null clears the source",
      required: true,
      nullable: true,
    },
    {
      name: "hide",
      type: "boolean",
      description:
        "Switch the video of a layer this call ADDS off, so it only lights (default true). Existing layers are left as they are.",
      required: false,
      default: true,
    },
    {
      name: "makeEnvironment",
      type: "boolean",
      description: "Switch a non-environment light to environment first (default true)",
      required: false,
      default: true,
    },
  ],
  toJsx(args) {
    return `
            ${jsxCompLayerPreamble(args)}
            return AE.setLightSource(_layer, ${jsxVal(args.source)}, { hide: ${jsxVal(args.hide !== false)}, makeEnvironment: ${jsxVal(args.makeEnvironment !== false)} });
        `;
  },
});

registerOp({
  name: "layer.fit_model",
  category: "layer",
  description:
    "Scale a 3D model layer (GLB/glTF, which arrive at real-world units) so its larger on-screen dimension (from layer.bounds / sourceRectAtTime) is `size` px, uniformly on X/Y/Z. " +
    "center=true (default) also moves the anchor to the model's bounds center so it rotates in place and stays where Position puts it. Works on any layer with sourceRectAtTime.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "layer",
      type: "any",
      description: "1-based layer index, name, or { id }",
      required: true,
    },
    { name: "size", type: "number", description: "Target size in px", required: true },
    {
      name: "axis",
      type: "string",
      description: "max|width|height — which bounds dimension becomes `size` (default max)",
      required: false,
      default: "max",
    },
    {
      name: "center",
      type: "boolean",
      description: "Move the anchor point to the bounds center (default true)",
      required: false,
      default: true,
    },
    {
      name: "time",
      type: "number",
      description: "Time to measure at, in seconds (default: comp time)",
      required: false,
    },
  ],
  toJsx(args) {
    return `
            ${jsxCompLayerPreamble(args)}
            if (typeof _layer.sourceRectAtTime !== "function") return { ok: false, error: "layer '" + _layer.name + "' has no bounds (camera/light?)" };
            var _size = ${jsxVal(args.size)};
            if (!(_size > 0)) return { ok: false, error: "size must be > 0" };
            var _t = ${jsxVal(args.time ?? null)};
            if (_t === null) _t = _comp.time;
            var _r = _layer.sourceRectAtTime(_t, false);
            if (!(_r.width > 0) || !(_r.height > 0)) return { ok: false, error: "layer '" + _layer.name + "' reports empty bounds (" + _r.width + "x" + _r.height + ")" };
            var _axis = ${jsxVal(args.axis ?? "max")};
            var _dim = _axis === "width" ? _r.width : (_axis === "height" ? _r.height : Math.max(_r.width, _r.height));
            var _pct = 100 * _size / _dim;
            var _xf = _layer.property("ADBE Transform Group");
            var _scale = _xf.property("ADBE Scale");
            var _is3d = false;
            try { _is3d = _layer.threeDLayer === true; } catch (e3) {}
            var _sv = _is3d ? [_pct, _pct, _pct] : [_pct, _pct];
            try { AE.writeValue(_scale, _sv); } catch (eS) { return { ok: false, error: AE.describeSetError(_scale, eS, _sv) }; }
            var _anchor = null;
            if (${jsxVal(args.center !== false)}) {
                var _ap = _xf.property("ADBE Anchor Point");
                var _cur = _ap.value;
                var _c = [_r.left + _r.width / 2, _r.top + _r.height / 2];
                if (_cur.length > 2) _c.push(_cur[2]);
                try { AE.writeValue(_ap, _c); _anchor = _c; } catch (eA) { return { ok: false, error: AE.describeSetError(_ap, eA, _c) }; }
            }
            return {
                ok: true,
                name: _layer.name,
                measured: { left: _r.left, top: _r.top, width: _r.width, height: _r.height },
                scalePercent: _pct,
                anchorPoint: _anchor,
                fittedSize: [_r.width * _pct / 100, _r.height * _pct / 100]
            };
        `;
  },
});
