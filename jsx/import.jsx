// mcp-aftereffects project import - reconstructs items and layers from a JSON
// document produced by AE.exportProject(). Returns a summary including an
// ID remap table (old id -> new id) and a list of warnings for things that
// could not be restored cleanly.
//
// Design:
//   1. Create all FolderItems first (flat pass), then wire up parentFolder.
//   2. Create FootageItems: solids from AE, file references via importFile
//      (fails gracefully if the file is missing).
//   3. Create CompItems.
//   4. For each comp, add its layers in order, remapping source item ids via
//      the remap table, then apply the property trees (transform/effects/
//      masks/text) and keyframes.
//   5. Wire up layer parenting last (since parents must exist).
//
// ES3-compatible. No arrow functions. No map/filter.

AE.importProject = function (doc, opts) {
    opts = opts || {};
    var warnings = [];
    var logs = [];
    function warn(msg) { warnings.push(msg); }
    function note(msg) { logs.push(msg); }

    if (!doc || !doc.items) {
        return { ok: false, error: "invalid document: missing items" };
    }
    if (doc.schemaVersion && doc.schemaVersion > AE.EXPORT_SCHEMA_VERSION) {
        warn("document schemaVersion " + doc.schemaVersion + " newer than runtime " + AE.EXPORT_SCHEMA_VERSION);
    }

    var proj = app.project;

    // Optionally clear the project first.
    if (opts.clearFirst) {
        var toRemove = [];
        for (var ci = 1; ci <= proj.numItems; ci++) toRemove.push(proj.item(ci));
        for (var ri = 0; ri < toRemove.length; ri++) {
            try { toRemove[ri].remove(); } catch (e) { /* some items can't be removed */ }
        }
    }

    // Project settings describe the whole project, so they are applied only
    // when the document replaces it (clearFirst) or the caller asks for them.
    var applySettings = opts.projectSettings === true || (opts.clearFirst && opts.projectSettings !== false);
    if (applySettings && doc.project && doc.project.settings) {
        var ps = doc.project.settings;
        for (var pk = 0; pk < AE.PROJECT_ATTRS.length; pk++) {
            var pn = AE.PROJECT_ATTRS[pk];
            if (ps[pn] === undefined || ps[pn] === null) continue;
            try {
                if (proj[pn] !== ps[pn]) proj[pn] = ps[pn];
                if (!AE._interpEqual(proj[pn], ps[pn])) warn("project setting " + pn + " is " + AE._jsonText(proj[pn]) + ", wanted " + AE._jsonText(ps[pn]));
            } catch (ePs) { warn("project setting " + pn + " not applied: " + AE.errText(ePs)); }
        }
    }

    // --- Pass 1: folders (flat create, wire parents in pass 5) ---
    var remap = {}; // old item id (string) -> new item
    var items = doc.items;

    var i;
    for (i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.type === "FolderItem") {
            var f = proj.items.addFolder(it.name);
            remap[String(it.id)] = f;
        }
    }

    // --- Pass 2: footage items ---
    // AE has no direct API to create a standalone Solid FootageItem. The
    // idiom is to spin up a throwaway comp, call LayerCollection#addSolid
    // (which creates both the Solid footage and a layer using it), then
    // delete the throwaway comp. The FootageItem persists in the project's
    // Solids folder.
    var footageBindings = []; // { item, spec } - pixelAspect/proxy restore after creation
    for (i = 0; i < items.length; i++) {
        var fi = items[i];
        if (fi.type !== "FootageItem") continue;
        var what = "footage '" + fi.name + "'";
        if (fi.sourceKind === "solid") {
            try {
                var color = fi.color || [1, 1, 1];
                var w = fi.sourceWidth || fi.width || 100;
                var h = fi.sourceHeight || fi.height || 100;
                var dur = fi.duration || 1;
                var pa = fi.pixelAspect || 1;
                var holder = proj.items.addComp("__mcp_ae_solid_holder__", w, h, pa, Math.max(1, dur), 30);
                var holderLayer = holder.layers.addSolid(color, fi.name, w, h, pa, dur);
                var solidSource = holderLayer.source; // FootageItem
                holder.remove();
                if (solidSource) {
                    remap[String(fi.id)] = solidSource;
                    footageBindings.push({ item: solidSource, spec: fi });
                } else {
                    warn("addSolid produced no source for '" + fi.name + "'");
                }
            } catch (eSol) {
                warn("failed to create solid '" + fi.name + "': " + AE.errText(eSol));
            }
        } else if (fi.sourceKind === "file" || fi.sourceKind === "placeholder") {
            try {
                var made = null, standIn = false;
                if (fi.sourceKind === "file") {
                    if (!fi.file) {
                        warn(what + " has no path; created a placeholder");
                    } else {
                        var got = AE.importFootageFile(fi.file, fi.sequence || null, warn, what);
                        made = got.item;
                        if (!made) warn("file footage '" + fi.file + "' not found on disk; creating placeholder");
                        else if (!(made instanceof FootageItem)) {
                            warn(what + ": '" + fi.file + "' imported as " + AE.itemTypeName(made) + ", not footage");
                        }
                    }
                }
                if (!made) {
                    standIn = fi.sourceKind === "file";
                    // ItemCollection has no addFootage; a placeholder keeps dependent
                    // layers (and their timing) intact until the file is relinked.
                    var phW = Math.max(4, fi.sourceWidth || fi.width || 1920);
                    var phH = Math.max(4, fi.sourceHeight || fi.height || 1080);
                    var phFps = fi.frameRate || fi.displayFrameRate || 30;
                    var phDur = (fi.duration !== undefined && fi.duration !== null) ? fi.duration : 10;
                    if (fi.isStill === true) phDur = 0;
                    made = proj.importPlaceholder(fi.name || String(fi.file), phW, phH, phFps, phDur);
                }
                if (fi.name && made.name !== fi.name) made.name = fi.name;
                remap[String(fi.id)] = made;
                if (made instanceof FootageItem) {
                    var interp = fi.interpretation;
                    if (interp && standIn) {
                        // A placeholder standing in for a missing file is created at the
                        // item's displayed rate and has no alpha. Keep the time settings
                        // that still mean something, so a later relink (FootageItem.replace
                        // keeps interpretation) gets them back.
                        interp = {};
                        for (var ik in fi.interpretation) {
                            if (!fi.interpretation.hasOwnProperty(ik)) continue;
                            if (ik === "alphaMode" || ik === "premulColor" || ik === "invertAlpha" || ik === "conformFrameRate") continue;
                            interp[ik] = fi.interpretation[ik];
                        }
                    }
                    if (interp) AE.applyFootageInterpretation(made.mainSource, interp, warn, what);
                    footageBindings.push({ item: made, spec: fi });
                    // A sequence must come back with the frame count it was exported with.
                    if (fi.sequence && fi.sourceKind === "file" && typeof fi.sequence.end === "number") {
                        var want = fi.sequence.end - fi.sequence.start + 1;
                        var have = AE.sourceFrameCount(made);
                        if (have !== want) warn(what + ": sequence has " + have + " frames, exported with " + want);
                    }
                }
            } catch (eF) {
                warn("failed to import " + what + " ('" + fi.file + "'): " + AE.errText(eF));
            }
        } else {
            warn("unsupported sourceKind '" + fi.sourceKind + "' for item '" + fi.name + "'; skipped");
        }
    }
    // Footage-level settings that are not part of the source.
    for (var fb = 0; fb < footageBindings.length; fb++) {
        var fItem0 = footageBindings[fb].item, fSpec = footageBindings[fb].spec;
        try {
            if (typeof fSpec.pixelAspect === "number" && Math.abs(fItem0.pixelAspect - fSpec.pixelAspect) > 1e-6) fItem0.pixelAspect = fSpec.pixelAspect;
        } catch (ePa) { warn("footage '" + fSpec.name + "': pixelAspect not applied: " + AE.errText(ePa)); }
        if (fSpec.proxy) AE.applyProxy(fItem0, fSpec.proxy, warn, "footage '" + fSpec.name + "'");
    }

    // --- Pass 3: comps ---
    var compBindings = []; // { compItem, spec } - for pass 4 layer population
    for (i = 0; i < items.length; i++) {
        var ci = items[i];
        if (ci.type !== "CompItem") continue;
        var comp = proj.items.addComp(
            ci.name,
            Math.max(4, ci.width | 0),
            Math.max(4, ci.height | 0),
            ci.pixelAspect || 1,
            Math.max(1 / 60, ci.duration),
            ci.frameRate || 30
        );
        // Apply comp-level props
        try { if (ci.bgColor) comp.bgColor = ci.bgColor; } catch (e1) {}
        try { if (ci.workAreaStart !== undefined) comp.workAreaStart = ci.workAreaStart; } catch (e2) {}
        try { if (ci.workAreaDuration !== undefined) comp.workAreaDuration = ci.workAreaDuration; } catch (e3) {}
        try { if (ci.shutterAngle !== undefined) comp.shutterAngle = ci.shutterAngle; } catch (e4) {}
        try { if (ci.shutterPhase !== undefined) comp.shutterPhase = ci.shutterPhase; } catch (e5) {}
        try { if (ci.motionBlur !== undefined) comp.motionBlur = ci.motionBlur; } catch (e6) {}
        try { if (ci.displayStartTime !== undefined) comp.displayStartTime = ci.displayStartTime; } catch (e7) {}
        try { if (ci.comment) comp.comment = ci.comment; } catch (e8) {}
        if (ci.attrs) AE.applyAttrs(comp, ci.attrs, AE.COMP_ATTRS);
        // Comp markers
        try {
            if (ci.markers) AE.applyPropertyValue(comp.markerProperty, ci.markers);
        } catch (eCm) { warn("comp markers restore failed for '" + ci.name + "': " + AE.errText(eCm)); }
        if (ci.proxy) AE.applyProxy(comp, ci.proxy, warn, "comp '" + ci.name + "'");
        remap[String(ci.id)] = comp;
        compBindings.push({ comp: comp, spec: ci });
    }

    // --- Pass 4: layers inside comps ---
    // Folders that exist before layer creation: addSolid/addNull drop their
    // sources into an auto-made Solids folder, which ends up empty once
    // pass 5 moves items into the document's own folders.
    var preexistingFolders = {};
    for (var pf = 1; pf <= proj.numItems; pf++) {
        if (proj.item(pf) instanceof FolderItem) preexistingFolders[String(proj.item(pf).id)] = true;
    }
    var deferredAll = [];   // { layer, name, comp, list } - hidden-at-the-time writes, retried later
    var nullSourceIds = {}; // sources of null layers, recreated with addNull instead
    var nullRebuilt = [];   // { source: new null source, specSourceId } - refiled in pass 7
    var itemSpecById = {};
    for (var isx = 0; isx < items.length; isx++) itemSpecById[String(items[isx].id)] = items[isx];
    for (var cb = 0; cb < compBindings.length; cb++) {
        var binding = compBindings[cb];
        var compDst = binding.comp;
        var spec = binding.spec;
        // Spec index -> created layer. Skipped layers leave a hole instead
        // of shifting every later index (parenting/matte misattribution).
        binding.byIndex = {};
        if (!spec.layers) continue;
        // Layers were exported in top-to-bottom order (index 1 = top).
        // AE's Layers#add inserts new layers at the top, pushing existing ones
        // down. Adding in *reverse* order produces the original stacking.
        for (var lj = spec.layers.length - 1; lj >= 0; lj--) {
            var lspec = spec.layers[lj];
            var newLayer = null;
            try {
                if (lspec.type === "TextLayer") {
                    newLayer = compDst.layers.addText(lspec.text || "");
                } else if (lspec.type === "ShapeLayer") {
                    newLayer = compDst.layers.addShape();
                } else if (lspec.type === "CameraLayer") {
                    newLayer = compDst.layers.addCamera(lspec.name || "Camera", [compDst.width / 2, compDst.height / 2]);
                } else if (lspec.type === "LightLayer") {
                    newLayer = compDst.layers.addLight(lspec.name || "Light", [compDst.width / 2, compDst.height / 2]);
                    // Light type decides which Light Options exist, so it goes first.
                    try { if (lspec.attrs && lspec.attrs.lightType !== undefined) newLayer.lightType = lspec.attrs.lightType; } catch (eLt) {}
                } else if (lspec.type === "ParametricMeshLayer") {
                    // Mesh type first: it decides which option groups are live.
                    var mtName = (lspec.attrs && lspec.attrs.parametricMeshType) || lspec.meshType || "cube";
                    var mtEnum = AE.meshTypeEnum(mtName);
                    if (typeof compDst.layers.addParametricMesh !== "function" || mtEnum === undefined) {
                        warn("parametric mesh '" + lspec.name + "' (" + mtName + ") needs AE 26.3+; skipped");
                        continue;
                    }
                    newLayer = compDst.layers.addParametricMesh(lspec.name || "Mesh", mtEnum);
                } else if (lspec.attrs && lspec.attrs.nullLayer) {
                    // nullLayer is read-only: a layer added from the null's solid
                    // source would come back as a visible solid.
                    newLayer = compDst.layers.addNull();
                    if (lspec.sourceId != null) {
                        nullSourceIds[String(lspec.sourceId)] = true;
                        nullRebuilt.push({ source: newLayer.source, specSourceId: String(lspec.sourceId) });
                    }
                } else {
                    // AVLayer: must have a source
                    if (lspec.sourceId != null) {
                        var src = remap[String(lspec.sourceId)];
                        if (!src) {
                            warn("layer '" + lspec.name + "' in comp '" + spec.name + "' references missing source id " + lspec.sourceId);
                            continue;
                        }
                        newLayer = compDst.layers.add(src);
                    } else {
                        warn((lspec.type || "AVLayer") + " '" + lspec.name + "' has no sourceId (exported by a kumo older than schema v5?); skipped");
                        continue;
                    }
                }
                if (!newLayer) continue;
                binding.byIndex[lspec.index] = newLayer;
                // Writes refused because the property is hidden right now (its
                // visibility depends on values or layers applied later: falloff
                // type, light source, 3D switch). Retried after the layer, and
                // again after pass 6.
                var deferred = [];
                deferredAll.push({ layer: newLayer, name: lspec.name, comp: spec.name, list: deferred });
                if (lspec.name) newLayer.name = lspec.name;
                // enabled/solo/locked are applied in the final pass: a locked
                // layer refuses every later write, and solo throws on a
                // disabled layer (e.g. a track matte).
                if (lspec.shy !== undefined) newLayer.shy = lspec.shy;
                if (lspec.label !== undefined) newLayer.label = lspec.label;
                // Stretch first: it rescales in/out around the start time, so
                // setting it after them moved the out point (80% stretch on a
                // 3D model clip: 23.5 s came back as 18.7 s).
                if (lspec.stretch !== undefined && lspec.stretch !== 100) {
                    try { newLayer.stretch = lspec.stretch; } catch (eSt) {}
                }
                if (lspec.startTime !== undefined) newLayer.startTime = lspec.startTime;
                if (lspec.inPoint !== undefined) newLayer.inPoint = lspec.inPoint;
                if (lspec.outPoint !== undefined) newLayer.outPoint = lspec.outPoint;
                // The 3D switch before attrs and every property tree: Geometry
                // and Material Options of text/shape layers only accept values
                // once the layer is 3D (they are hidden on a 2D layer).
                if (lspec.threeDLayer !== undefined && lspec.threeDLayer !== null && AE.isAVLayer(newLayer)) {
                    try { if (newLayer.threeDLayer !== lspec.threeDLayer) newLayer.threeDLayer = lspec.threeDLayer; } catch (e3d) { warn("3D switch not applied on '" + lspec.name + "': " + AE.errText(e3d)); }
                }
                // Switches (blend, adjustment, quality, motion blur, 3D per char...)
                // before the property trees: threeDPerChar changes what the
                // Text group holds.
                if (lspec.attrs) AE.applyLayerAttrs(newLayer, lspec.attrs);
                // Apply transform properties
                if (lspec.transformGroup) {
                    AE.applyPropertyGroup(newLayer.property("Transform"), lspec.transformGroup, warn, deferred);
                }
                // Apply effects (create each effect by matchName, then fill values)
                if (lspec.effectsGroup && lspec.effectsGroup.groups) {
                    var fxRoot = newLayer.property("Effects");
                    for (var ei = 0; ei < lspec.effectsGroup.groups.length; ei++) {
                        var effSpec = lspec.effectsGroup.groups[ei];
                        try {
                            var addedEffect = fxRoot.addProperty(effSpec.matchName);
                            if (effSpec.name) addedEffect.name = effSpec.name;
                            AE.applyPropertyGroup(addedEffect, effSpec, warn);
                        } catch (eEff) {
                            warn("could not add effect " + effSpec.matchName + " on layer '" + lspec.name + "': " + AE.errText(eEff));
                        }
                    }
                }
                // Apply masks
                if (lspec.masksGroup && lspec.masksGroup.groups) {
                    var maskRoot = newLayer.property("Masks");
                    for (var mi = 0; mi < lspec.masksGroup.groups.length; mi++) {
                        var mSpec = lspec.masksGroup.groups[mi];
                        try {
                            var addedMask = maskRoot.addProperty("ADBE Mask Atom");
                            if (mSpec.name) addedMask.name = mSpec.name;
                            AE.applyPropertyGroup(addedMask, mSpec, warn);
                        } catch (eMsk) {
                            warn("could not add mask '" + mSpec.name + "' on layer '" + lspec.name + "': " + AE.errText(eMsk));
                        }
                    }
                }
                // Apply text source document / styling
                if (lspec.textGroup && newLayer instanceof TextLayer) {
                    AE.applyPropertyGroup(newLayer.property("Text"), lspec.textGroup, warn, deferred);
                }
                // Shape layer contents - recursively recreate shape groups
                if (lspec.contentsGroup && newLayer instanceof ShapeLayer) {
                    try {
                        var contentsRoot = newLayer.property("Contents");
                        AE.importShapeContents(contentsRoot, lspec.contentsGroup, warn);
                    } catch (eShape) {
                        warn("shape contents import failed for '" + lspec.name + "': " + AE.errText(eShape));
                    }
                }
                // Time Remap - must be enabled BEFORE applying keyframes
                if (lspec.timeRemapEnabled && AE.isAVLayer(newLayer)) {
                    try {
                        newLayer.timeRemapEnabled = true;
                        if (lspec.timeRemapProperty) {
                            AE.applyPropertyValue(newLayer.property("Time Remap"), lspec.timeRemapProperty);
                        }
                    } catch (eTr) {
                        warn("time remap restore failed for '" + lspec.name + "': " + AE.errText(eTr));
                    }
                }
                // Material Options (3D layers)
                if (lspec.materialOptionsGroup && AE.isAVLayer(newLayer) && newLayer.threeDLayer) {
                    try {
                        AE.applyPropertyGroup(newLayer.property("ADBE Material Options Group"), lspec.materialOptionsGroup, warn, deferred);
                    } catch (eMat) { warn("Material Options restore failed for '" + lspec.name + "': " + AE.errText(eMat)); }
                }
                // Audio
                if (lspec.audioGroup && AE.isAVLayer(newLayer)) {
                    try {
                        AE.applyPropertyGroup(newLayer.property("Audio"), lspec.audioGroup, warn, deferred);
                    } catch (eAud) { /* ignore */ }
                }
                // Layer markers
                if (lspec.markers) {
                    try {
                        AE.applyPropertyValue(newLayer.property("Marker"), lspec.markers);
                    } catch (eLm) { warn("layer markers failed for '" + lspec.name + "': " + AE.errText(eLm)); }
                }
                // Camera/Light Options, 3D geometry, Layer Styles
                if (lspec.extraGroups) {
                    for (var xg = 0; xg < lspec.extraGroups.length; xg++) {
                        var xs = lspec.extraGroups[xg];
                        try {
                            var xt = newLayer.property(xs.matchName);
                            if (xt && xs.matchName === "ADBE Layer Styles") AE.ensureLayerStyles(newLayer, xs, warn);
                            if (xt) AE.applyPropertyGroup(xt, xs, warn, deferred);
                            else warn("layer '" + lspec.name + "' has no " + xs.matchName + " group; skipped");
                        } catch (eXg) { warn(xs.matchName + " restore failed for '" + lspec.name + "': " + AE.errText(eXg)); }
                    }
                }
                AE.retryDeferred(deferred);
            } catch (eLayer) {
                warn("failed to create layer '" + (lspec.name || "?") + "' in comp '" + spec.name + "': " + AE.errText(eLayer));
            }
        }
    }

    // --- Pass 5: parentFolder assignment (items) ---
    for (i = 0; i < items.length; i++) {
        var spc = items[i];
        if (spc.parentFolderId == null) continue;
        var tgt = remap[String(spc.id)];
        var par = remap[String(spc.parentFolderId)];
        if (tgt && par && par instanceof FolderItem) {
            try { tgt.parentFolder = par; } catch (ePF) { warn("failed to set parentFolder on '" + spc.name + "': " + AE.errText(ePF)); }
        }
    }

    // Item label and comment, for every kind of item.
    for (i = 0; i < items.length; i++) {
        var lspc = items[i];
        var ltgt = remap[String(lspc.id)];
        if (!ltgt) continue;
        try { if (typeof lspc.label === "number" && ltgt.label !== lspc.label) ltgt.label = lspc.label; } catch (eLb) {}
        try { if (typeof lspc.comment === "string" && ltgt.comment !== lspc.comment) ltgt.comment = lspc.comment; } catch (eCo) {}
    }

    // --- Pass 6: parenting, track mattes, then the deferred layer switches ---
    for (cb = 0; cb < compBindings.length; cb++) {
        var b2 = compBindings[cb];
        var spec2 = b2.spec;
        if (!spec2.layers) continue;
        var byIdx = b2.byIndex || {};
        var lk, ls, child;
        for (lk = 0; lk < spec2.layers.length; lk++) {
            ls = spec2.layers[lk];
            if (ls.parentIndex == null) continue;
            try {
                child = byIdx[ls.index];
                var parent = byIdx[ls.parentIndex];
                // Exported transform values are already in parent space; plain
                // `child.parent =` would re-compensate them and move the layer.
                if (child && parent) child.setParentWithJump(parent);
                else warn("parent of layer index " + ls.index + " in comp '" + spec2.name + "' was not created");
            } catch (eP) {
                warn("failed to set parent for layer index " + ls.index + " in comp '" + spec2.name + "': " + AE.errText(eP));
            }
        }
        for (lk = 0; lk < spec2.layers.length; lk++) {
            ls = spec2.layers[lk];
            var a = ls.attrs;
            if (!a || a.trackMatteType === undefined || a.trackMatteType === TrackMatteType.NO_TRACK_MATTE) continue;
            child = byIdx[ls.index];
            if (!child) continue;
            try {
                var matte = (a.trackMatteLayerIndex != null) ? byIdx[a.trackMatteLayerIndex] : null;
                if (matte && typeof child.setTrackMatte === "function") child.setTrackMatte(matte, a.trackMatteType);
                else child.trackMatteType = a.trackMatteType; // pre-23: matte is the layer above
            } catch (eTm) {
                warn("track matte restore failed for '" + ls.name + "': " + AE.errText(eTm));
            }
        }
        // Environment light sources: every layer of the comp exists now.
        for (lk = 0; lk < spec2.layers.length; lk++) {
            ls = spec2.layers[lk];
            if (!ls.attrs || ls.attrs.lightSourceIndex == null) continue;
            child = byIdx[ls.index];
            var srcLayer = byIdx[ls.attrs.lightSourceIndex];
            if (!child) continue;
            if (!srcLayer) { warn("light source of '" + ls.name + "' (layer " + ls.attrs.lightSourceIndex + ") was not created"); continue; }
            try { child.lightSource = srcLayer; }
            catch (eLs) { warn("light source restore failed for '" + ls.name + "': " + AE.errText(eLs)); }
        }
        for (lk = 0; lk < spec2.layers.length; lk++) {
            ls = spec2.layers[lk];
            child = byIdx[ls.index];
            if (!child) continue;
            try { if (ls.enabled !== undefined && child.enabled !== ls.enabled) child.enabled = ls.enabled; } catch (eEn) { warn("enabled restore failed for '" + ls.name + "': " + AE.errText(eEn)); }
            try { if (ls.solo === true) child.solo = true; } catch (eSo) { warn("solo restore failed for '" + ls.name + "': " + AE.errText(eSo)); }
            try { if (ls.locked === true) child.locked = true; } catch (eLk) {}
        }
    }

    // Hidden-at-the-time writes, now that light sources, mattes and parents
    // are in place. What is still hidden only matters when its value differs
    // from what the layer holds (a hidden default is not data).
    for (var da = 0; da < deferredAll.length; da++) {
        var dEntry = deferredAll[da];
        AE.retryDeferred(dEntry.list);
        for (var dq = 0; dq < dEntry.list.length; dq++) {
            var dItem = dEntry.list[dq];
            if (!AE._specMatchesProp(dItem.prop, dItem.pspec)) {
                warn("'" + dItem.pspec.matchName + "' on layer '" + dEntry.name + "' in comp '" + dEntry.comp + "' is hidden there; exported value " + AE._jsonText(dItem.pspec.value) + " not restored (current " + AE._jsonText(AE.safeGet(function () { return AE.valueToJson(dItem.prop.value); }, null)) + ")");
            }
        }
    }

    // --- Pass 7: tidy up what layer creation made on the side ---
    // Null layers were rebuilt with addNull, so their exported solid sources
    // are unused; addSolid/addNull also leave an empty auto "Solids" folder.
    for (var nk in nullSourceIds) {
        if (!nullSourceIds.hasOwnProperty(nk)) continue;
        var ns = remap[nk];
        try { if (ns && ns.usedIn.length === 0) { ns.remove(); remap[nk] = null; } } catch (eNs) {}
    }
    // File each addNull source where the exported null source lived, under its name.
    for (var nr = 0; nr < nullRebuilt.length; nr++) {
        var nsSpec = itemSpecById[nullRebuilt[nr].specSourceId];
        var nsItem = nullRebuilt[nr].source;
        if (!nsSpec || !nsItem) continue;
        try { if (nsSpec.name && nsItem.name !== nsSpec.name) nsItem.name = nsSpec.name; } catch (eNn) {}
        try {
            var nsFolder = (nsSpec.parentFolderId != null) ? remap[String(nsSpec.parentFolderId)] : null;
            if (nsFolder instanceof FolderItem) nsItem.parentFolder = nsFolder;
            else if (nsSpec.parentFolderId === 0 || nsSpec.parentFolderId === proj.rootFolder.id) nsItem.parentFolder = proj.rootFolder;
        } catch (eNf) {}
    }
    var keptFolderIds = {};
    for (var rk in remap) {
        if (remap.hasOwnProperty(rk) && remap[rk] instanceof FolderItem) keptFolderIds[String(remap[rk].id)] = true;
    }
    for (var fx = proj.numItems; fx >= 1; fx--) {
        var fItem = proj.item(fx);
        if (!(fItem instanceof FolderItem)) continue;
        var fid = String(fItem.id);
        if (fItem.numItems === 0 && !preexistingFolders[fid] && !keptFolderIds[fid]) {
            try { fItem.remove(); } catch (eFr) {}
        }
    }

    // Build a remap summary that's safe to serialize (just ids, not Item refs)
    var remapOut = {};
    for (var k in remap) {
        if (remap.hasOwnProperty(k) && remap[k]) {
            remapOut[k] = remap[k].id;
        }
    }

    return {
        ok: true,
        itemCount: items.length,
        createdCount: (function () {
            var n = 0;
            for (var kk in remap) { if (remap.hasOwnProperty(kk) && remap[kk]) n++; }
            return n;
        })(),
        remap: remapOut,
        warnings: warnings,
        logs: logs
    };
};

