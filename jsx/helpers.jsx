// mcp-aftereffects shared JSX helpers - included by dispatcher.jsx so every tool call
// has these in scope. Keep this file ES3-compatible: var only, no arrow
// functions, no Array.prototype.map/filter, no template strings.

var AE = AE || {};

// ---------- Talking about exceptions ----------

/**
 * Render a caught exception as text. Use this instead of `"failed: " + e`,
 * always - the concatenation is not the harmless shorthand it looks like.
 * ExtendScript cannot coerce an Error to a primitive, so `+ e` throws on its
 * own ("Object of type Error found where a Number, Array, or Property is
 * needed") from inside the handler that was supposed to report the original
 * failure: the real error is swallowed and a bogus one takes its place. In a
 * generated operation that turns a recoverable warning into a failed call; in
 * the dispatcher it used to escape as far as AE's modal error dialog.
 *
 * dispatcher.jsx carries its own copy of this so it can still report failures
 * when an #include has not taken. Keep the two in step.
 */
AE.errText = function (e) {
    try {
        if (e === null || e === undefined) return "unknown error";
        if (typeof e === "string") return e;
        var msg = (e.message === undefined || e.message === null) ? "" : String(e.message);
        if (msg.length === 0) msg = "error";
        if (e.line !== undefined && e.line !== null) msg += " (line " + String(e.line) + ")";
        return msg;
    } catch (eFmt) {
        return "unformattable error";
    }
};

// ---------- Project item lookup ----------

AE.findItemById = function (id) {
    var proj = app.project;
    for (var i = 1; i <= proj.numItems; i++) {
        if (proj.item(i).id === id) return proj.item(i);
    }
    return null;
};

// Find any project item by numeric id or exact name (first match wins).
AE.findItem = function (idOrName) {
    if (typeof idOrName === "number") return AE.findItemById(idOrName);
    var proj = app.project;
    var name = String(idOrName);
    for (var i = 1; i <= proj.numItems; i++) {
        if (proj.item(i).name === name) return proj.item(i);
    }
    return null;
};

// Find a FolderItem by id or name. null/undefined resolves to the root folder.
AE.findFolder = function (idOrName) {
    if (idOrName === null || idOrName === undefined) return app.project.rootFolder;
    var it = AE.findItem(idOrName);
    return (it && it instanceof FolderItem) ? it : null;
};

AE.findCompByNameOrId = function (nameOrId) {
    var proj = app.project;
    if (typeof nameOrId === "number") {
        var byId = AE.findItemById(nameOrId);
        if (byId && byId instanceof CompItem) return byId;
        // fall through: treat number as 1-based index
        if (nameOrId >= 1 && nameOrId <= proj.numItems && proj.item(nameOrId) instanceof CompItem) {
            return proj.item(nameOrId);
        }
        return null;
    }
    for (var i = 1; i <= proj.numItems; i++) {
        var it = proj.item(i);
        if (it instanceof CompItem && it.name === nameOrId) return it;
    }
    return null;
};

// ---------- Comp/Layer pattern matching ----------

// Find comps by name, id, or glob pattern ('*' = all, 'review_id_*' = prefix
// match). An ARRAY of those resolves each entry and unions the results (in
// entry order, duplicates dropped) - every op that takes a comp pattern
// therefore also takes a list.
AE.findComps = function (nameOrIdOrPattern) {
    var proj = app.project;
    if (nameOrIdOrPattern instanceof Array) {
        var union = [];
        var seenIds = {};
        for (var ai = 0; ai < nameOrIdOrPattern.length; ai++) {
            var part = AE.findComps(nameOrIdOrPattern[ai]);
            for (var pi = 0; pi < part.length; pi++) {
                var key = "k" + part[pi].id;
                if (seenIds.hasOwnProperty(key)) continue;
                seenIds[key] = true;
                union.push(part[pi]);
            }
        }
        return union;
    }
    if (typeof nameOrIdOrPattern === "number") {
        var c = AE.findItemById(nameOrIdOrPattern);
        return (c && c instanceof CompItem) ? [c] : [];
    }
    var pat = String(nameOrIdOrPattern);
    var results = [];
    var isGlob = pat.indexOf("*") !== -1;
    for (var i = 1; i <= proj.numItems; i++) {
        var item = proj.item(i);
        if (!(item instanceof CompItem)) continue;
        if (isGlob) {
            // Simple glob: 'abc*' = startsWith, '*abc' = endsWith, '*' = all
            if (pat === "*") { results.push(item); continue; }
            var parts = pat.split("*");
            var match = true;
            var pos = 0;
            for (var p = 0; p < parts.length; p++) {
                if (parts[p].length === 0) continue;
                if (p === parts.length - 1) {
                    // Pattern does not end with '*': the final segment must
                    // end exactly at the end of the name.
                    var tailStart = item.name.length - parts[p].length;
                    if (tailStart < pos || item.name.substring(tailStart) !== parts[p]) { match = false; }
                    break;
                }
                var idx = item.name.indexOf(parts[p], pos);
                if (idx === -1) { match = false; break; }
                if (p === 0 && idx !== 0) { match = false; break; }
                pos = idx + parts[p].length;
            }
            if (match) results.push(item);
        } else {
            if (item.name === pat) results.push(item);
        }
    }
    return results;
};

// Find a layer by stable id (Layer.id, AE 22.0+). Uses app.project.layerByID
// (a Project method, not CompItem) when available, checking the hit belongs to
// this comp; falls back to a scan so pre-22 hosts degrade gracefully.
AE.findLayerById = function (comp, id) {
    try {
        if (typeof app.project.layerByID === "function") {
            var byId = app.project.layerByID(id);
            if (byId) {
                return (byId.containingComp && byId.containingComp.id === comp.id) ? byId : null;
            }
        }
    } catch (eById) { /* fall through to scan */ }
    for (var i = 1; i <= comp.numLayers; i++) {
        try { if (comp.layer(i).id === id) return comp.layer(i); } catch (eScan) {}
    }
    return null;
};

// Find a layer in a comp by index (number), name (string), or { id: n }
// (stable Layer.id reference that survives reordering and renaming).
AE.findLayerInComp = function (comp, indexOrName) {
    if (indexOrName !== null && typeof indexOrName === "object" && typeof indexOrName.id === "number") {
        return AE.findLayerById(comp, indexOrName.id);
    }
    if (typeof indexOrName === "number") {
        if (indexOrName >= 1 && indexOrName <= comp.numLayers) return comp.layer(indexOrName);
        return null;
    }
    var name = String(indexOrName);
    for (var i = 1; i <= comp.numLayers; i++) {
        if (comp.layer(i).name === name) return comp.layer(i);
    }
    return null;
};

// Resolve layer target: number=index, "selected"=selected layers array, string=name match,
// { id: n }=stable Layer.id, or an ARRAY of those (union in entry order,
// duplicates dropped). Always returns an array of layers.
AE.resolveLayers = function (comp, target) {
    if (target instanceof Array) {
        var union = [];
        var seenIdx = {};
        for (var ai = 0; ai < target.length; ai++) {
            var part = AE.resolveLayers(comp, target[ai]);
            for (var pi = 0; pi < part.length; pi++) {
                var key = "k" + part[pi].index;
                if (seenIdx.hasOwnProperty(key)) continue;
                seenIdx[key] = true;
                union.push(part[pi]);
            }
        }
        return union;
    }
    if (target !== null && typeof target === "object" && typeof target.id === "number") {
        var byId = AE.findLayerById(comp, target.id);
        return byId ? [byId] : [];
    }
    if (typeof target === "number") {
        if (target >= 1 && target <= comp.numLayers) return [comp.layer(target)];
        return [];
    }
    var s = String(target);
    if (s === "selected") {
        var sel = [];
        for (var i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i).selected) sel.push(comp.layer(i));
        }
        return sel;
    }
    if (s === "all") {
        var all = [];
        for (var i2 = 1; i2 <= comp.numLayers; i2++) all.push(comp.layer(i2));
        return all;
    }
    // By name
    for (var i3 = 1; i3 <= comp.numLayers; i3++) {
        if (comp.layer(i3).name === s) return [comp.layer(i3)];
    }
    return [];
};

