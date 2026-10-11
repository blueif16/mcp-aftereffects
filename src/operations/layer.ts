// Layer operations — create, delete, duplicate, set properties.

import { registerOp, jsxVal, jsxFail, jsxCompPreamble, jsxCompLayerPreamble } from "../registry.js";

registerOp({
  name: "layer.create_solid",
  category: "layer",
  description: "Create a solid layer in a composition.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    { name: "name", type: "string", description: "Layer name", required: false, default: "Solid" },
    {
      name: "color",
      type: "array",
      description: "[r,g,b] 0-1",
      required: false,
      default: [1, 1, 1],
    },
    {
      name: "width",
      type: "number",
      description: "Width in px (default: comp width)",
      required: false,
    },
    {
      name: "height",
      type: "number",
      description: "Height in px (default: comp height)",
      required: false,
    },
  ],
  toJsx(args) {
    return `
            ${jsxCompPreamble(args)}
            var _w = ${jsxVal(args.width)} || _comp.width;
            var _h = ${jsxVal(args.height)} || _comp.height;
            var _layer = _comp.layers.addSolid(${jsxVal(args.color ?? [1, 1, 1])}, ${jsxVal(args.name ?? "Solid")}, _w, _h, _comp.pixelAspect, _comp.duration);
            return { ok: true, index: _layer.index, name: _layer.name };
        `;
  },
});

registerOp({
  name: "layer.create_adjustment",
  category: "layer",
  description:
    "Create an adjustment layer (a comp-sized solid with adjustmentLayer on) — the carrier for comp-wide effects such as Posterize Time or a color grade. Add effects with effect.add.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "name",
      type: "string",
      description: "Layer name",
      required: false,
      default: "Adjustment Layer",
    },
    {
      name: "width",
      type: "number",
      description: "Width in px (default: comp width)",
      required: false,
    },
    {
      name: "height",
      type: "number",
      description: "Height in px (default: comp height)",
      required: false,
    },
  ],
  toJsx(args) {
    return `
            ${jsxCompPreamble(args)}
            var _w = ${jsxVal(args.width)} || _comp.width;
            var _h = ${jsxVal(args.height)} || _comp.height;
            var _layer = _comp.layers.addSolid([1, 1, 1], ${jsxVal(args.name ?? "Adjustment Layer")}, _w, _h, _comp.pixelAspect, _comp.duration);
            _layer.adjustmentLayer = true;
            return { ok: true, index: _layer.index, name: _layer.name, adjustmentLayer: _layer.adjustmentLayer };
        `;
  },
});

registerOp({
  name: "layer.create_shape",
  category: "layer",
  description: "Create an empty shape layer.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    { name: "name", type: "string", description: "Layer name", required: false },
  ],
  toJsx(args) {
    return `
            ${jsxCompPreamble(args)}
            var _layer = _comp.layers.addShape();
            ${args.name ? `_layer.name = ${jsxVal(args.name)};` : ""}
            return { ok: true, index: _layer.index, name: _layer.name };
        `;
  },
});