// Recreate the Contents of a Shape layer. Unlike Effects (which use addProperty
// with an effect matchName directly on the Effects group), shape contents use
// a fixed set of matchNames like "ADBE Vector Group", "ADBE Vector Shape - Rect",
// "ADBE Vector Graphic - Stroke", etc. We walk the exported group spec and
// recursively addProperty for each sub-group on the target.
AE.importShapeContents = function (target, spec, warn) {
    if (!target || !spec) return;
    // Leaf properties directly on this group
    if (spec.properties) {
        for (var pi = 0; pi < spec.properties.length; pi++) {
            var ps = spec.properties[pi];
            var prop = null;
            try { prop = target.property(ps.matchName); } catch (e1) {}
            if (!prop) { try { prop = target.property(ps.name); } catch (e2) {} }
            // Stroke > Dashes lists its Dash/Gap/Offset slots from the start but
            // hides them (setValue throws) until addProperty; export lists only
            // the added ones, so add each before writing it.
            if (target.matchName === "ADBE Vector Stroke Dashes" && (!prop || AE._isPlaceholder(target, prop))) {
                prop = AE._addChild(target, ps.matchName) || prop;
            }
            if (!prop) continue;
            try { AE.applyPropertyValue(prop, ps); } catch (eAp) { if (warn) warn("shape property '" + ps.name + "': " + AE.errText(eAp)); }
        }
    }
    // Sub-groups: add them via addProperty with matchName, then recurse.
    // Contents / "ADBE Vectors Group" are indexed: siblings often share a
    // matchName (two Vector Groups, two Fills), so match by position there;
    // a matchName lookup would return the first sibling every time.
    var indexed = false;
    try { indexed = (target.propertyType === PropertyType.INDEXED_GROUP); } catch (eIx) {}
    if (spec.groups) {
        for (var gi = 0; gi < spec.groups.length; gi++) {
            var gs = spec.groups[gi];
            // Try to find an existing subgroup (shapes pre-populate certain
            // groups like "Transform" on Vector Groups). If missing, addProperty.
            var sub = null;
            if (indexed) {
                try {
                    if (gi + 1 <= target.numProperties) {
                        var cand = target.property(gi + 1);
                        if (cand && cand.matchName === gs.matchName) sub = cand;
                    }
                } catch (eSubI) {}
            } else {
                try { sub = target.property(gs.matchName); } catch (eSub1) {}
            }
            if (!sub) {
                try { sub = target.addProperty(gs.matchName); } catch (eAdd) {
                    if (warn) warn("could not add shape group " + gs.matchName + ": " + AE.errText(eAdd));
                    continue;
                }
            }
            if (sub) {
                if (gs.name && sub.name !== gs.name) { try { sub.name = gs.name; } catch (eNm) {} }
                AE.importShapeContents(sub, gs, warn);
                if (gs.enabled !== undefined) { try { if (sub.canSetEnabled && sub.enabled !== gs.enabled) sub.enabled = gs.enabled; } catch (eEn) {} }
            }
        }
    }
};