// ---------- Enum-valued layer attributes ----------
// JSON can't carry ExtendScript enum objects, so layer.set_props accepts
// well-known string names and translates them here. A value that is not a
// string, or a key/name this table doesn't know, passes through untouched -
// the plain assignment then succeeds on its own or reports its own error.
// Built lazily; each enum family guarded so one missing global (old AE)
// doesn't take the whole table down. Entries whose enum member resolved to
// undefined are dropped - assigning undefined would throw a misleading error.
AE._layerEnumMaps = null;
AE.coerceLayerPropValue = function (key, val) {
    if (typeof val !== "string") return val;
    if (AE._layerEnumMaps === null) {
        var maps = {};
        try {
            maps.autoOrient = {
                off: AutoOrientType.NO_AUTO_ORIENT,
                alongPath: AutoOrientType.ALONG_PATH,
                cameraOrPointOfInterest: AutoOrientType.CAMERA_OR_POINT_OF_INTEREST,
                charactersTowardCamera: AutoOrientType.CHARACTERS_TOWARD_CAMERA
            };
        } catch (eAo) {}
        try {
            maps.quality = {
                best: LayerQuality.BEST,
                draft: LayerQuality.DRAFT,
                wireframe: LayerQuality.WIREFRAME
            };
        } catch (eQ) {}
        try {
            maps.samplingQuality = {
                bilinear: LayerSamplingQuality.BILINEAR,
                bicubic: LayerSamplingQuality.BICUBIC
            };
        } catch (eSq) {}
        try {
            maps.frameBlendingType = {
                off: FrameBlendingType.NO_FRAME_BLEND,
                frameMix: FrameBlendingType.FRAME_MIX,
                pixelMotion: FrameBlendingType.PIXEL_MOTION
            };
        } catch (eFb) {}
        try {
            maps.blendingMode = {
                normal: BlendingMode.NORMAL, dissolve: BlendingMode.DISSOLVE,
                dancingDissolve: BlendingMode.DANCING_DISSOLVE,
                darken: BlendingMode.DARKEN, multiply: BlendingMode.MULTIPLY,
                colorBurn: BlendingMode.COLOR_BURN, classicColorBurn: BlendingMode.CLASSIC_COLOR_BURN,
                linearBurn: BlendingMode.LINEAR_BURN, darkerColor: BlendingMode.DARKER_COLOR,
                add: BlendingMode.ADD, lighten: BlendingMode.LIGHTEN,
                screen: BlendingMode.SCREEN, colorDodge: BlendingMode.COLOR_DODGE,
                classicColorDodge: BlendingMode.CLASSIC_COLOR_DODGE,
                linearDodge: BlendingMode.LINEAR_DODGE, lighterColor: BlendingMode.LIGHTER_COLOR,
                overlay: BlendingMode.OVERLAY, softLight: BlendingMode.SOFT_LIGHT,
                hardLight: BlendingMode.HARD_LIGHT, linearLight: BlendingMode.LINEAR_LIGHT,
                vividLight: BlendingMode.VIVID_LIGHT, pinLight: BlendingMode.PIN_LIGHT,
                hardMix: BlendingMode.HARD_MIX, difference: BlendingMode.DIFFERENCE,
                classicDifference: BlendingMode.CLASSIC_DIFFERENCE, exclusion: BlendingMode.EXCLUSION,
                subtract: BlendingMode.SUBTRACT, divide: BlendingMode.DIVIDE,
                hue: BlendingMode.HUE, saturation: BlendingMode.SATURATION,
                color: BlendingMode.COLOR, luminosity: BlendingMode.LUMINOSITY,
                stencilAlpha: BlendingMode.STENCIL_ALPHA, stencilLuma: BlendingMode.STENCIL_LUMA,
                alphaAdd: BlendingMode.ALPHA_ADD, luminescentPremul: BlendingMode.LUMINESCENT_PREMUL
            };
            // The API spells it SILHOUETE_* (one T) - an Adobe typo old enough
            // to be contractual. Probe both spellings, keep whichever exists.
            var silA = BlendingMode.SILHOUETE_ALPHA;
            if (silA === undefined) silA = BlendingMode.SILHOUETTE_ALPHA;
            var silL = BlendingMode.SILHOUETE_LUMA;
            if (silL === undefined) silL = BlendingMode.SILHOUETTE_LUMA;
            maps.blendingMode.silhouetteAlpha = silA;
            maps.blendingMode.silhouetteLuma = silL;
        } catch (eBm) {}
        try {
            maps.lightType = {
                spot: LightType.SPOT,
                parallel: LightType.PARALLEL,
                point: LightType.POINT,
                ambient: LightType.AMBIENT
            };
        } catch (eLt) {}
        // ENVIRONMENT is 24.3+ - probed separately so a build without it keeps
        // the four classic light types even if the member access throws.
        try {
            if (maps.lightType && LightType.ENVIRONMENT !== undefined) {
                maps.lightType.environment = LightType.ENVIRONMENT;
            }
        } catch (eEnv) {}
        // Drop entries whose enum member is missing on this AE build.
        for (var mk in maps) {
            if (!maps.hasOwnProperty(mk)) continue;
            for (var vk in maps[mk]) {
                if (maps[mk].hasOwnProperty(vk) && maps[mk][vk] === undefined) delete maps[mk][vk];
            }
        }
        AE._layerEnumMaps = maps;
    }
    var map = AE._layerEnumMaps.hasOwnProperty(key) ? AE._layerEnumMaps[key] : null;
    if (map !== null && map.hasOwnProperty(val)) return map[val];
    return val;
};

// ---------- Layer classes ----------
// The docs list TextLayer, ShapeLayer, ThreeDModelLayer and ParametricMeshLayer
// as AVLayer subclasses, but `layer instanceof AVLayer` is FALSE for all four
// on AE 26.5 (verified 2026-10-10: exports of text, shape, GLB and mesh layers
// carried no threeDLayer, sourceId or AV switches). Every "is this an AV
// layer" test goes through here.
AE.isAVLayer = function (layer) {
    if (!layer) return false;
    try { if (layer instanceof AVLayer || layer instanceof TextLayer || layer instanceof ShapeLayer) return true; } catch (eAv) {}
    return AE.isModelLayer(layer) || AE.isMeshLayer(layer);
};

/** A 3D model (GLB/glTF/OBJ) layer, AE 24.4+. */
AE.isModelLayer = function (layer) {
    try { return typeof ThreeDModelLayer !== "undefined" && layer instanceof ThreeDModelLayer; } catch (e) { return false; }
};

/** A parametric mesh layer, AE 26.3+. */
AE.isMeshLayer = function (layer) {
    try { return typeof ParametricMeshLayer !== "undefined" && layer instanceof ParametricMeshLayer; } catch (e) { return false; }
};

// ---------- Advanced 3D: parametric meshes ----------
// Every mesh layer carries the option groups of ALL six mesh types; only the
// current type's groups are live (the others throw "hidden" on setValue), and
// they share the display names "Mesh Options" / "Bevel Options". Group
// matchNames verified on AE 26.5.
AE.MESH_TYPE_NAMES = ["cube", "sphere", "plane", "cylinder", "cone", "torus"];
AE.MESH_GROUPS = {
    cube: ["ADBE CubeMeshOptionsSGrp", "ADBE CubeBevelOptionsSGrp"],
    sphere: ["ADBE SphereMeshOptionsSGrp"],
    plane: ["ADBE PlaneMeshOptionsSGrp"],
    cylinder: ["ADBE CylinderMeshOptionsSGrp", "ADBE CylinderBevelOptionsSGrp"],
    cone: ["ADBE ConeMeshOptionsSGrp", "ADBE ConeBevelBevelSGrp"],
    torus: ["ADBE TorusMeshOptionsSGrp"]
};

/** ParametricMeshType value for a name (cube|sphere|plane|cylinder|cone|torus), or undefined. */
AE.meshTypeEnum = function (name) {
    try { return ParametricMeshType[String(name).toUpperCase()]; } catch (e) { return undefined; }
};

/** The mesh type of a parametric mesh layer as a name, or null. */
AE.meshTypeName = function (layer) {
    var t;
    try { t = layer.parametricMeshType; } catch (e) { return null; }
    for (var i = 0; i < AE.MESH_TYPE_NAMES.length; i++) {
        if (AE.meshTypeEnum(AE.MESH_TYPE_NAMES[i]) === t) return AE.MESH_TYPE_NAMES[i];
    }
    return null;
};

/** True when matchName is a mesh/bevel option group of any mesh type. */
AE.isMeshOptionGroup = function (matchName) {
    for (var k in AE.MESH_GROUPS) {
        if (!AE.MESH_GROUPS.hasOwnProperty(k)) continue;
        for (var i = 0; i < AE.MESH_GROUPS[k].length; i++) if (AE.MESH_GROUPS[k][i] === matchName) return true;
    }
    return false;
};

/** For a mesh option group on `layer`: true when it belongs to the current mesh type. null for other groups. */
AE.meshGroupActive = function (layer, matchName) {
    if (!AE.isMeshOptionGroup(matchName)) return null;
    var cur = AE.meshTypeName(layer);
    var live = cur ? AE.MESH_GROUPS[cur] : [];
    for (var i = 0; i < live.length; i++) if (live[i] === matchName) return true;
    return false;
};

// Child of a property group by matchName or display name. Display names are
// ambiguous on mesh layers (six "Mesh Options" groups); there the group of the
// current mesh type wins, so ["Mesh Options","Radius"] reaches the live one.
AE.childProperty = function (node, seg) {
    if (typeof seg === "number") return node.property(seg);
    var first = null;
    try { first = node.property(seg); } catch (eP) {}
    if (!first || first.matchName === seg) return first;
    // Display-name hit: on a mesh layer, prefer an active mesh group.
    var layer = null;
    try { layer = (node.containingComp ? node : AE.ownerLayer(node)); } catch (eL) {}
    if (!layer || !AE.isMeshLayer(layer) || AE.meshGroupActive(layer, first.matchName) !== false) return first;
    for (var i = 1; i <= node.numProperties; i++) {
        var c = node.property(i);
        if (c.name === seg && AE.meshGroupActive(layer, c.matchName) === true) return c;
    }
    return first;
};

// ---------- Settable / hidden properties ----------
// AE exposes no attribute for "hidden in the UI": hidden properties report the
// same canVaryOverTime/canSetExpression/active/enabled as live ones and only
// fail on write ("Can not 'set value' with this property, because the
// property or a parent property is hidden"). Which ones are hidden depends on
// layer class, renderer and other values (falloff type, light source, mesh
// type), so the only reliable test is writing the current value back.

AE.isHiddenError = function (e) {
    return /hidden/i.test(AE.errText(e));
};

// Value types where writing the read value back is an exact no-op.
AE._probeableType = function (prop) {
    var t = prop.propertyValueType;
    return t === PropertyValueType.OneD || t === PropertyValueType.TwoD || t === PropertyValueType.ThreeD ||
        t === PropertyValueType.TwoD_SPATIAL || t === PropertyValueType.ThreeD_SPATIAL || t === PropertyValueType.COLOR;
};

/**
 * { settable: true|false|null, hidden: bool, reason } for a leaf property.
 * null = not decidable without a real edit (keyed, separated, custom data).
 * Writes prop.value back onto an un-keyed property: no change to the project.
 */
// Never probed: writing Time Remap can switch it on, and a value written
// into a Layer Styles / text-animator placeholder can ADD that style or
// property (those groups list every possible member).
AE.PROBE_SKIP = { "ADBE Time Remapping": true, "ADBE Layer Styles": true, "ADBE Text Animator Properties": true };

AE._underProbeSkip = function (prop) {
    var p = prop;
    for (var d = 0; d < 12 && p; d++) {
        try { if (AE.PROBE_SKIP[p.matchName] === true) return true; } catch (e) { return true; }
        try { p = p.parentProperty; } catch (e2) { p = null; }
    }
    return false;
};

AE.probeSettable = function (prop) {
    try {
        if (prop.propertyType !== PropertyType.PROPERTY) return { settable: null, hidden: false };
        if (AE._underProbeSkip(prop)) return { settable: null, hidden: false };
        if (prop.propertyValueType === PropertyValueType.NO_VALUE) return { settable: false, hidden: false, reason: "holds no value" };
        if (prop.propertyValueType === PropertyValueType.CUSTOM_VALUE) return { settable: false, hidden: false, reason: "custom data scripting cannot read or set" };
        if (!AE._probeableType(prop)) return { settable: null, hidden: false };
        if (prop.numKeys > 0) return { settable: true, hidden: false, reason: "keyframed: set values with keyframe ops" };
        if (prop.isSeparationLeader && prop.dimensionsSeparated) return { settable: true, hidden: false, reason: "dimensions separated: set the X/Y/Z followers" };
    } catch (eT) { return { settable: null, hidden: false }; }
    try {
        prop.setValue(prop.value);
        return { settable: true, hidden: false };
    } catch (e) {
        if (AE.isHiddenError(e)) return { settable: false, hidden: true, reason: "hidden for this layer type, renderer or current settings" };
        return { settable: false, hidden: false, reason: AE.errText(e) };
    }
};