registerOp({
  name: "layer.create_text",
  category: "layer",
  description:
    "Create a text layer: point text by default, paragraph (box) text when boxSize is given, vertical when orientation='vertical' (AE 24.2+). Point<->box conversion is not scriptable, so pick the right kind here.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    { name: "text", type: "string", description: "Text content", required: false, default: "" },
    { name: "name", type: "string", description: "Layer name", required: false },
    {
      name: "boxSize",
      type: "array",
      description: "[width, height] — creates paragraph (box) text instead of point text",
      required: false,
    },
    {
      name: "boxPosition",
      type: "array",
      description: "[x, y] top-left of the box in layer space (box text only)",
      required: false,
    },
    {
      name: "orientation",
      type: "string",
      description: "horizontal|vertical (vertical needs AE 24.2+)",
      required: false,
      default: "horizontal",
    },
  ],
  toJsx(args) {
    // Hoisted: the codegen lint's template scanner cannot see through raw
    // braces inside a `${…}` interpolation.
    const boxPosJsx = !args.boxPosition
      ? ""
      : `try {
                var _src = _layer.property("Source Text");
                var _doc = _src.value;
                _doc.boxTextPos = ${jsxVal(args.boxPosition)};
                _src.setValue(_doc);
            } catch (eBp) {}`;
    return `
            ${jsxCompPreamble(args)}
            var _box = ${jsxVal(args.boxSize ?? null)};
            var _vertical = ${jsxVal(args.orientation)} === "vertical";
            var _layer;
            if (_box !== null) {
                if (_vertical) {
                    if (typeof _comp.layers.addVerticalBoxText !== "function") return { ok: false, error: "vertical box text needs AE 24.2+" };
                    _layer = _comp.layers.addVerticalBoxText(_box, ${jsxVal(args.text ?? "")});
                } else {
                    _layer = _comp.layers.addBoxText(_box, ${jsxVal(args.text ?? "")});
                }
            } else {
                if (_vertical) {
                    if (typeof _comp.layers.addVerticalText !== "function") return { ok: false, error: "vertical text needs AE 24.2+" };
                    _layer = _comp.layers.addVerticalText(${jsxVal(args.text ?? "")});
                } else {
                    _layer = _comp.layers.addText(${jsxVal(args.text ?? "")});
                }
            }
            ${args.name ? `_layer.name = ${jsxVal(args.name)};` : ""}
            ${boxPosJsx}
            return { ok: true, index: _layer.index, name: _layer.name, boxText: _box !== null, vertical: _vertical };
        `;
  },
});

registerOp({
  name: "layer.create_null",
  category: "layer",
  description: "Create a null object layer.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    { name: "name", type: "string", description: "Layer name", required: false },
  ],
  toJsx(args) {
    return `
            ${jsxCompPreamble(args)}
            var _layer = _comp.layers.addNull();
            ${args.name ? `_layer.name = ${jsxVal(args.name)};` : ""}
            return { ok: true, index: _layer.index, name: _layer.name };
        `;
  },
});

registerOp({
  name: "layer.create_camera",
  category: "layer",
  description:
    "Create a two-node camera. focalLength is in mm on a 36 mm film back (Zoom = compWidth × focalLength / 36; 85–170 mm reads as calm product framing, 24–35 mm as energy); zoom sets the Zoom property in px directly. " +
    "position/pointOfInterest are comp-space [x,y,z] (default: AE's camera, looking at the comp center). depthOfField/focusDistance/aperture set the DOF options.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    { name: "name", type: "string", description: "Layer name", required: false, default: "Camera" },
    {
      name: "focalLength",
      type: "number",
      description: "Lens in mm (36 mm film width). Mutually exclusive with zoom.",
      required: false,
    },
    { name: "zoom", type: "number", description: "Camera Zoom in px", required: false },
    { name: "position", type: "array", description: "[x,y,z] camera position", required: false },
    {
      name: "pointOfInterest",
      type: "array",
      description: "[x,y,z] point the camera looks at",
      required: false,
    },
    {
      name: "depthOfField",
      type: "boolean",
      description: "Depth of Field on/off",
      required: false,
    },
    {
      name: "focusDistance",
      type: "number",
      description: "Focus Distance in px (the distance to the subject)",
      required: false,
    },
    { name: "aperture", type: "number", description: "Aperture in px", required: false },
  ],
  toJsx(args) {
    if (args.focalLength !== undefined && args.zoom !== undefined) {
      return jsxFail("pass focalLength OR zoom, not both");
    }
    if (args.focalLength !== undefined && !((args.focalLength as number) > 0)) {
      return jsxFail("focalLength must be > 0 mm");
    }
    return `
            ${jsxCompPreamble(args)}
            var _layer = _comp.layers.addCamera(${jsxVal(args.name ?? "Camera")}, [_comp.width/2, _comp.height/2]);
            var _w = [];
            var _opt = _layer.property("ADBE Camera Options Group");
            var _xf = _layer.property("ADBE Transform Group");
            function _set(p, v, what) {
                try { AE.writeValue(p, v); } catch (e) { _w.push(what + ": " + AE.describeSetError(p, e, v)); }
            }
            var _fl = ${jsxVal(args.focalLength ?? null)};
            var _zm = ${jsxVal(args.zoom ?? null)};
            if (_fl !== null) _zm = _comp.width * _fl / 36;
            if (_zm !== null) _set(_opt.property("ADBE Camera Zoom"), _zm, "zoom");
            var _pos = ${jsxVal(args.position ?? null)};
            var _poi = ${jsxVal(args.pointOfInterest ?? null)};
            // A camera's Point of Interest is the Anchor Point stream.
            if (_poi !== null) _set(_xf.property("ADBE Anchor Point"), _poi, "pointOfInterest");
            if (_pos !== null) _set(_xf.property("ADBE Position"), _pos, "position");
            var _dof = ${jsxVal(args.depthOfField ?? null)};
            if (_dof !== null) _set(_opt.property("ADBE Camera Depth of Field"), _dof ? 1 : 0, "depthOfField");
            var _fd = ${jsxVal(args.focusDistance ?? null)};
            if (_fd !== null) _set(_opt.property("ADBE Camera Focus Distance"), _fd, "focusDistance");
            var _ap = ${jsxVal(args.aperture ?? null)};
            if (_ap !== null) _set(_opt.property("ADBE Camera Aperture"), _ap, "aperture");
            var _zoomNow = _opt.property("ADBE Camera Zoom").value;
            var _out = {
                ok: _w.length === 0,
                index: _layer.index,
                name: _layer.name,
                zoom: _zoomNow,
                focalLength: _zoomNow * 36 / _comp.width,
                position: AE.valueToJson(_xf.property("ADBE Position").value),
                pointOfInterest: AE.valueToJson(_xf.property("ADBE Anchor Point").value)
            };
            if (_w.length) { _out.error = _w.join("; "); _out.warnings = _w; }
            return _out;
        `;
  },
});