// Apply a serialized PropertyGroup (from helpers.serializePropertyGroup) onto
// a live PropertyGroup. Children are matched by matchName (falling back to
// name) in named groups and by position in indexed groups (text animators,
// selectors, layer styles), and created with addProperty when the target
// does not have them yet: text animators and their properties, range
// selectors, layer styles. Effects, masks and shape contents are created by
// their own import passes before this runs.
AE.applyPropertyGroup = function (target, spec, warn, deferred) {
    if (!target || !spec) return;
    // Mask attributes first: rotoBezier changes how the path is read.
    if (spec.mask) AE.applyMaskAttrs(target, spec.mask);
    var indexed = false;
    try { indexed = (target.propertyType === PropertyType.INDEXED_GROUP); } catch (eIx) {}
    // Leaf properties
    if (spec.properties) {
        for (var i = 0; i < spec.properties.length; i++) {
            var pspec = spec.properties[i];
            if (pspec.unscriptable) {
                if (warn) warn("'" + pspec.matchName + "' (" + target.matchName + ") holds data scripting cannot read or set; keep an .ffx/.aep for it");
                continue;
            }
            var prop = null;
            try { prop = target.property(pspec.matchName); } catch (e1) {}
            if (!prop) {
                try { prop = target.property(pspec.name); } catch (e2) {}
            }
            if (!prop) prop = AE._addChild(target, pspec.matchName);
            else if (AE._isPlaceholder(target, prop)) prop = AE._addChild(target, pspec.matchName) || prop;
            if (!prop) {
                // Some properties (like Separate Dimensions placeholders) may not exist on all layer types
                continue;
            }
            try { AE.applyPropertyValue(prop, pspec, deferred); }
            catch (eAp) { if (warn) warn("failed to apply property '" + pspec.name + "': " + AE.errText(eAp)); }
        }
    }
    if (spec.groups) {
        for (var g = 0; g < spec.groups.length; g++) {
            var gspec = spec.groups[g];
            var sub = null;
            if (indexed) {
                try {
                    if (g + 1 <= target.numProperties) {
                        var cand = target.property(g + 1);
                        if (cand && cand.matchName === gspec.matchName) sub = cand;
                    }
                } catch (e3) {}
            } else {
                try { sub = target.property(gspec.matchName); } catch (e4) {}
                if (!sub) { try { sub = target.property(gspec.name); } catch (e5) {} }
            }
            if (!sub) sub = AE._addChild(target, gspec.matchName);
            if (!sub) {
                if (warn && indexed) warn("could not add " + gspec.matchName + " to " + target.matchName);
                continue;
            }
            if (indexed && gspec.name && sub.name !== gspec.name) { try { sub.name = gspec.name; } catch (eNm) {} }
            AE.applyPropertyGroup(sub, gspec, warn, deferred);
        }
    }
    // The eyeball last, so values above are written while it is on.
    if (spec.enabled !== undefined) {
        try { if (target.canSetEnabled && target.enabled !== spec.enabled) target.enabled = spec.enabled; } catch (eEn) {}
    }
    if (spec.mask && spec.mask.locked) { try { target.locked = true; } catch (eLk) {} }
};