/**
 * Whether a whole group is hidden: true when every probe-able leaf under it
 * (depth-first, up to `budget` leaves) refuses writes as hidden, false as soon
 * as one accepts, null when nothing in it can be probed. A single leaf is not
 * enough: Material Assignment on a mesh hides Projection Mode but not Base
 * Color.
 */
AE.groupHidden = function (group, budget) {
    budget = budget || { n: 24 };
    try { if (AE.PROBE_SKIP[group.matchName] === true) return null; } catch (eS) { return null; }
    var sawHidden = false;
    for (var i = 1; i <= group.numProperties && budget.n > 0; i++) {
        var c;
        try { c = group.property(i); } catch (e) { continue; }
        if (!c) continue;
        if (c.propertyType === PropertyType.PROPERTY) {
            var probeable = false;
            try { probeable = AE._probeableType(c) && !(c.numKeys > 0); } catch (eP) {}
            if (!probeable) continue;
            budget.n--;
            var r = AE.probeSettable(c);
            if (r.settable === true) return false;
            if (r.hidden) sawHidden = true;
        } else {
            var sub = AE.groupHidden(c, budget);
            if (sub === false) return false;
            if (sub === true) sawHidden = true;
        }
    }
    return sawHidden ? true : null;
};

/** Valid range of a numeric property as { min, max } (either may be absent), or null. */
AE.propertyRange = function (prop) {
    var r = {}, any = false;
    try { if (prop.hasMin) { r.min = prop.minValue; any = true; } } catch (e1) {}
    try { if (prop.hasMax) { r.max = prop.maxValue; any = true; } } catch (e2) {}
    return any ? r : null;
};

/**
 * Full, actionable text for a failed write: AE's message untruncated, plus
 * what the property accepts (range, units, keyed/expression state) and why a
 * hidden property refuses. Used by property.set, effect.set_property and
 * keyframe writers.
 */
AE.describeSetError = function (prop, e, value) {
    var msg = AE.errText(e);
    var parts = [];
    try {
        if (prop.propertyType !== PropertyType.PROPERTY) {
            var note = "'" + prop.name + "' (" + prop.matchName + ") is a property group, not a value; list its members with property.list";
            if (prop.matchName === "ADBE Light Env Atom") note += ". An environment light's source is a layer: use light.set_source";
            return note;
        }
    } catch (eG) {}
    try { parts.push("property '" + prop.name + "' (" + prop.matchName + ")"); } catch (eN) {}
    var rng = AE.propertyRange(prop);
    if (rng) {
        var units = AE.safeGet(function () { return prop.unitsText; }, "");
        parts.push("valid range " + (rng.min !== undefined ? rng.min : "-inf") + " to " + (rng.max !== undefined ? rng.max : "inf") + (units ? " " + units : ""));
    }
    if (AE.isHiddenError(e)) parts.push("it is hidden for this layer type, renderer or current settings (property.list marks these hidden:true)");
    try { if (prop.numKeys > 0) parts.push("it has " + prop.numKeys + " keyframes: set values with keyframe ops or pass a time"); } catch (eK) {}
    try {
        // if/else, not a ternary chain: ExtendScript parses those left-associatively.
        var t = prop.propertyValueType;
        var dims = 0;
        if (t === PropertyValueType.ThreeD || t === PropertyValueType.ThreeD_SPATIAL) dims = 3;
        else if (t === PropertyValueType.TwoD || t === PropertyValueType.TwoD_SPATIAL) dims = 2;
        else if (t === PropertyValueType.COLOR) dims = 4;
        else if (t === PropertyValueType.OneD) dims = 1;
        if (dims > 1 && !(value instanceof Array)) parts.push("expects an array of " + dims + " numbers");
        if (dims === 1 && value instanceof Array) parts.push("expects a single number");
    } catch (eD) {}
    if (value !== undefined) parts.push("got " + AE._jsonText(value));
    return msg + (parts.length ? " [" + parts.join("; ") + "]" : "");
};

// ---------- Environment light source ----------
// LightLayer.lightSource (24.3; any 2D layer since 25.2) takes a Layer OBJECT
// of the same comp. Strings and indexes are refused ("... is not of the
// correct type"), and a 3D layer is refused ("Invalid light source
// specified"). "Light Options > Source" (ADBE Light Env Atom) is an empty
// group, so property.set cannot reach it either.

/**
 * Resolve `spec` to a layer of `comp` to light with. Accepted forms:
 *   number / { id }       a layer of the comp (index / stable id)
 *   string                a layer name; if no layer has it, a project item name
 *   { item: id|name }     a footage or comp item, added to the comp as a layer
 * Returns { layer, added } or { error }.
 */
AE.resolveLightSourceLayer = function (comp, spec) {
    var isItemRef = spec !== null && typeof spec === "object" && !(spec instanceof Array) && spec.item !== undefined;
    if (!isItemRef) {
        var l = AE.findLayerInComp(comp, spec);
        if (l) return { layer: l, added: false };
        if (typeof spec !== "string") return { error: "no layer matching " + AE._jsonText(spec) + " in comp '" + comp.name + "'" };
    }
    var item = AE.findItem(isItemRef ? spec.item : spec);
    if (!item) return { error: "no layer or project item matching " + AE._jsonText(isItemRef ? spec.item : spec) };
    if (!(item instanceof FootageItem) && !(item instanceof CompItem)) return { error: "'" + item.name + "' is a " + AE.itemTypeName(item) + "; a light source must be footage (HDR/EXR/image/video) or a comp" };
    if (item === comp) return { error: "a comp cannot light itself" };
    var added = comp.layers.add(item);
    try { added.moveToEnd(); } catch (eMv) {}
    return { layer: added, added: true };
};

/**
 * Point an environment light at a source. opts.hide (default true) switches a
 * layer this call ADDED to video-off so it only lights (and reflects), never
 * draws. opts.makeEnvironment (default true) switches the light type first.
 */
AE.setLightSource = function (light, spec, opts) {
    opts = opts || {};
    if (!(light instanceof LightLayer)) return { ok: false, error: "'" + light.name + "' is not a light layer" };
    var comp = light.containingComp;
    var env;
    try { env = LightType.ENVIRONMENT; } catch (eEnv) {}
    if (env === undefined) return { ok: false, error: "environment lights need AE 24.3+" };
    if (light.lightType !== env) {
        if (opts.makeEnvironment === false) return { ok: false, error: "'" + light.name + "' is not an environment light (pass makeEnvironment: true to switch it)" };
        light.lightType = env;
    }
    if (spec === null) {
        try { light.lightSource = null; } catch (eClr) { return { ok: false, error: "could not clear the light source: " + AE.errText(eClr) }; }
        return { ok: true, light: light.name, source: null };
    }
    var r = AE.resolveLightSourceLayer(comp, spec);
    if (r.error) return { ok: false, error: r.error };
    var src = r.layer;
    if (src === light) return { ok: false, error: "a light cannot be its own source" };
    var was3d = false;
    try { was3d = src.threeDLayer === true; } catch (e3) {}
    if (was3d) {
        if (!r.added) return { ok: false, error: "source layer '" + src.name + "' is 3D; environment light sources must be 2D layers (switch its 3D off, or pass { item } to add the footage as a new 2D layer)" };
        src.threeDLayer = false;
    }
    try {
        light.lightSource = src;
    } catch (eSet) {
        if (r.added) { try { src.remove(); } catch (eRm) {} }
        return { ok: false, error: "lightSource refused '" + src.name + "': " + AE.errText(eSet) };
    }
    if (r.added && opts.hide !== false) { try { src.enabled = false; } catch (eHide) {} }
    var out = {
        ok: true,
        light: light.name,
        source: { name: src.name, index: src.index, id: AE.safeGet(function () { return src.id; }, null), enabled: src.enabled },
        added: r.added
    };
    var rd = AE.safeGet(function () { return comp.renderer; }, null);
    if (rd !== "ADBE Calder") out.warning = "comp '" + comp.name + "' uses renderer " + rd + "; environment lights render only with Advanced 3D (comp.set_renderer advanced3d)";
    return out;
};

/** The light-source layer of a light, or null (also null when unset or unsupported). */
AE.lightSourceLayer = function (light) {
    try { var s = light.lightSource; return (s && s.index) ? s : null; } catch (e) { return null; }
};

// ---------- Basic serialization ----------

// Canonical item type label. An if/else chain, NOT a chained ternary:
// ExtendScript parses `a ? b : c ? d : e` LEFT-associatively - as
// `(a ? b : c) ? d : e` - so a ternary chain here would label every
// item with the last branch. (Verified on AE 26.3 / ExtendScript 4.5.6.)
AE.itemTypeName = function (item) {
    if (item instanceof CompItem) return "CompItem";
    if (item instanceof FolderItem) return "FolderItem";
    if (item instanceof FootageItem) return "FootageItem";
    return "UnknownItem";
};

AE.serializeItemSummary = function (item) {
    var type = AE.itemTypeName(item);
    var out = {
        id: item.id,
        name: item.name,
        type: type,
        parentFolderId: item.parentFolder ? item.parentFolder.id : null,
        parentFolderName: item.parentFolder ? item.parentFolder.name : null,
        label: item.label,
        comment: item.comment
    };
    if (item instanceof CompItem) {
        out.width = item.width;
        out.height = item.height;
        out.frameRate = item.frameRate;
        out.duration = item.duration;
        out.layerCount = item.numLayers;
        out.bgColor = [item.bgColor[0], item.bgColor[1], item.bgColor[2]];
    }
    if (item instanceof FootageItem) {
        out.width = item.width;
        out.height = item.height;
        out.duration = item.duration;
        var src = item.mainSource;
        if (src instanceof SolidSource) {
            out.sourceKind = "solid";
            out.color = [src.color[0], src.color[1], src.color[2]];
        } else if (src instanceof FileSource) {
            out.sourceKind = "file";
            out.file = src.file ? src.file.fsName.replace(/\\/g, "/") : null;
            out.missingFootagePath = (src.missingFootagePath && src.missingFootagePath.length > 0) ? src.missingFootagePath : null;
        } else if (src instanceof PlaceholderSource) {
            out.sourceKind = "placeholder";
        } else {
            out.sourceKind = "unknown";
        }
    }
    return out;
};