registerOp({
  name: "layer.create_light",
  category: "layer",
  description: "Create a light layer.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    { name: "name", type: "string", description: "Layer name", required: false, default: "Light" },
    {
      name: "lightType",
      type: "string",
      description:
        "spot|parallel|point|ambient|environment (environment needs AE 24.3+ / Advanced 3D)",
      required: false,
      default: "spot",
    },
    {
      name: "source",
      type: "any",
      description:
        "Environment lights only: what it lights with — a 2D layer (index/name/{id}) or a project item ({ item: id|name }, e.g. an imported .hdr), added as a hidden 2D layer. Same as light.set_source.",
      required: false,
    },
  ],
  toJsx(args) {
    return `
            ${jsxCompPreamble(args)}
            var _ltMap = {
                "spot": LightType.SPOT,
                "parallel": LightType.PARALLEL,
                "point": LightType.POINT,
                "ambient": LightType.AMBIENT
            };
            // 24.3+ only — probed so older hosts keep the classic four.
            try { if (LightType.ENVIRONMENT !== undefined) _ltMap.environment = LightType.ENVIRONMENT; } catch (eEnv) {}
            var _ltArg = ${jsxVal(args.lightType ?? "spot")};
            if (!_ltMap.hasOwnProperty(_ltArg)) {
                return { ok: false, error: "unknown lightType '" + _ltArg + "'" + (_ltArg === "environment" ? " — environment lights need AE 24.3+" : "") };
            }
            var _layer = _comp.layers.addLight(${jsxVal(args.name ?? "Light")}, [_comp.width/2, _comp.height/2]);
            var _applied = null;
            try { _layer.lightType = _ltMap[_ltArg]; _applied = _ltArg; } catch (eLt) {}
            var _out = { ok: true, index: _layer.index, name: _layer.name, lightType: _applied };
            var _srcArg = ${jsxVal(args.source ?? null)};
            if (_srcArg !== null) {
                if (_ltArg !== "environment") return { ok: false, error: "source applies to environment lights only (lightType 'environment')", index: _layer.index, name: _layer.name };
                var _sr = AE.setLightSource(_layer, _srcArg, { hide: true, makeEnvironment: true });
                if (!_sr.ok) { _out.ok = false; _out.error = "light created, source not set: " + _sr.error; return _out; }
                _out.source = _sr.source;
                _out.sourceAdded = _sr.added;
                if (_sr.warning) _out.warning = _sr.warning;
                // The source layer may have been added on top: report the light's index now.
                _out.index = _layer.index;
            }
            return _out;
        `;
  },
});