// Add the layer styles a spec lists but the layer lacks. Styles have no
// addProperty route; the Layer > Layer Styles commands act on the selected
// layer in the active comp, so select it alone, run them, restore selection.
AE.ensureLayerStyles = function (layer, spec, warn) {
    var styles = layer.property("ADBE Layer Styles");
    var cmds = [];
    for (var i = 0; i < (spec.groups || []).length; i++) {
        var mn = spec.groups[i].matchName;
        var id = AE.LAYER_STYLE_COMMANDS[mn];
        if (!id) continue;
        var g = null;
        try { g = styles.property(mn); } catch (eG) {}
        if (g && !g.canSetEnabled) cmds.push(id);
        else if (!g && warn) warn("layer style " + mn + " not found on '" + layer.name + "'");
    }
    if (cmds.length === 0) return;
    var comp = layer.containingComp;
    var prevSel = [];
    try { for (var s = 0; s < comp.selectedLayers.length; s++) prevSel.push(comp.selectedLayers[s]); } catch (eS) {}
    try {
        comp.openInViewer();
        for (var d = 0; d < prevSel.length; d++) { try { prevSel[d].selected = false; } catch (eD) {} }
        layer.selected = true;
        for (var c = 0; c < cmds.length; c++) app.executeCommand(cmds[c]);
    } catch (eC) {
        if (warn) warn("adding layer styles to '" + layer.name + "' failed: " + AE.errText(eC));
    }
    try { layer.selected = false; } catch (eU) {}
    for (var r = 0; r < prevSel.length; r++) { try { prevSel[r].selected = true; } catch (eR) {} }
    // The commands do nothing (no error) when AE is not the foreground window.
    for (var v = 0; v < (spec.groups || []).length; v++) {
        var vm = spec.groups[v].matchName;
        if (!AE.LAYER_STYLE_COMMANDS[vm]) continue;
        var vg = null;
        try { vg = styles.property(vm); } catch (eV) {}
        if (vg && !vg.canSetEnabled && warn) {
            warn("layer style " + vm + " was not added to '" + layer.name + "': Layer Styles commands only run while After Effects is the foreground window");
        }
    }
};