AE.serializeLayerSummary = function (layer) {
    var type = "Layer";
    if (layer instanceof AVLayer) type = "AVLayer";
    if (layer instanceof ShapeLayer) type = "ShapeLayer";
    if (layer instanceof TextLayer) type = "TextLayer";
    if (layer instanceof CameraLayer) type = "CameraLayer";
    if (layer instanceof LightLayer) type = "LightLayer";
    // AE 24.4+ / 26.3+ layer classes. ThreeDModelLayer subclasses AVLayer;
    // ParametricMeshLayer does NOT (verified on 26.3), so both need their own
    // probe-guarded checks rather than relying on the chain above.
    try { if (typeof ThreeDModelLayer !== "undefined" && layer instanceof ThreeDModelLayer) type = "ThreeDModelLayer"; } catch (e3d) {}
    try { if (typeof ParametricMeshLayer !== "undefined" && layer instanceof ParametricMeshLayer) type = "ParametricMeshLayer"; } catch (ePm) {}
    var out = {
        index: layer.index,
        // Stable layer id (AE 22.0+) - survives reordering/renaming. null on older hosts.
        id: AE.safeGet(function () { return layer.id; }, null),
        name: layer.name,
        type: type,
        enabled: layer.enabled,
        solo: layer.solo,
        shy: layer.shy,
        locked: layer.locked,
        inPoint: layer.inPoint,
        outPoint: layer.outPoint,
        startTime: layer.startTime,
        stretch: layer.stretch,
        parentIndex: layer.parent ? layer.parent.index : null,
        label: layer.label
    };
    if (AE.isAVLayer(layer)) {
        out.width = AE.safeGet(function () { return layer.width; }, null);
        out.height = AE.safeGet(function () { return layer.height; }, null);
        out.hasVideo = AE.safeGet(function () { return layer.hasVideo; }, null);
        out.hasAudio = AE.safeGet(function () { return layer.hasAudio; }, null);
        out.threeDLayer = AE.safeGet(function () { return layer.threeDLayer; }, null);
        // Text/shape/mesh layers have no source item; a 3D model's source is its GLB footage.
        var lsrc = AE.safeGet(function () { return layer.source; }, null);
        out.sourceId = (lsrc && lsrc.id) ? lsrc.id : null;
        out.sourceName = lsrc ? lsrc.name : null;
    }
    if (type === "ParametricMeshLayer") out.meshType = AE.meshTypeName(layer);
    if (layer instanceof TextLayer) {
        try {
            var doc = layer.property("Source Text").value;
            out.text = doc.text;
            out.fontSize = doc.fontSize;
            out.font = doc.font;
            out.fillColor = [doc.fillColor[0], doc.fillColor[1], doc.fillColor[2]];
        } catch (eT) {
            out.text = null;
        }
    }
    return out;
};

// ---------- Transform snapshot (values at time 0) ----------

AE.serializeTransform = function (layer) {
    var xf = layer.transform;
    function v(name) {
        try {
            var p = xf.property(name);
            if (!p) return null;
            var val = p.value;
            if (val && val.length !== undefined) {
                var arr = [];
                for (var i = 0; i < val.length; i++) arr.push(val[i]);
                return arr;
            }
            return val;
        } catch (e) { return null; }
    }
    return {
        anchorPoint: v("Anchor Point"),
        position: v("Position"),
        scale: v("Scale"),
        rotation: v("Rotation"),
        opacity: v("Opacity")
    };
};

// ---------- Property tree walker (for export) ----------
// Walks a PropertyGroup (or indexed group) and serializes every leaf Property
// with its current value and keyframes. Skips properties that can't be
// serialized (BridgeTalk, byte arrays, etc.) by falling back to null.

AE.PROPERTY_VALUE_TYPE_NAMES = {};
(function buildPvtNames() {
    try {
        AE.PROPERTY_VALUE_TYPE_NAMES[PropertyValueType.NO_VALUE] = "NO_VALUE";
        AE.PROPERTY_VALUE_TYPE_NAMES[PropertyValueType.ThreeD_SPATIAL] = "ThreeD_SPATIAL";
        AE.PROPERTY_VALUE_TYPE_NAMES[PropertyValueType.ThreeD] = "ThreeD";
        AE.PROPERTY_VALUE_TYPE_NAMES[PropertyValueType.TwoD_SPATIAL] = "TwoD_SPATIAL";
        AE.PROPERTY_VALUE_TYPE_NAMES[PropertyValueType.TwoD] = "TwoD";
        AE.PROPERTY_VALUE_TYPE_NAMES[PropertyValueType.OneD] = "OneD";
        AE.PROPERTY_VALUE_TYPE_NAMES[PropertyValueType.COLOR] = "COLOR";
        AE.PROPERTY_VALUE_TYPE_NAMES[PropertyValueType.CUSTOM_VALUE] = "CUSTOM_VALUE";
        AE.PROPERTY_VALUE_TYPE_NAMES[PropertyValueType.MARKER] = "MARKER";
        AE.PROPERTY_VALUE_TYPE_NAMES[PropertyValueType.LAYER_INDEX] = "LAYER_INDEX";
        AE.PROPERTY_VALUE_TYPE_NAMES[PropertyValueType.MASK_INDEX] = "MASK_INDEX";
        AE.PROPERTY_VALUE_TYPE_NAMES[PropertyValueType.SHAPE] = "SHAPE";
        AE.PROPERTY_VALUE_TYPE_NAMES[PropertyValueType.TEXT_DOCUMENT] = "TEXT_DOCUMENT";
    } catch (e) { /* older AE: some enum members might be absent */ }
})();

AE.KEY_INTERP_NAMES = {};
(function buildKitNames() {
    try {
        AE.KEY_INTERP_NAMES[KeyframeInterpolationType.LINEAR] = "linear";
        AE.KEY_INTERP_NAMES[KeyframeInterpolationType.BEZIER] = "bezier";
        AE.KEY_INTERP_NAMES[KeyframeInterpolationType.HOLD] = "hold";
    } catch (e) { /* older AE */ }
})();

// Safely call a getter that may throw or return undefined. Returns the fallback on any failure.
AE.safeGet = function (fn, fallback) {
    try { var v = fn(); return (v === undefined) ? fallback : v; } catch (e) { return fallback; }
};

AE.valueToJson = function (val, _depth) {
    if (val === null || val === undefined) return null;
    var t = typeof val;
    if (t === "number" || t === "boolean" || t === "string") return val;
    if (val instanceof Array) {
        var arr = [];
        for (var i = 0; i < val.length; i++) arr.push(AE.valueToJson(val[i], (_depth || 0) + 1));
        return arr;
    }
    // TextDocument special-case - check before generic array-like because
    // TextDocument does not expose a length property.
    if (val.text !== undefined && typeof val.text === "string" && val.fontSize !== undefined) {
        var td = {
            __kind: "TextDocument",
            text: val.text,
            font: AE.safeGet(function () { return val.font; }, null),
            fontFamily: AE.safeGet(function () { return val.fontFamily; }, null),
            fontStyle: AE.safeGet(function () { return val.fontStyle; }, null),
            fontSize: val.fontSize,
            fillColor: AE.safeGet(function () { return val.fillColor ? [val.fillColor[0], val.fillColor[1], val.fillColor[2]] : null; }, null),
            strokeColor: AE.safeGet(function () { return val.strokeColor ? [val.strokeColor[0], val.strokeColor[1], val.strokeColor[2]] : null; }, null),
            strokeWidth: AE.safeGet(function () { return val.strokeWidth; }, 0),
            justification: AE.safeGet(function () { return String(val.justification); }, null),
            tracking: AE.safeGet(function () { return val.tracking; }, 0),
            leading: AE.safeGet(function () { return val.leading; }, 0),
            baselineShift: AE.safeGet(function () { return val.baselineShift; }, 0),
            applyFill: AE.safeGet(function () { return val.applyFill; }, true),
            applyStroke: AE.safeGet(function () { return val.applyStroke; }, false),
            boxText: AE.safeGet(function () { return val.boxText; }, false),
            boxTextSize: AE.safeGet(function () { return val.boxText && val.boxTextSize ? [val.boxTextSize[0], val.boxTextSize[1]] : null; }, null),
            boxTextPos: AE.safeGet(function () { return val.boxText && val.boxTextPos ? [val.boxTextPos[0], val.boxTextPos[1]] : null; }, null)
        };
        // Character/paragraph styling. justification was a String(enum) in
        // v2 and never re-applied; it is now the enum number.
        td.justification = AE.safeGet(function () { return val.justification; }, null);
        AE._readAttrs(val, AE.TEXT_DOC_ATTRS, td);
        return td;
    }
    // Shape object (masks / shape layer paths)
    if (val.vertices !== undefined) {
        return {
            __kind: "Shape",
            closed: val.closed,
            vertices: AE.valueToJson(val.vertices),
            inTangents: AE.valueToJson(val.inTangents),
            outTangents: AE.valueToJson(val.outTangents)
        };
    }
    // MarkerValue - from marker keyframes (comp.markerProperty or layer.marker)
    if (val.comment !== undefined && val.chapter !== undefined) {
        return {
            __kind: "MarkerValue",
            comment: AE.safeGet(function () { return val.comment; }, ""),
            chapter: AE.safeGet(function () { return val.chapter; }, ""),
            url: AE.safeGet(function () { return val.url; }, ""),
            frameTarget: AE.safeGet(function () { return val.frameTarget; }, ""),
            cuePointName: AE.safeGet(function () { return val.cuePointName; }, ""),
            duration: AE.safeGet(function () { return val.duration; }, 0),
            label: AE.safeGet(function () { return val.label; }, 0),
            protectedRegion: AE.safeGet(function () { return val.protectedRegion; }, false)
        };
    }
    // Array-like (color tuples, position tuples). Check AFTER the typed
    // objects above so we don't accidentally treat them as arrays.
    if (val.length !== undefined && typeof val.length === "number") {
        var out = [];
        for (var j = 0; j < val.length; j++) out.push(AE.valueToJson(val[j], (_depth || 0) + 1));
        return out;
    }
    // Generic object (swatch data, usedFonts usage records, design-axis
    // entries). Depth-capped and function-skipping: AE host objects reachable
    // from here can fan out into the whole project graph, and their methods
    // enumerate in for..in.
    var d = typeof _depth === "number" ? _depth : 0;
    if (d < 4) {
        var objOut = {};
        var got = false;
        var kept = 0;
        for (var k in val) {
            if (kept >= 64) break;
            var v2;
            try { v2 = val[k]; } catch (eK) { continue; }
            if (typeof v2 === "function") continue;
            var enc = AE.valueToJson(v2, d + 1);
            if (enc === null && v2 !== null && v2 !== undefined) continue;
            objOut[k] = enc;
            got = true;
            kept++;
        }
        if (got) return objOut;
    }
    return null;
};