registerOp({
  name: "layer.create_parametric_mesh",
  category: "layer",
  description:
    "Create a parametric 3D mesh layer (LayerCollection.addParametricMesh, AE 26.3+): cube|sphere|plane|cylinder|cone|torus. Best rendered with the Advanced 3D renderer (comp.set_renderer).",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    { name: "name", type: "string", description: "Layer name", required: false, default: "Mesh" },
    {
      name: "meshType",
      type: "string",
      description: "cube|sphere|plane|cylinder|cone|torus",
      required: true,
    },
  ],
  toJsx(args) {
    return `
            ${jsxCompPreamble(args)}
            if (typeof _comp.layers.addParametricMesh !== "function") return { ok: false, error: "addParametricMesh needs AE 26.3+" };
            var _mtMap = {
                "cube": ParametricMeshType.CUBE,
                "sphere": ParametricMeshType.SPHERE,
                "plane": ParametricMeshType.PLANE,
                "cylinder": ParametricMeshType.CYLINDER,
                "cone": ParametricMeshType.CONE,
                "torus": ParametricMeshType.TORUS
            };
            var _mtArg = ${jsxVal(args.meshType)};
            if (!_mtMap.hasOwnProperty(_mtArg)) return { ok: false, error: "meshType must be cube|sphere|plane|cylinder|cone|torus" };
            var _layer = null;
            try { _layer = _comp.layers.addParametricMesh(${jsxVal(args.name ?? "Mesh")}, _mtMap[_mtArg]); } catch (ePm) { return { ok: false, error: "addParametricMesh failed: " + AE.errText(ePm) }; }
            return { ok: true, index: _layer.index, name: _layer.name, meshType: _mtArg };
        `;
  },
});

registerOp({
  name: "layer.delete",
  category: "layer",
  description:
    "Delete layers. comp supports pattern ('review_id_*'). layer supports index, name, 'selected', 'all'.",
  params: [
    {
      name: "comp",
      type: "any",
      description: "Comp name/id/pattern (e.g. 'review_id_*')",
      required: true,
    },
    {
      name: "layer",
      type: "any",
      description: "Layer index, name, 'selected', or 'all'",
      required: true,
    },
  ],
  toJsx(args) {
    return `
            var _comps = AE.findComps(${jsxVal(args.comp)});
            if (_comps.length === 0) return { ok: false, error: "no comps matched" };
            var _removed = 0;
            for (var _ci = 0; _ci < _comps.length; _ci++) {
                var _layers = AE.resolveLayers(_comps[_ci], ${jsxVal(args.layer)});
                for (var _li = _layers.length - 1; _li >= 0; _li--) {
                    try { _layers[_li].remove(); _removed++; } catch(e) {}
                }
            }
            return { ok: true, removed: _removed, comps: _comps.length };
        `;
  },
});

registerOp({
  name: "layer.duplicate",
  category: "layer",
  description: "Duplicate a layer. Returns the new layer's index.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "layer",
      type: "any",
      description: "1-based layer index, or the layer name",
      required: true,
    },
    { name: "newName", type: "string", description: "Name for the duplicate", required: false },
  ],
  toJsx(args) {
    return `
            ${jsxCompLayerPreamble(args)}
            var _dup = _layer.duplicate();
            ${args.newName ? `_dup.name = ${jsxVal(args.newName)};` : ""}
            return { ok: true, index: _dup.index, name: _dup.name };
        `;
  },
});

registerOp({
  name: "layer.set_parent",
  category: "layer",
  description:
    "Set or clear a layer's parent. By default AE compensates the child's transform so it doesn't move; jump=true skips compensation (setParentWithJump) so the child adopts the parent's space.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "layer",
      type: "any",
      description: "1-based child layer index, or the layer name",
      required: true,
    },
    {
      name: "parentLayer",
      type: "any",
      description: "1-based parent layer index or name. Pass null or 0 to unparent.",
      required: true,
      nullable: true,
    },
    {
      name: "jump",
      type: "boolean",
      description: "true = no transform compensation (setParentWithJump). Default false.",
      required: false,
      default: false,
    },
  ],
  toJsx(args) {
    const parentVal =
      args.parentLayer === null || args.parentLayer === 0
        ? "null"
        : `_comp.layer(${jsxVal(args.parentLayer)})`;
    const assign =
      args.jump === true
        ? `if (typeof _layer.setParentWithJump !== "function") return { ok: false, error: "setParentWithJump needs AE 17.1+" };
            _layer.setParentWithJump(${parentVal});`
        : `_layer.parent = ${parentVal};`;
    return `
            ${jsxCompLayerPreamble(args)}
            ${assign}
            return { ok: true, parent: _layer.parent ? { index: _layer.parent.index, name: _layer.parent.name } : null };
        `;
  },
});