/**
 * Groups that take addProperty (text animator Properties) list members that
 * were never added; those reject expressions and ignore setValue until added.
 */
AE._isPlaceholder = function (target, prop) {
    try { return prop.canSetExpression === false && target.canAddProperty(prop.matchName); } catch (e) { return false; }
};

/** addProperty(matchName) when the group accepts it; null otherwise. */
AE._addChild = function (target, matchName) {
    try { if (matchName && target.canAddProperty && target.canAddProperty(matchName)) return target.addProperty(matchName); } catch (e) {}
    return null;
};

AE.applyMaskAttrs = function (mask, m) {
    if (!m) return;
    try { if (m.rotoBezier !== undefined) mask.rotoBezier = m.rotoBezier; } catch (e1) {}
    try { if (m.mode !== undefined) mask.maskMode = m.mode; } catch (e2) {}
    try { if (m.inverted !== undefined) mask.inverted = m.inverted; } catch (e3) {}
    try { if (m.motionBlur !== undefined) mask.maskMotionBlur = m.motionBlur; } catch (e4) {}
    try { if (m.featherFalloff !== undefined) mask.maskFeatherFalloff = m.featherFalloff; } catch (e5) {}
    try { if (m.color) mask.color = m.color; } catch (e6) {}
};

/** Write each listed attribute present in attrs; unsupported ones are skipped. */
AE.applyAttrs = function (obj, attrs, names) {
    for (var i = 0; i < names.length; i++) {
        var n = names[i];
        if (attrs[n] === undefined || attrs[n] === null) continue;
        try { if (obj[n] !== attrs[n]) obj[n] = attrs[n]; } catch (e) { /* read-only here / other layer class */ }
    }
};