AE.serializeProperty = function (prop) {
    var out = {
        name: prop.name,
        matchName: prop.matchName,
        propertyValueType: AE.PROPERTY_VALUE_TYPE_NAMES[prop.propertyValueType] || prop.propertyValueType
    };
    // Avoid touching NO_VALUE groups and properties marked as not-yet-created
    if (prop.propertyValueType === PropertyValueType.NO_VALUE) {
        return out;
    }
    // CUSTOM_VALUE (Curves curve, Levels histogram, ...) cannot be read or
    // written by scripting at all; flag it so importers can say what is lost.
    if (prop.propertyValueType === PropertyValueType.CUSTOM_VALUE) {
        out.value = null;
        out.unscriptable = true;
        return out;
    }
    try {
        out.value = AE.valueToJson(prop.value);
    } catch (e) {
        out.value = null;
    }
    // Disabled expressions are kept too (a switched-off rig is still part of
    // the template); expressionEnabled says which. Absent flag = enabled, so
    // v2 documents keep their meaning.
    if (prop.canSetExpression && prop.expression && prop.expression.length > 0) {
        out.expression = prop.expression;
        if (!prop.expressionEnabled) out.expressionEnabled = false;
    }
    // Separate Dimensions lives on the leader (Position); the X/Y/Z followers
    // carry the values and keys once it is on.
    var separatedLeader = false;
    try { separatedLeader = !!(prop.isSeparationLeader && prop.dimensionsSeparated); } catch (eDs) {}
    if (separatedLeader) {
        // The hidden leader can carry keys that merely mirror its followers
        // (seen after imports); they are derived, so they are not exported.
        out.dimensionsSeparated = true;
        return out;
    }
    if (prop.numKeys && prop.numKeys > 0) {
        var keys = [];
        for (var k = 1; k <= prop.numKeys; k++) {
            var keyVal;
            try { keyVal = AE.valueToJson(prop.keyValue(k)); } catch (eKv) { keyVal = null; }
            var inInterp = null, outInterp = null;
            try { inInterp = prop.keyInInterpolationType(k); } catch (eI) {}
            try { outInterp = prop.keyOutInterpolationType(k); } catch (eO) {}
            var entry = {
                time: prop.keyTime(k),
                value: keyVal,
                inInterp: inInterp,
                outInterp: outInterp,
                inInterpName: AE.safeGet(function () { return AE.KEY_INTERP_NAMES[inInterp]; }, null),
                outInterpName: AE.safeGet(function () { return AE.KEY_INTERP_NAMES[outInterp]; }, null)
            };
            // Temporal ease (speed/influence) - only meaningful on bezier keys,
            // and only there does the extra bulk pay for itself (easing audits).
            try {
                if (inInterp === KeyframeInterpolationType.BEZIER || outInterp === KeyframeInterpolationType.BEZIER) {
                    entry.inEase = AE._serializeEase(prop.keyInTemporalEase(k));
                    entry.outEase = AE._serializeEase(prop.keyOutTemporalEase(k));
                }
            } catch (eEz) { /* pre-ease host or non-temporal property */ }
            AE._serializeKeyExtras(prop, k, entry);
            keys.push(entry);
        }
        out.keyframes = keys;
    }
    return out;
};

// Keyframe attributes beyond value/interp/ease: continuity, auto-bezier,
// spatial tangents, roving, label. Only non-default values are written so a
// plain linear key stays small. Spatial tangents are written whenever the
// key is not auto-bezier, since then the handles are user data.
AE._serializeKeyExtras = function (prop, k, entry) {
    try { if (prop.keyTemporalContinuous(k)) entry.temporalContinuous = true; } catch (e1) {}
    try { if (prop.keyTemporalAutoBezier(k)) entry.temporalAutoBezier = true; } catch (e2) {}
    try {
        if (prop.isSpatial) {
            var autoB = prop.keySpatialAutoBezier(k);
            if (autoB) entry.spatialAutoBezier = true;
            if (prop.keySpatialContinuous(k)) entry.spatialContinuous = true;
            if (!autoB) {
                entry.inSpatialTangent = AE.valueToJson(prop.keyInSpatialTangent(k));
                entry.outSpatialTangent = AE.valueToJson(prop.keyOutSpatialTangent(k));
            }
            if (prop.keyRoving(k)) entry.roving = true;
        }
    } catch (e3) {}
    try { var lbl = prop.keyLabel(k); if (lbl) entry.label = lbl; } catch (e4) { /* keyLabel is AE 22.6+ */ }
};

/** KeyframeEase[] -> [{speed, influence}, ...] (one per eased dimension). */
AE._serializeEase = function (eases) {
    if (!eases) return null;
    var arr = [];
    for (var i = 0; i < eases.length; i++) {
        arr.push({ speed: eases[i].speed, influence: eases[i].influence });
    }
    return arr;
};

/** [{speed, influence}, ...] -> KeyframeEase[] (inverse of _serializeEase). */
AE._deserializeEase = function (specs) {
    var arr = [];
    for (var i = 0; i < specs.length; i++) {
        arr.push(new KeyframeEase(specs[i].speed, specs[i].influence));
    }
    return arr;
};

// opts.onlyModified: skip leaf properties still at their default value (no
// keyframes, no expression, isModified false). Group skeletons are kept so
// the EXISTENCE of an effect/mask still shows even when all its params are
// default. When reading isModified throws, the property is kept - hiding
// data is the worse failure.
AE.serializePropertyGroup = function (group, depth, maxDepth, opts) {
    if (depth === undefined) depth = 0;
    if (maxDepth === undefined) maxDepth = 6;
    var out = {
        name: group.name,
        matchName: group.matchName,
        properties: [],
        groups: []
    };
    // The eyeball on effects, shape groups, text animators, layer styles.
    // A shape group's Material Options never has one in the UI; its
    // canSetEnabled only reflects whether the layer was 3D when the group
    // was made.
    try { if (group.canSetEnabled && group.matchName !== "ADBE Vector Materials Group") out.enabled = group.enabled; } catch (eEn) {}
    // Mask mode/invert/etc. are attributes of the mask group, not properties.
    try { if (group.isMask) out.mask = AE.serializeMaskAttrs(group); } catch (eMa) {}
    if (depth >= maxDepth) {
        // Say so instead of silently dropping the subtree.
        try { if (group.numProperties > 0) out.truncated = true; } catch (eTr) {}
        return out;
    }
    for (var i = 1; i <= group.numProperties; i++) {
        var child;
        try { child = group.property(i); } catch (e) { continue; }
        if (!child) continue;
        if (child.propertyType === PropertyType.PROPERTY) {
            if (opts && opts.onlyModified && !AE._propertyMatters(child)) continue;
            // A text animator's Properties group lists all ~100 animatable
            // properties; the ones not added are placeholders that cannot
            // take an expression (and ignore setValue).
            if (group.matchName === "ADBE Text Animator Properties" && !AE.safeGet(function () { return child.canSetExpression; }, true)) continue;
            out.properties.push(AE.serializeProperty(child));
        } else if (child.propertyType === PropertyType.NAMED_GROUP || child.propertyType === PropertyType.INDEXED_GROUP) {
            out.groups.push(AE.serializePropertyGroup(child, depth + 1, maxDepth, opts));
        }
    }
    return out;
};

AE.serializeMaskAttrs = function (mask) {
    var m = {};
    try { m.mode = mask.maskMode; } catch (e1) {}
    try { m.inverted = mask.inverted; } catch (e2) {}
    try { m.rotoBezier = mask.rotoBezier; } catch (e3) {}
    try { m.motionBlur = mask.maskMotionBlur; } catch (e4) {}
    try { m.featherFalloff = mask.maskFeatherFalloff; } catch (e5) {}
    try { m.locked = mask.locked; } catch (e6) {}
    try { m.color = [mask.color[0], mask.color[1], mask.color[2]]; } catch (e7) {}
    return m;
};

// ---------- Layer / comp attributes ----------
// Switches and settings that are attributes of the Layer/CompItem objects
// rather than properties in the tree, so a property walk never sees them.
// Read with guards: each list mixes attributes from different AE versions
// and layer classes, and a missing one is skipped.
AE.LAYER_ATTRS = ["comment", "autoOrient"];
AE.AVLAYER_ATTRS = ["adjustmentLayer", "guideLayer", "blendingMode", "motionBlur", "quality",
    "samplingQuality", "collapseTransformation", "frameBlendingType", "effectsActive",
    "preserveTransparency", "environmentLayer", "audioEnabled", "trackMatteType"];
// TextDocument fields beyond the core set in valueToJson. Order matters on
// import: autoLeading must be off before leading takes.
AE.TEXT_DOC_ATTRS = ["allCaps", "smallCaps", "fauxBold", "fauxItalic", "superscript", "subscript",
    "horizontalScale", "verticalScale", "tsume", "fontCapsOption", "fontBaselineOption",
    "autoKernType", "ligature", "strokeOverFill", "lineJoinType", "autoLeading",
    "firstLineIndent", "startIndent", "endIndent", "spaceBefore", "spaceAfter",
    "everyLineComposer", "hangingRoman", "direction", "baselineDirection"];
AE.COMP_ATTRS = ["frameBlending", "renderer", "resolutionFactor", "preserveNestedFrameRate",
    "preserveNestedResolution", "hideShyLayers", "draft3D", "motionBlurSamplesPerFrame",
    "motionBlurAdaptiveSampleLimit", "dropFrame"];

AE._readAttrs = function (obj, names, out) {
    for (var i = 0; i < names.length; i++) {
        var n = names[i];
        try {
            var v = obj[n];
            if (v === undefined || typeof v === "function") continue;
            out[n] = AE.valueToJson(v);
        } catch (e) { /* attribute absent on this AE version / layer class */ }
    }
    return out;
};

AE.serializeLayerAttrs = function (layer) {
    var a = AE._readAttrs(layer, AE.LAYER_ATTRS, {});
    try { a.nullLayer = layer.nullLayer; } catch (eNl) {}
    if (AE.isAVLayer(layer)) {
        AE._readAttrs(layer, AE.AVLAYER_ATTRS, a);
        // AE 23+: the matte is any layer, not just the one above.
        try {
            var tm = layer.trackMatteLayer;
            if (tm) a.trackMatteLayerIndex = tm.index;
        } catch (eTm) {}
    }
    if (layer instanceof TextLayer) {
        try { a.threeDPerChar = layer.threeDPerChar; } catch (e3c) {}
    }
    if (layer instanceof LightLayer) {
        try { a.lightType = layer.lightType; } catch (eLt) {}
        // Environment light source: a layer of the same comp, by index (the
        // importer's per-comp layer map) with the name as a cross-check.
        var ls = AE.lightSourceLayer(layer);
        if (ls) { a.lightSourceIndex = ls.index; a.lightSourceName = ls.name; }
    }
    if (AE.isMeshLayer(layer)) {
        // Decides which "Mesh Options"/"Bevel Options" groups are live; the
        // importer creates the mesh with it (addParametricMesh).
        var mt = AE.meshTypeName(layer);
        if (mt) a.parametricMeshType = mt;
    }
    return a;
};