registerOp({
  name: "layer.scene_edit_detection",
  category: "layer",
  description:
    "Run Scene Edit Detection on a video layer (Layer.doSceneEditDetection, AE 22.3+): find cuts in edited footage and mark or split at them.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "layer",
      type: "any",
      description: "1-based layer index, or the layer name",
      required: true,
    },
    {
      name: "mode",
      type: "string",
      description:
        "markers (add layer markers) | split (split layer) | splitPrecomp (split + precompose each) | none (detect only)",
      required: true,
    },
  ],
  toJsx(args) {
    return `
            ${jsxCompLayerPreamble(args)}
            if (typeof _layer.doSceneEditDetection !== "function") return { ok: false, error: "doSceneEditDetection needs AE 22.3+" };
            var _sdMap = {
                "markers": SceneEditDetectionMode.MARKERS,
                "split": SceneEditDetectionMode.SPLIT,
                "splitPrecomp": SceneEditDetectionMode.SPLIT_PRECOMP,
                "none": SceneEditDetectionMode.NONE
            };
            var _mode = ${jsxVal(args.mode)};
            if (!_sdMap.hasOwnProperty(_mode)) return { ok: false, error: "mode must be markers|split|splitPrecomp|none" };
            var _edits = null;
            try { _edits = _layer.doSceneEditDetection(_sdMap[_mode]); } catch (eSd) { return { ok: false, error: "doSceneEditDetection failed: " + AE.errText(eSd) }; }
            return { ok: true, mode: _mode, editTimes: AE.valueToJson(_edits), numLayers: _comp.numLayers };
        `;
  },
});

registerOp({
  name: "layer.move",
  category: "layer",
  description: "Move a layer to a new stacking position (1 = top).",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "layer",
      type: "any",
      description: "1-based current layer index, or the layer name",
      required: true,
    },
    {
      name: "toIndex",
      type: "number",
      description: "1-based target index, within 1..numLayers",
      required: true,
    },
  ],
  toJsx(args) {
    return `
            ${jsxCompLayerPreamble(args)}
            var _to = ${jsxVal(args.toIndex)};
            if (typeof _to !== "number" || isNaN(_to) || _to !== Math.floor(_to)) {
                return { ok: false, error: "toIndex must be a whole number, got " + _to };
            }
            if (_to < 1 || _to > _comp.numLayers) {
                return { ok: false, error: "toIndex " + _to + " is out of range (comp has " + _comp.numLayers + " layers)" };
            }
            var _from = _layer.index;
            // NOT _layer.moveTo(_to). Layer inherits moveTo from PropertyBase,
            // so it exists and type-checks — and then throws for every layer,
            // every time: "Can not moveTo this property, because parent is not
            // an INDEXED_GROUP". A layer's parent is the composition, not a
            // property group, so the inherited method never applies. Reordering
            // layers is only expressible relative to a sibling.
            if (_to < _from) {
                // Upward: land directly above whoever holds _to right now.
                _layer.moveBefore(_comp.layer(_to));
            } else if (_to > _from) {
                // Downward: everything between _from and _to shifts up by one
                // as soon as _layer vacates its slot, so the layer currently at
                // _to ends up at _to - 1 — landing AFTER it is what puts
                // _layer at _to.
                _layer.moveAfter(_comp.layer(_to));
            }
            return { ok: true, fromIndex: _from, newIndex: _layer.index, name: _layer.name };
        `;
  },
});

registerOp({
  name: "layer.create_footage",
  category: "layer",
  description: "Add an existing project item (footage or comp) as a layer in a composition.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "sourceItemId",
      type: "number",
      description: "Project item id to use as source",
      required: true,
    },
    { name: "name", type: "string", description: "Layer name", required: false },
  ],
  toJsx(args) {
    return `
            ${jsxCompPreamble(args)}
            var _src = AE.findItemById(${jsxVal(args.sourceItemId)});
            if (!_src) return { ok: false, error: "no item with id " + ${jsxVal(args.sourceItemId)} };
            var _layer = _comp.layers.add(_src);
            ${args.name ? `_layer.name = ${jsxVal(args.name)};` : ""}
            return { ok: true, index: _layer.index, name: _layer.name };
        `;
  },
});