AE.applyLayerAttrs = function (layer, attrs) {
    AE.applyAttrs(layer, attrs, AE.LAYER_ATTRS);
    if (AE.isAVLayer(layer)) {
        // trackMatteType is applied with the matte layer in pass 6.
        var names = [];
        for (var i = 0; i < AE.AVLAYER_ATTRS.length; i++) if (AE.AVLAYER_ATTRS[i] !== "trackMatteType") names.push(AE.AVLAYER_ATTRS[i]);
        AE.applyAttrs(layer, attrs, names);
    }
    if (layer instanceof TextLayer && attrs.threeDPerChar !== undefined) {
        try { layer.threeDPerChar = attrs.threeDPerChar; } catch (e3c) {}
    }
};

// Convert a serialized value (possibly a __kind tagged object) back to a
// native ExtendScript value suitable for prop.setValue / keyframe apply.
AE.unwrapValue = function (val, existingTemplate) {
    if (val === null || val === undefined) return val;
    if (val.__kind === "TextDocument") {
        // Mutate an existing TextDocument (required because AE rejects
        // vanilla constructed documents in some cases).
        var tmpl = existingTemplate || null;
        if (!tmpl) tmpl = new TextDocument(val.text || "");
        if (val.text !== undefined) { try { tmpl.text = val.text; } catch (e) {} }
        if (val.font) { try { tmpl.font = val.font; } catch (e) {} }
        if (val.fontSize) { try { tmpl.fontSize = val.fontSize; } catch (e) {} }
        if (val.fillColor) { try { tmpl.fillColor = val.fillColor; } catch (e) {} }
        if (val.strokeColor) { try { tmpl.strokeColor = val.strokeColor; } catch (e) {} }
        if (val.strokeWidth !== undefined) { try { tmpl.strokeWidth = val.strokeWidth; } catch (e) {} }
        if (val.tracking !== undefined) { try { tmpl.tracking = val.tracking; } catch (e) {} }
        if (val.leading !== undefined) { try { tmpl.leading = val.leading; } catch (e) {} }
        if (val.baselineShift !== undefined) { try { tmpl.baselineShift = val.baselineShift; } catch (e) {} }
        if (val.applyFill !== undefined) { try { tmpl.applyFill = val.applyFill; } catch (e) {} }
        if (val.applyStroke !== undefined) { try { tmpl.applyStroke = val.applyStroke; } catch (e) {} }
        if (val.justification !== undefined && val.justification !== null) {
            var jv = (typeof val.justification === "string") ? Number(val.justification) : val.justification;
            if (!isNaN(jv)) { try { tmpl.justification = jv; } catch (e) {} }
        }
        for (var ta = 0; ta < AE.TEXT_DOC_ATTRS.length; ta++) {
            var tn = AE.TEXT_DOC_ATTRS[ta];
            if (val[tn] === undefined || val[tn] === null) continue;
            try { if (tmpl[tn] !== val[tn]) tmpl[tn] = val[tn]; } catch (e) { /* not settable on this AE / text type */ }
        }
        // autoLeading=true above recomputes leading; an explicit value wins only when it is off.
        if (val.autoLeading === false && val.leading !== undefined) { try { tmpl.leading = val.leading; } catch (e) {} }
        // Box text restoration only applies if we have size data
        if (val.boxText && val.boxTextSize) {
            try { tmpl.boxTextSize = val.boxTextSize; } catch (e) {}
            if (val.boxTextPos) { try { tmpl.boxTextPos = val.boxTextPos; } catch (e) {} }
        }
        return tmpl;
    }
    if (val.__kind === "Shape") {
        var sh = new Shape();
        sh.closed = !!val.closed;
        if (val.vertices) sh.vertices = val.vertices;
        if (val.inTangents) sh.inTangents = val.inTangents;
        if (val.outTangents) sh.outTangents = val.outTangents;
        return sh;
    }
    if (val.__kind === "MarkerValue") {
        var mv = new MarkerValue(val.comment || "");
        if (val.chapter) { try { mv.chapter = val.chapter; } catch (e) {} }
        if (val.url) { try { mv.url = val.url; } catch (e) {} }
        if (val.frameTarget) { try { mv.frameTarget = val.frameTarget; } catch (e) {} }
        if (val.cuePointName) { try { mv.cuePointName = val.cuePointName; } catch (e) {} }
        if (val.duration !== undefined) { try { mv.duration = val.duration; } catch (e) {} }
        if (val.label !== undefined) { try { mv.label = val.label; } catch (e) {} }
        if (val.protectedRegion !== undefined) { try { mv.protectedRegion = val.protectedRegion; } catch (e) {} }
        return mv;
    }
    return val;
};