AE.serializeCompAttrs = function (comp) {
    return AE._readAttrs(comp, AE.COMP_ATTRS, {});
};

// Top-level layer groups outside Transform/Effects/Masks/Text/Contents that
// hold real data. Layer Styles only counts once a style has been added.
// Order is import order: the mesh option groups (geometry) come before the
// material and compositing groups that shade it.
AE.EXTRA_LAYER_GROUPS = ["ADBE Camera Options Group", "ADBE Light Options Group",
    "ADBE Extrsn Options Group", "ADBE Plane Options Group",
    "ADBE CubeMeshOptionsSGrp", "ADBE CubeBevelOptionsSGrp", "ADBE SphereMeshOptionsSGrp",
    "ADBE PlaneMeshOptionsSGrp", "ADBE CylinderMeshOptionsSGrp", "ADBE CylinderBevelOptionsSGrp",
    "ADBE ConeMeshOptionsSGrp", "ADBE ConeBevelBevelSGrp", "ADBE TorusMeshOptionsSGrp",
    "ADBE ModelAnimOptionsSGrp", "ADBE3D Para Mat Parade", "ADBE3D Material Parade",
    "ADBE Displacement Options", "ADBE Compositing Options Group", "ADBE Layer Styles"];

/**
 * Whether an extra group carries live data on this layer (verified on AE 26.5
 * by writing values back). Skipped groups are hidden there - their values
 * cannot be read back into AE, so exporting them would only add noise:
 *   - Geometry Options (extrusion, plane curvature): 3D text/shape/footage only,
 *     never meshes or models;
 *   - mesh/bevel option groups: only the current mesh type's;
 *   - Compositing Options, Displacement, Material Assignment: meshes and models.
 */
AE.extraGroupApplies = function (layer, matchName, is3d, isA3dGeometry) {
    if (matchName === "ADBE Extrsn Options Group" || matchName === "ADBE Plane Options Group") return is3d && !isA3dGeometry;
    if (AE.isMeshOptionGroup(matchName)) return AE.meshGroupActive(layer, matchName) === true;
    if (matchName === "ADBE Compositing Options Group" || matchName === "ADBE Displacement Options" ||
        matchName === "ADBE3D Para Mat Parade" || matchName === "ADBE3D Material Parade" ||
        matchName === "ADBE ModelAnimOptionsSGrp") return isA3dGeometry;
    return true;
};

/**
 * Every style group (dropShadow/enabled, frameFX/enabled, ...) always exists
 * under Layer Styles; an added style is the one whose eyeball can be set.
 */
AE.layerHasStyles = function (grp) {
    try { return grp.canSetEnabled === true; } catch (e) { return false; }
};

/** Drop the style groups that were never added (they only carry defaults). */
AE.pruneLayerStyles = function (gs) {
    var kept = [];
    for (var i = 0; i < gs.groups.length; i++) {
        var g = gs.groups[i];
        if (g.matchName === "ADBE Blend Options Group" || g.enabled !== undefined) kept.push(g);
    }
    gs.groups = kept;
    return gs;
};

// Layer styles cannot be added with addProperty; these menu command ids
// (stable across UI languages) add one to the selected layer.
AE.LAYER_STYLE_COMMANDS = {
    "dropShadow/enabled": 9000, "innerShadow/enabled": 9001, "outerGlow/enabled": 9002,
    "innerGlow/enabled": 9003, "bevelEmboss/enabled": 9004, "chromeFX/enabled": 9005,
    "solidFill/enabled": 9006, "gradientFill/enabled": 9007, "frameFX/enabled": 9008
};

/** True when a leaf property carries information: modified, keyed, or expressed. */
AE._propertyMatters = function (prop) {
    try { if (prop.isModified === true) return true; } catch (eIm) { return true; }
    try { if (prop.numKeys && prop.numKeys > 0) return true; } catch (eNk) {}
    try {
        if (prop.canSetExpression && prop.expressionEnabled && prop.expression && prop.expression.length > 0) return true;
    } catch (eEx) {}
    return false;
};

/** True when a serialized group tree holds no leaf properties at any depth. */
AE.propertyGroupIsEmpty = function (g) {
    if (!g) return true;
    if (g.properties && g.properties.length > 0) return false;
    if (g.groups) {
        for (var i = 0; i < g.groups.length; i++) {
            if (!AE.propertyGroupIsEmpty(g.groups[i])) return false;
        }
    }
    return true;
};

// ---------- Layer full serialization ----------

// opts.includeProperties=false skips the property tree entirely.
// opts.detail="summary" keeps the tree but drops leaves still at their default
// value (AE._propertyMatters) - the answer to 150KB-per-comp audits. Trees
// that exist on every layer (Transform, Material Options, Audio) collapse to
// null when nothing in them was touched; Effects/Masks/Text/Contents keep
// their skeleton so their existence still shows.
AE.serializeLayerFull = function (layer, opts) {
    opts = opts || {};
    var out = AE.serializeLayerSummary(layer);
    // Parent by index for simple remapping on import.
    out.parent = layer.parent ? { index: layer.parent.index, name: layer.parent.name } : null;
    out.attrs = AE.serializeLayerAttrs(layer);
    var summary = opts.detail === "summary";
    var isA3dGeometry = AE.isMeshLayer(layer) || AE.isModelLayer(layer);
    var is3d = AE.safeGet(function () { return layer.threeDLayer === true; }, false);
    var walkOpts = summary ? { onlyModified: true } : null;
    function collapse(g) { return (summary && AE.propertyGroupIsEmpty(g)) ? null : g; }
    // Property tree (Transform + Effects + Masks + Text + Contents + Material Options + Audio)
    if (opts.includeProperties !== false) {
        try { out.transformGroup = collapse(AE.serializePropertyGroup(layer.property("Transform"), 0, 6, walkOpts)); } catch (eT) { out.transformGroup = null; }
        try {
            var effects = layer.property("Effects");
            out.effectsGroup = (effects && effects.numProperties > 0) ? AE.serializePropertyGroup(effects, 0, 10, walkOpts) : null;
        } catch (eE) { out.effectsGroup = null; }
        try {
            var masks = layer.property("Masks");
            out.masksGroup = (masks && masks.numProperties > 0) ? AE.serializePropertyGroup(masks, 0, 8, walkOpts) : null;
        } catch (eM) { out.masksGroup = null; }
        if (layer instanceof TextLayer) {
            // Text > Animators > Animator > Selectors > Selector > Advanced: 6 deep.
            try { out.textGroup = AE.serializePropertyGroup(layer.property("Text"), 0, 10, walkOpts); } catch (eTx) { out.textGroup = null; }
        }
        if (layer instanceof ShapeLayer) {
            // Shape layers have a Contents group that holds the shape vector
            // graphics. Walk deeper because shape groups nest several levels.
            try { out.contentsGroup = AE.serializePropertyGroup(layer.property("Contents"), 0, 16, walkOpts); } catch (eCt) { out.contentsGroup = null; }
        }
        // Material options (3D layers)
        // Meshes and 3D models keep their material in "Material Assignment"
        // and their shadow switches in "Compositing Options" (extra groups
        // below); their Material Options group is hidden.
        if (AE.isAVLayer(layer) && layer.threeDLayer && !isA3dGeometry) {
            try {
                var mat = layer.property("ADBE Material Options Group");
                out.materialOptionsGroup = mat ? collapse(AE.serializePropertyGroup(mat, 0, 6, walkOpts)) : null;
            } catch (eMo) { out.materialOptionsGroup = null; }
        }
        // Audio (if layer has audio)
        if (AE.isAVLayer(layer) && AE.safeGet(function () { return layer.hasAudio; }, false)) {
            try {
                var au = layer.property("Audio");
                out.audioGroup = au ? collapse(AE.serializePropertyGroup(au, 0, 6, walkOpts)) : null;
            } catch (eAu) { out.audioGroup = null; }
        }
        // Time Remap (AV layers only, must be enabled). On a 3D model it drives
        // the glTF animation clip.
        if (AE.isAVLayer(layer)) {
            try {
                out.timeRemapEnabled = !!layer.timeRemapEnabled;
                if (layer.timeRemapEnabled) {
                    var tr = layer.property("Time Remap");
                    out.timeRemapProperty = tr ? AE.serializeProperty(tr) : null;
                }
            } catch (eTr) { /* ignore */ }
        }
        // Layer markers - layer.marker is a NamedGroup with keyframed MarkerValues
        try {
            var marker = layer.property("Marker");
            if (marker && marker.numKeys > 0) {
                out.markers = AE.serializeProperty(marker);
            }
        } catch (eMk) { /* ignore */ }
        // Camera/Light Options, 3D geometry and materials, Layer Styles.
        var extra = [];
        for (var xg = 0; xg < AE.EXTRA_LAYER_GROUPS.length; xg++) {
            var xmn = AE.EXTRA_LAYER_GROUPS[xg];
            if (!AE.extraGroupApplies(layer, xmn, is3d, isA3dGeometry)) continue;
            var grp = null;
            try { grp = layer.property(xmn); } catch (eXg) {}
            if (!grp) continue;
            if (xmn === "ADBE Layer Styles" && !AE.layerHasStyles(grp)) continue;
            try {
                var gs = AE.serializePropertyGroup(grp, 0, 10, walkOpts);
                if (xmn === "ADBE Layer Styles") AE.pruneLayerStyles(gs);
                if (!(summary && AE.propertyGroupIsEmpty(gs))) extra.push(gs);
            } catch (eXs) {}
        }
        if (extra.length > 0) out.extraGroups = extra;
    }
    return out;
};

// ---------- Keyframe snapshot / rebuild ----------
// Captures every scriptable attribute of a property's keyframes so they can be
// re-created after retiming (shift/scale) or on another property (copy).
// Interpolation, temporal ease, and spatial tangents are restored best-effort.