registerOp({
  name: "layer.set_enabled",
  category: "layer",
  description:
    "Enable or disable a layer by name or index. Can target all comps matching a pattern.",
  params: [
    {
      name: "comp",
      type: "any",
      description: "Comp name/id, or '*' for all comps, or 'review_id_*' for pattern match",
      required: true,
    },
    {
      name: "layer",
      type: "any",
      description: "Layer index (number) or name (string)",
      required: true,
    },
    { name: "enabled", type: "boolean", description: "true=visible, false=hidden", required: true },
  ],
  toJsx(args) {
    return `
            var _comps = AE.findComps(${jsxVal(args.comp)});
            var _updated = 0;
            for (var ci = 0; ci < _comps.length; ci++) {
                var _layer = AE.findLayerInComp(_comps[ci], ${jsxVal(args.layer)});
                if (_layer) { _layer.enabled = ${jsxVal(!!args.enabled)}; _updated++; }
            }
            return { ok: true, updated: _updated };
        `;
  },
});

registerOp({
  name: "layer.set_guide",
  category: "layer",
  description: "Set guideLayer on/off for a layer. Can target all comps matching a pattern.",
  params: [
    {
      name: "comp",
      type: "any",
      description: "Comp name/id, or '*' for all comps, or 'review_id_*' for pattern match",
      required: true,
    },
    {
      name: "layer",
      type: "any",
      description: "Layer index (number) or name (string)",
      required: true,
    },
    {
      name: "guide",
      type: "boolean",
      description: "true=guide layer, false=normal",
      required: true,
    },
  ],
  toJsx(args) {
    return `
            var _comps = AE.findComps(${jsxVal(args.comp)});
            var _updated = 0;
            for (var ci = 0; ci < _comps.length; ci++) {
                var _layer = AE.findLayerInComp(_comps[ci], ${jsxVal(args.layer)});
                if (_layer) { _layer.guideLayer = ${jsxVal(!!args.guide)}; _updated++; }
            }
            return { ok: true, updated: _updated };
        `;
  },
});

registerOp({
  name: "layer.set_props",
  category: "layer",
  description:
    "Set basic layer properties. layer can be index, name, 'selected', or 'all'. Enum-valued attributes accept string names: quality (best|draft|wireframe), samplingQuality (bilinear|bicubic), frameBlendingType (off|frameMix|pixelMotion), autoOrient (off|alongPath|cameraOrPointOfInterest|charactersTowardCamera), blendingMode, lightType (spot|parallel|point|ambient|environment).",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "layer",
      type: "any",
      description: "Layer index, name, 'selected', or 'all'",
      required: true,
    },
    {
      name: "props",
      type: "object",
      description:
        "Object with keys to set, e.g. { name: 'foo', enabled: false, label: 5, threeDLayer: true }. lightSource takes a layer index/name/{id} or { item } (see light.set_source).",
      required: true,
    },
  ],
  toJsx(args) {
    const props = (args.props ?? {}) as Record<string, unknown>;
    const lines: string[] = [];
    for (const [k, v] of Object.entries(props)) {
      // LightLayer.lightSource takes a Layer object, which JSON cannot carry:
      // resolve it through the same path as light.set_source.
      if (k === "lightSource") {
        lines.push(
          `try { var _ls = AE.setLightSource(_l, ${jsxVal(v)}, { hide: true, makeEnvironment: true }); if (!_ls.ok) _w.push("lightSource: " + _ls.error); } catch (e) { _w.push("lightSource: " + AE.errText(e)); }`,
        );
        continue;
      }
      lines.push(
        `try { _l[${jsxVal(k)}] = AE.coerceLayerPropValue(${jsxVal(k)}, ${jsxVal(v)}); } catch (e) { _w.push(${jsxVal(k)} + ": " + AE.errText(e)); }`,
      );
    }
    return `
            ${jsxCompPreamble(args)}
            var _layers = AE.resolveLayers(_comp, ${jsxVal(args.layer)});
            if (_layers.length === 0) return { ok: false, error: "no layers matched" };
            var _results = [];
            for (var _li = 0; _li < _layers.length; _li++) {
                var _l = _layers[_li];
                var _w = [];
                ${lines.join("\n")}
                _results.push({ name: _l.name, warnings: _w });
            }
            return { ok: true, count: _results.length, layers: _results };
        `;
  },
});