AE.applyPropertyValue = function (prop, pspec, deferred) {
    // Separated Position: switch it on and let the X/Y/Z followers (which
    // come next in the same group) carry the values and keys.
    if (pspec.dimensionsSeparated) {
        try { prop.dimensionsSeparated = true; } catch (eDs) {}
        return;
    }
    var val = pspec.value;
    if (val !== null && val !== undefined) {
        var unwrapped = AE.unwrapValue(val, (val.__kind === "TextDocument") ? AE.safeGet(function () { return prop.value; }, null) : null);
        if (unwrapped !== null && unwrapped !== undefined && !(pspec.keyframes && pspec.keyframes.length > 0)) {
            // A value the new layer already holds is not written: setValue
            // stores through float32, so re-writing e.g. the 89.9999923018046 deg
            // orientation AE gives an imported GLB would round it and shift
            // geometry edges by a pixel.
            var already = (typeof val === "number" || val instanceof Array) && AE._sameValue(AE.safeGet(function () { return AE.valueToJson(prop.value); }, null), val);
            if (!already) {
                try { prop.setValue(unwrapped); } catch (eSv) {
                    // Hidden right now (depends on a value or layer applied later):
                    // queue for a retry. Other refusals (read-only) are swallowed.
                    if (deferred && AE.isHiddenError(eSv)) { deferred.push({ prop: prop, pspec: pspec }); return; }
                }
            }
        }
    }
    // Keyframes
    if (pspec.keyframes && pspec.keyframes.length > 0) {
        // Existing keys are pruned AFTER the new ones land: removing every
        // key first switches Time Remap off (enabling it creates two keys).
        var times = [];
        var values = [];
        for (var k = 0; k < pspec.keyframes.length; k++) {
            var kf = pspec.keyframes[k];
            var kv = AE.unwrapValue(kf.value, (kf.value && kf.value.__kind === "TextDocument") ? AE.safeGet(function () { return prop.value; }, null) : null);
            times.push(kf.time);
            values.push(kv);
        }
        // Marker-valued keyframes must be set one at a time - setValuesAtTimes
        // doesn't accept MarkerValue arrays.
        var isMarker = (pspec.keyframes[0].value && pspec.keyframes[0].value.__kind === "MarkerValue");
        if (isMarker) {
            for (var km = 0; km < times.length; km++) {
                try { prop.setValueAtTime(times[km], values[km]); } catch (ePm) { /* ignore */ }
            }
        } else {
            try {
                prop.setValuesAtTimes(times, values);
            } catch (eKf) {
                if (deferred && AE.isHiddenError(eKf)) { deferred.push({ prop: prop, pspec: pspec }); return; }
                // Fallback: per-key
                for (var kk = 0; kk < times.length; kk++) {
                    try { prop.setValueAtTime(times[kk], values[kk]); } catch (ePk) {}
                }
            }
        }
        AE._pruneKeysNotAt(prop, times);
        // Apply temporal ease, then interpolation types. Ease FIRST: setting
        // ease flips a key to BEZIER, so a HOLD/LINEAR spec must be re-asserted
        // afterwards (same ordering contract as AE.applyKeys).
        for (var ki = 0; ki < pspec.keyframes.length; ki++) {
            var kfI = pspec.keyframes[ki];
            if (kfI.inEase && kfI.outEase && kfI.inEase.length > 0 && kfI.outEase.length > 0) {
                try {
                    prop.setTemporalEaseAtKey(ki + 1, AE._deserializeEase(kfI.inEase), AE._deserializeEase(kfI.outEase));
                } catch (eEz) { /* dimension mismatch or non-temporal - keep going */ }
            }
            if (kfI.inInterp != null && kfI.outInterp != null) {
                try { prop.setInterpolationTypeAtKey(ki + 1, kfI.inInterp, kfI.outInterp); } catch (eI) {}
            }
        }
        AE._applyKeyExtras(prop, pspec.keyframes);
    }
    // Expression
    if (pspec.expression && prop.canSetExpression) {
        try {
            prop.expression = pspec.expression;
            prop.expressionEnabled = (pspec.expressionEnabled !== false);
        } catch (eEx) {}
    }
};