AE.snapshotKeys = function (prop) {
    var keys = [];
    for (var k = 1; k <= prop.numKeys; k++) {
        var key = { time: prop.keyTime(k), value: prop.keyValue(k) };
        try { key.inInterp = prop.keyInInterpolationType(k); } catch (e1) {}
        try { key.outInterp = prop.keyOutInterpolationType(k); } catch (e2) {}
        try { key.inEase = prop.keyInTemporalEase(k); } catch (e3) {}
        try { key.outEase = prop.keyOutTemporalEase(k); } catch (e4) {}
        try { key.temporalContinuous = prop.keyTemporalContinuous(k); } catch (e5) {}
        try { key.temporalAutoBezier = prop.keyTemporalAutoBezier(k); } catch (e6) {}
        try {
            if (prop.isSpatial) {
                key.inSpatialTangent = prop.keyInSpatialTangent(k);
                key.outSpatialTangent = prop.keyOutSpatialTangent(k);
                key.spatialContinuous = prop.keySpatialContinuous(k);
                key.spatialAutoBezier = prop.keySpatialAutoBezier(k);
                key.roving = prop.keyRoving(k);
            }
        } catch (e7) {}
        keys.push(key);
    }
    return keys;
};

AE.removeAllKeys = function (prop) {
    var removed = 0;
    while (prop.numKeys > 0) { prop.removeKey(prop.numKeys); removed++; }
    return removed;
};

// Re-create keys from a snapshot whose times the caller may have remapped.
// Two passes: values first, then interpolation attributes - writing bezier
// data while neighbours are still being inserted shifts the handles.
AE.applyKeys = function (prop, keys) {
    var i, key, ki;
    // addKey on a time that already carries a key returns the existing index
    // rather than adding one, so keys.length overstates the result whenever
    // two snapshot times collide or land on an existing key. Report what the
    // property actually gained.
    var before = prop.numKeys;
    for (i = 0; i < keys.length; i++) {
        key = keys[i];
        ki = prop.addKey(key.time);
        try { prop.setValueAtKey(ki, key.value); } catch (eV) {}
    }
    for (i = 0; i < keys.length; i++) {
        key = keys[i];
        ki = prop.nearestKeyIndex(key.time);
        // Ease before interpolation type: setting ease flips the key to
        // BEZIER, so a HOLD/LINEAR snapshot must be re-asserted afterwards.
        try { if (key.inEase && key.outEase) prop.setTemporalEaseAtKey(ki, key.inEase, key.outEase); } catch (eE) {}
        try { if (key.inInterp !== undefined && key.outInterp !== undefined) prop.setInterpolationTypeAtKey(ki, key.inInterp, key.outInterp); } catch (eI) {}
        try { if (key.temporalContinuous !== undefined) prop.setTemporalContinuousAtKey(ki, key.temporalContinuous); } catch (eC) {}
        try { if (key.temporalAutoBezier !== undefined) prop.setTemporalAutoBezierAtKey(ki, key.temporalAutoBezier); } catch (eB) {}
        try {
            if (key.inSpatialTangent !== undefined) {
                prop.setSpatialTangentsAtKey(ki, key.inSpatialTangent, key.outSpatialTangent);
                prop.setSpatialContinuousAtKey(ki, key.spatialContinuous);
                prop.setSpatialAutoBezierAtKey(ki, key.spatialAutoBezier);
                prop.setRovingAtKey(ki, key.roving);
            }
        } catch (eS) {}
    }
    return keys.length;
};

// ---------- Keyframe easing shorthand ----------