registerOp({
  name: "layer.add_guide",
  category: "layer",
  description:
    "Add a ruler guide to a layer's Layer panel view (Layer.addGuide, AE 16.1+). Comp-panel guides live under comp.add_guide.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "layer",
      type: "any",
      description: "1-based layer index, or the layer name",
      required: true,
    },
    {
      name: "orientation",
      type: "string",
      description: "horizontal|vertical",
      required: true,
    },
    {
      name: "position",
      type: "number",
      description: "Position in px (y for horizontal, x for vertical)",
      required: true,
    },
  ],
  toJsx(args) {
    return `
            ${jsxCompLayerPreamble(args)}
            if (typeof _layer.addGuide !== "function") return { ok: false, error: "layer guides need AE 16.1+" };
            var _orient = ${jsxVal(args.orientation)} === "vertical" ? 1 : 0;
            var _idx = _layer.addGuide(_orient, ${jsxVal(args.position)});
            return { ok: true, guideIndex: _idx, numGuides: _layer.guides.length };
        `;
  },
});

registerOp({
  name: "layer.remove_guide",
  category: "layer",
  description: "Remove a Layer-panel ruler guide by its 0-based index (see layer.list_guides).",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "layer",
      type: "any",
      description: "1-based layer index, or the layer name",
      required: true,
    },
    { name: "guideIndex", type: "number", description: "0-based guide index", required: true },
  ],
  toJsx(args) {
    return `
            ${jsxCompLayerPreamble(args)}
            if (typeof _layer.removeGuide !== "function") return { ok: false, error: "layer guides need AE 16.1+" };
            var _guides = _layer.guides;
            if (${jsxVal(args.guideIndex)} < 0 || ${jsxVal(args.guideIndex)} >= _guides.length) {
                return { ok: false, error: "guide index out of range (0-" + (_guides.length - 1) + ")" };
            }
            _layer.removeGuide(${jsxVal(args.guideIndex)});
            return { ok: true, numGuides: _layer.guides.length };
        `;
  },
});

registerOp({
  name: "layer.move_guide",
  category: "layer",
  description:
    "Move an existing Layer-panel ruler guide to a new position (Layer.setGuide). Named move_guide because layer.set_guide already means the guide-LAYER flag.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "layer",
      type: "any",
      description: "1-based layer index, or the layer name",
      required: true,
    },
    { name: "guideIndex", type: "number", description: "0-based guide index", required: true },
    { name: "position", type: "number", description: "New position in px", required: true },
  ],
  toJsx(args) {
    return `
            ${jsxCompLayerPreamble(args)}
            if (typeof _layer.setGuide !== "function") return { ok: false, error: "layer guides need AE 16.1+" };
            var _guides = _layer.guides;
            if (${jsxVal(args.guideIndex)} < 0 || ${jsxVal(args.guideIndex)} >= _guides.length) {
                return { ok: false, error: "guide index out of range (0-" + (_guides.length - 1) + ")" };
            }
            _layer.setGuide(${jsxVal(args.position)}, ${jsxVal(args.guideIndex)});
            return { ok: true, guideIndex: ${jsxVal(args.guideIndex)}, position: ${jsxVal(args.position)} };
        `;
  },
});

registerOp({
  name: "layer.list_guides",
  category: "layer",
  readOnly: true,
  description: "List a layer's Layer-panel ruler guides with orientation and position (AE 16.1+).",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "layer",
      type: "any",
      description: "1-based layer index, or the layer name",
      required: true,
    },
  ],
  toJsx(args) {
    return `
            ${jsxCompLayerPreamble(args)}
            var _guides = null;
            try { _guides = _layer.guides; } catch (eG) {}
            if (!_guides) return { ok: false, error: "layer guides need AE 16.1+" };
            var _out = [];
            for (var _i = 0; _i < _guides.length; _i++) {
                _out.push({ index: _i, orientation: _guides[_i].orientationType === 1 ? "vertical" : "horizontal", position: _guides[_i].position });
            }
            return { ok: true, count: _out.length, guides: _out };
        `;
  },
});