/**
 * Re-apply writes that were refused as hidden. A write can unhide others
 * (falloff type -> radius), so loop while progress is made. Entries that still
 * fail stay in the list.
 */
AE.retryDeferred = function (list) {
    if (!list || list.length === 0) return;
    for (var round = 0; round < 4 && list.length > 0; round++) {
        var still = [];
        for (var i = 0; i < list.length; i++) {
            var d = list[i];
            var again = [];
            try { AE.applyPropertyValue(d.prop, d.pspec, again); } catch (e) { again.push(d); }
            if (again.length > 0) still.push(d);
        }
        var progressed = still.length < list.length;
        list.length = 0;
        for (var j = 0; j < still.length; j++) list.push(still[j]);
        if (!progressed) break;
    }
};

/** Exact-enough equality for numbers / number arrays (relative 1e-9): "the layer already holds this". */
AE._sameValue = function (a, b) {
    if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
    if (a instanceof Array && b instanceof Array) {
        if (a.length !== b.length) return false;
        for (var i = 0; i < a.length; i++) if (!AE._sameValue(a[i], b[i])) return false;
        return true;
    }
    return false;
};

/** True when a property already holds an exported (un-keyed) value - a hidden write that changes nothing. */
AE._specMatchesProp = function (prop, pspec) {
    if (pspec.keyframes && pspec.keyframes.length > 0) return false;
    var cur = AE.safeGet(function () { return AE.valueToJson(prop.value); }, null);
    var want = pspec.value;
    if (want === null || want === undefined) return true;
    if (typeof want === "object" && !(want instanceof Array)) return true; // TextDocument/Shape: not compared here
    return AE._interpEqual(cur, want);
};

/** Remove keys whose time is not one of `times` (half-frame tolerance at 120fps). */
AE._pruneKeysNotAt = function (prop, times) {
    for (var k = prop.numKeys; k >= 1; k--) {
        var t = prop.keyTime(k), keep = false;
        for (var i = 0; i < times.length; i++) { if (Math.abs(times[i] - t) < 0.004) { keep = true; break; } }
        if (!keep) { try { prop.removeKey(k); } catch (e) {} }
    }
};

// Continuity, auto-bezier, spatial tangents, roving and labels, after values
// and interpolation exist. Spatial order: continuity/auto-bezier, then
// explicit tangents (which switch auto-bezier off), then roving.
AE._applyKeyExtras = function (prop, keyframes) {
    for (var i = 0; i < keyframes.length; i++) {
        var kf = keyframes[i];
        var ki = i + 1;
        if (ki > prop.numKeys) break;
        try { if (kf.temporalContinuous !== undefined || kf.inEase) prop.setTemporalContinuousAtKey(ki, !!kf.temporalContinuous); } catch (e1) {}
        try { if (kf.temporalAutoBezier !== undefined || kf.inEase) prop.setTemporalAutoBezierAtKey(ki, !!kf.temporalAutoBezier); } catch (e2) {}
        var spatial = false;
        try { spatial = prop.isSpatial; } catch (eSp) {}
        if (spatial) {
            var hasSpatialData = (kf.inSpatialTangent !== undefined || kf.spatialAutoBezier !== undefined);
            try { if (hasSpatialData) prop.setSpatialContinuousAtKey(ki, !!kf.spatialContinuous); } catch (e3) {}
            try { if (hasSpatialData) prop.setSpatialAutoBezierAtKey(ki, !!kf.spatialAutoBezier); } catch (e4) {}
            try { if (kf.inSpatialTangent && kf.outSpatialTangent) prop.setSpatialTangentsAtKey(ki, kf.inSpatialTangent, kf.outSpatialTangent); } catch (e5) {}
        }
    }
    // Roving needs its neighbours in place, so it gets its own pass.
    for (var r = 0; r < keyframes.length; r++) {
        try { if (keyframes[r].roving) prop.setRovingAtKey(r + 1, true); } catch (e6) {}
        try { if (keyframes[r].label) prop.setLabelAtKey(r + 1, keyframes[r].label); } catch (e7) {}
    }
};