// Set temporal ease on one key and flip it to bezier. Handles the dimension
// bookkeeping that setTemporalEaseAtKey demands: spatial properties
// (Position/Anchor Point) take exactly ONE KeyframeEase regardless of value
// dimensions; everything else takes one per dimension. Same contract as the
// keyframe.set_easing operation - this is its eval.run twin.
// Speeds default to 0 (ease-style handles). Influence range is 0.1-100.
AE.setEase = function (prop, keyIndex, inInfluence, outInfluence, inSpeed, outSpeed) {
    if (inSpeed === undefined) inSpeed = 0;
    if (outSpeed === undefined) outSpeed = 0;
    var dims = 1;
    var spatial = false;
    try {
        var pvt = prop.propertyValueType;
        if (pvt === PropertyValueType.TwoD_SPATIAL || pvt === PropertyValueType.ThreeD_SPATIAL) spatial = true;
    } catch (ePvt) {}
    if (!spatial) {
        try { var v = prop.keyValue(keyIndex); if (v && v.length) dims = v.length; } catch (eV) {}
    }
    var inArr = [], outArr = [];
    for (var d = 0; d < dims; d++) {
        inArr.push(new KeyframeEase(inSpeed, inInfluence));
        outArr.push(new KeyframeEase(outSpeed, outInfluence));
    }
    prop.setTemporalEaseAtKey(keyIndex, inArr, outArr);
    prop.setInterpolationTypeAtKey(keyIndex, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
    return keyIndex;
};

// ---------- Shape construction shorthand ----------

/** Resolve a ShapeLayer, a vector group, or a Contents group to the Contents to add into. */
AE._vectorContents = function (parent) {
    if (parent && parent.matchName === "ADBE Vector Group") return parent.property("Contents");
    if (parent && (parent.matchName === "ADBE Vectors Group" || parent.matchName === "ADBE Root Vectors Group")) return parent;
    return parent.property("Contents"); // shape layer
};

/** Append fill/stroke from opts ({fill, fillOpacity, stroke, strokeWidth}) to a Contents group. */
AE._applyShapeStyle = function (contents, opts) {
    if (opts.fill) {
        var fill = contents.addProperty("ADBE Vector Graphic - Fill");
        fill.property("ADBE Vector Fill Color").setValue(opts.fill);
        if (opts.fillOpacity !== undefined) fill.property("ADBE Vector Fill Opacity").setValue(opts.fillOpacity);
    }
    if (opts.stroke) {
        var st = contents.addProperty("ADBE Vector Graphic - Stroke");
        st.property("ADBE Vector Stroke Color").setValue(opts.stroke);
        if (opts.strokeWidth !== undefined) st.property("ADBE Vector Stroke Width").setValue(opts.strokeWidth);
    }
};

// One call = one styled primitive: a new vector group holding the path plus
// optional fill/stroke. `parent` is a ShapeLayer or a vector group. Returns
// the created group. opts: { name, roundness (rect only), fill: [r,g,b(,a)],
// fillOpacity, stroke: [r,g,b(,a)], strokeWidth }. Colors are 0-1.
AE.rect = function (parent, size, position, opts) {
    opts = opts || {};
    var contents = AE._vectorContents(parent);
    var grp = contents.addProperty("ADBE Vector Group");
    if (opts.name) grp.name = opts.name;
    var inner = grp.property("Contents");
    var shp = inner.addProperty("ADBE Vector Shape - Rect");
    shp.property("ADBE Vector Rect Size").setValue(size);
    if (position) shp.property("ADBE Vector Rect Position").setValue(position);
    if (opts.roundness) shp.property("ADBE Vector Rect Roundness").setValue(opts.roundness);
    AE._applyShapeStyle(inner, opts);
    return grp;
};

AE.ellipse = function (parent, size, position, opts) {
    opts = opts || {};
    var contents = AE._vectorContents(parent);
    var grp = contents.addProperty("ADBE Vector Group");
    if (opts.name) grp.name = opts.name;
    var inner = grp.property("Contents");
    var shp = inner.addProperty("ADBE Vector Shape - Ellipse");
    shp.property("ADBE Vector Ellipse Size").setValue(size);
    if (position) shp.property("ADBE Vector Ellipse Position").setValue(position);
    AE._applyShapeStyle(inner, opts);
    return grp;
};

// ---------- Filesystem ----------

// Create the parent directory chain for a file path (string or File) and
// return the File. AE's own render pipeline does NOT create output folders -
// rq.render() dies with "Directory does not exist" - so every code path that
// points an output module at a file goes through this first.
AE.ensureParentDir = function (pathOrFile) {
    var f = (pathOrFile instanceof File) ? pathOrFile : new File(pathOrFile);
    function mk(folder) {
        if (!folder || folder.exists) return;
        mk(folder.parent);
        folder.create();
    }
    try { mk(f.parent); } catch (eMk) { /* creation failures surface at write time */ }
    return f;
};

// ---------- Composition marker serialization ----------

AE.serializeCompMarkers = function (comp) {
    try {
        var mp = comp.markerProperty;
        if (!mp || mp.numKeys === 0) return null;
        return AE.serializeProperty(mp);
    } catch (e) { return null; }
};

// ---------- Footage sources (export schema v4) ----------
//
// A FootageItem's mainSource (and any AVItem's proxySource) carries the
// Interpret Footage settings. Export records them; import re-creates the source
// and writes them back in dependency order, then reads every one back so a
// value AE refused surfaces as a warning instead of a silent loss.
//
// Not scriptable in AE (no attribute exists on FileSource / FootageItem as of
// 26.5, checked with reflect.properties): the per-footage Color tab (input
// profile, Preserve RGB, linear light). Project-level color settings are
// carried by AE.PROJECT_ATTRS instead.

AE.FOOTAGE_INTERP_ALPHA = ["alphaMode", "premulColor", "invertAlpha"];
AE.FOOTAGE_INTERP_TIME = ["fieldSeparationType", "highQualityFieldSeparation", "removePulldown", "conformFrameRate", "loop"];

// Still-image formats AE can read as a numbered sequence. A non-still file
// source with one of these extensions is an image sequence.
AE.SEQUENCE_EXTS = {};
(function () {
    var list = ("png jpg jpeg tif tiff exr sxr mxr dpx cin tga targa vda icb vst bmp rle dib psd sgi bw rgb rgba " +
        "iff tdi hdr rgbe xyze rla rpf pic crw cr2 cr3 nef arw dng raf orf rw2 heic heif webp avif jxl").split(" ");
    for (var i = 0; i < list.length; i++) AE.SEQUENCE_EXTS[list[i]] = true;
})();
AE.isSequenceExt = function (path) {
    var m = /\.([A-Za-z0-9]+)$/.exec(String(path));
    return !!(m && AE.SEQUENCE_EXTS[m[1].toLowerCase()] === true);
};

/** The interpretation attributes that mean something for this source. */
AE.serializeFootageInterpretation = function (src) {
    var out = {};
    var hasAlpha = AE.safeGet(function () { return src.hasAlpha; }, false);
    var still = AE.safeGet(function () { return src.isStill; }, true);
    if (hasAlpha) AE._readAttrs(src, AE.FOOTAGE_INTERP_ALPHA, out);
    if (!still) AE._readAttrs(src, AE.FOOTAGE_INTERP_TIME, out);
    return out;
};

/**
 * Numbered-sequence description from the first frame's file name and the
 * frame count: { start, end, digits } so import can ask for exactly the frames
 * the item had (ImportOptions.rangeStart/rangeEnd). A name without a frame
 * number can only have been imported alphabetically.
 */
AE.describeSequence = function (path, frames) {
    var base = String(path).replace(/^.*[\/\\]/, "");
    var m = /(\d+)(\.[^.]+)$/.exec(base);
    if (!m) return { alphabetical: true };
    var start = parseInt(m[1], 10);
    var out = { start: start, digits: m[1].length };
    if (frames > 0) out.end = start + frames - 1;
    return out;
};

/** Serialize a FootageSource (main or proxy). `frames` sizes a sequence's range. */
AE.serializeFootageSource = function (src, frames) {
    var out = {};
    if (src instanceof SolidSource) {
        out.sourceKind = "solid";
        out.color = [src.color[0], src.color[1], src.color[2]];
    } else if (src instanceof FileSource) {
        out.sourceKind = "file";
        var missing = AE.safeGet(function () { return src.missingFootagePath; }, "");
        var f = AE.safeGet(function () { return src.file; }, null);
        out.file = f ? f.fsName.replace(/\\/g, "/") : (missing ? String(missing).replace(/\\/g, "/") : null);
        if (missing) out.missingFootagePath = String(missing).replace(/\\/g, "/");
        if (out.file && !src.isStill && AE.isSequenceExt(out.file)) out.sequence = AE.describeSequence(out.file, frames);
    } else if (src instanceof PlaceholderSource) {
        out.sourceKind = "placeholder";
    } else {
        out.sourceKind = "unknown";
    }
    out.isStill = AE.safeGet(function () { return src.isStill; }, null);
    out.hasAlpha = AE.safeGet(function () { return src.hasAlpha; }, null);
    out.nativeFrameRate = AE.safeGet(function () { return src.nativeFrameRate; }, null);
    out.displayFrameRate = AE.safeGet(function () { return src.displayFrameRate; }, null);
    out.interpretation = AE.serializeFootageInterpretation(src);
    return out;
};

/** Proxy of any AVItem (footage or comp), or null when it has none. */
AE.serializeProxy = function (item) {
    var ps = AE.safeGet(function () { return item.proxySource; }, null);
    if (!ps) return null;
    var out = AE.serializeFootageSource(ps, 0);
    out.useProxy = !!item.useProxy;
    // A placeholder/solid proxy reports no size of its own; AE sizes it to the item.
    out.width = item.width; out.height = item.height;
    out.frameRate = item.frameRate; out.duration = item.duration;
    return out;
};

/** Frames in an AVItem at its displayed rate. */
AE.itemFrameCount = function (item) {
    var fps = AE.safeGet(function () { return item.frameRate; }, 0);
    var dur = AE.safeGet(function () { return item.duration; }, 0);
    return (fps > 0 && dur > 0) ? Math.round(dur * fps) : 0;
};

/** Frames of footage before looping: AE multiplies an item's duration by `loop`. */
AE.sourceFrameCount = function (item) {
    var n = AE.itemFrameCount(item);
    var loop = AE.safeGet(function () { return item.mainSource.loop; }, 1);
    return (typeof loop === "number" && loop > 1) ? Math.round(n / loop) : n;
};

/**
 * Write interpretation settings onto a source in the order AE accepts them
 * (pulldown needs field separation; conform 0 is refused while pulldown is
 * on; alpha extras need an alpha), then read each one back. Returns the list
 * of attributes that did not stick.
 */
AE.applyFootageInterpretation = function (src, interp, warn, what) {
    if (!src || !interp) return [];
    interp = AE.resolveInterpretationEnums(interp, warn, what);
    var failed = [];
    function set(name) {
        if (interp[name] === undefined || interp[name] === null) return;
        try {
            var cur = src[name];
            if (!AE._interpEqual(cur, interp[name])) src[name] = interp[name];
        } catch (e) { warn(what + ": interpretation " + name + " not applied: " + AE.errText(e)); }
    }
    var still = AE.safeGet(function () { return src.isStill; }, true);
    if (!still) {
        if (interp.removePulldown !== undefined && interp.removePulldown === PulldownPhase.OFF) {
            set("removePulldown");
            set("fieldSeparationType");
        } else {
            set("fieldSeparationType");
            set("removePulldown");
        }
        var fieldOn = AE.safeGet(function () { return src.fieldSeparationType !== FieldSeparationType.OFF; }, false);
        if (fieldOn) set("highQualityFieldSeparation");
        set("conformFrameRate");
        set("loop");
    }
    var hasAlpha = AE.safeGet(function () { return src.hasAlpha; }, false);
    if (hasAlpha) {
        set("alphaMode");
        if (AE.safeGet(function () { return src.alphaMode === AlphaMode.PREMULTIPLIED; }, false)) set("premulColor");
        set("invertAlpha");
    }
    // Read back: anything that differs is reported, never dropped silently.
    for (var k in interp) {
        if (!interp.hasOwnProperty(k)) continue;
        if (k === "highQualityFieldSeparation" && !AE.safeGet(function () { return src.fieldSeparationType !== FieldSeparationType.OFF; }, false)) continue;
        if (k === "premulColor" && !AE.safeGet(function () { return src.alphaMode === AlphaMode.PREMULTIPLIED; }, false)) continue;
        var isAlphaAttr = (k === "alphaMode" || k === "premulColor" || k === "invertAlpha");
        if (isAlphaAttr && !hasAlpha) { failed.push(k); warn(what + ": source has no alpha now; " + k + " not applied"); continue; }
        if (!isAlphaAttr && still) { failed.push(k); warn(what + ": source is still now; " + k + " not applied"); continue; }
        var got = AE.safeGet(function () { return src[k]; }, null);
        if (!AE._interpEqual(got, interp[k])) {
            failed.push(k);
            warn(what + ": interpretation " + k + " is " + AE._jsonText(got) + ", wanted " + AE._jsonText(interp[k]));
        }
    }
    return failed;
};

// Enum-valued interpretation fields may be written by name ("STRAIGHT",
// "UPPER_FIELD_FIRST", "OFF") so documents need not carry AE's raw numbers.
AE.INTERP_ENUMS = { alphaMode: "AlphaMode", fieldSeparationType: "FieldSeparationType", removePulldown: "PulldownPhase" };

AE.resolveInterpretationEnums = function (interp, warn, what) {
    var out = {};
    for (var k in interp) {
        if (!interp.hasOwnProperty(k)) continue;
        var v = interp[k];
        if (typeof v === "string" && AE.INTERP_ENUMS.hasOwnProperty(k)) {
            var en = $.global[AE.INTERP_ENUMS[k]];
            var num = en ? en[v.toUpperCase()] : undefined;
            if (typeof num !== "number") { warn(what + ": unknown " + k + " '" + v + "'"); continue; }
            v = num;
        }
        out[k] = v;
    }
    return out;
};

AE._interpEqual = function (a, b) {
    if (a instanceof Array || b instanceof Array) {
        if (!(a instanceof Array) || !(b instanceof Array) || a.length !== b.length) return false;
        for (var i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-4) return false;
        return true;
    }
    if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-4;
    return a === b;
};

AE._jsonText = function (v) {
    try { return JSON.stringify(v); } catch (e) { return String(v); }
};

/**
 * Import a file (or numbered sequence) as plain footage. Returns
 * { item, rangeHonored } or { item: null, reason }.
 */
AE.importFootageFile = function (path, sequence, warn, what) {
    var f = new File(path);
    if (!f.exists) return { item: null, reason: "missing" };
    var io = new ImportOptions(f);
    var ranged = false;
    if (sequence) {
        io.sequence = true;
        if (sequence.alphabetical) {
            io.forceAlphabetical = true;
        } else if (typeof sequence.start === "number" && typeof sequence.end === "number") {
            try { io.forceAlphabetical = false; io.rangeStart = sequence.start; io.rangeEnd = sequence.end; ranged = true; } catch (eR) { ranged = false; }
        }
    }
    try { if (io.canImportAs(ImportAsType.FOOTAGE)) io.importAs = ImportAsType.FOOTAGE; } catch (eAs) {}
    var item = null;
    try {
        item = app.project.importFile(io);
    } catch (eImp) {
        if (!ranged) throw eImp;
        // The frames on disk no longer cover the recorded range: take what is there.
        warn(what + ": frames " + sequence.start + "-" + sequence.end + " not all on disk (" + AE.errText(eImp) + "); imported the whole sequence");
        var io2 = new ImportOptions(f);
        io2.sequence = true;
        try { if (io2.canImportAs(ImportAsType.FOOTAGE)) io2.importAs = ImportAsType.FOOTAGE; } catch (eAs2) {}
        item = app.project.importFile(io2);
        ranged = false;
    }
    return { item: item, rangeHonored: ranged };
};

/** Re-create a proxy on an AVItem from AE.serializeProxy output. */
AE.applyProxy = function (item, p, warn, what) {
    if (!p) return;
    var name = item.name;
    var w = Math.max(4, p.width || item.width || 100);
    var h = Math.max(4, p.height || item.height || 100);
    var fps = p.frameRate || item.frameRate || 30;
    var dur = (p.duration !== undefined && p.duration !== null) ? p.duration : (item.duration || 0);
    try {
        if (p.sourceKind === "file") {
            var f = p.file ? new File(p.file) : null;
            if (!f || !f.exists) {
                warn(what + ": proxy file '" + p.file + "' not found on disk; proxy set to a placeholder");
                item.setProxyWithPlaceholder(name, w, h, fps, dur);
            } else if (p.sequence) {
                item.setProxyWithSequence(f, !!p.sequence.alphabetical);
            } else {
                item.setProxy(f);
            }
        } else if (p.sourceKind === "placeholder") {
            item.setProxyWithPlaceholder(name, w, h, fps, dur);
        } else if (p.sourceKind === "solid") {
            item.setProxyWithSolid(p.color || [0, 0, 0], name, w, h, item.pixelAspect || 1);
        } else {
            warn(what + ": proxy of kind '" + p.sourceKind + "' cannot be re-created; skipped");
            return;
        }
        AE.applyFootageInterpretation(item.proxySource, p.interpretation, warn, what + " proxy");
        item.useProxy = !!p.useProxy;
    } catch (e) {
        warn(what + ": proxy restore failed: " + AE.errText(e));
    }
};

// Project settings carried in doc.project.settings. Order matters: the color
// management system decides which of the color attributes exist.
AE.PROJECT_ATTRS = ["bitsPerChannel", "colorManagementSystem", "ocioConfigurationFile", "workingSpace",
    "workingGamma", "linearBlending", "linearizeWorkingSpace", "compensateForSceneReferredProfiles",
    "lutInterpolationMethod", "expressionEngine", "timeDisplayType", "framesCountType",
    "framesUseFeetFrames", "feetFramesFilmType", "footageTimecodeDisplayStartType", "displayStartFrame",
    "transparencyGridThumbnails"];
