// mcp-aftereffects project export - walks the entire project and produces a JSON
// document describing folders, comps (with full layer/property trees), solid
// footage, and file footage references. ES3-compatible.

AE.EXPORT_SCHEMA_VERSION = 5;
// v1: basic items + layers + transform/effects/masks/text
// v2: shape layer contents, layer/comp markers, time remap, material options, audio, extended text document fields
// v3: layer attrs (blend, matte, adjustment, null, quality, motion blur...), comp attrs, group enabled + mask
//     attrs, disabled expressions, separated dimensions, spatial/continuity key data, camera/light/style groups
// v4: footage interpretation, image sequences with frame range, placeholders, proxies (footage + comps),
//     footage frameRate/pixelAspect, project settings (color management, time display, expressions)
// v5: Advanced 3D - text/shape/model/mesh layers carry threeDLayer, AV switches and Material Options
//     (instanceof AVLayer is false for them on AE 26.5); ThreeDModelLayer sourceId; ParametricMeshLayer
//     type + live mesh/bevel option groups; Material Assignment, Compositing/Displacement Options,
//     model Animation Options; environment light source (attrs.lightSourceIndex)

AE.exportProject = function () {
    var proj = app.project;
    var doc = {
        schemaVersion: AE.EXPORT_SCHEMA_VERSION,
        exportedAt: new Date().toString(),
        aeVersion: app.version,
        project: {
            file: proj.file ? proj.file.fsName.replace(/\\/g, "/") : null,
            bitsPerChannel: proj.bitsPerChannel,
            timeDisplayType: String(proj.timeDisplayType),
            settings: AE._readAttrs(proj, AE.PROJECT_ATTRS, {})
        },
        items: []
    };

    for (var i = 1; i <= proj.numItems; i++) {
        var it = proj.item(i);
        var entry = AE.serializeItemSummary(it);
        if (it instanceof CompItem) {
            entry.workAreaStart = it.workAreaStart;
            entry.workAreaDuration = it.workAreaDuration;
            entry.pixelAspect = it.pixelAspect;
            entry.shutterAngle = it.shutterAngle;
            entry.shutterPhase = it.shutterPhase;
            entry.motionBlur = it.motionBlur;
            entry.displayStartTime = it.displayStartTime;
            entry.attrs = AE.serializeCompAttrs(it);
            entry.layers = [];
            for (var li = 1; li <= it.numLayers; li++) {
                var lay = it.layer(li);
                entry.layers.push(AE.serializeLayerFull(lay, { includeProperties: true }));
            }
            entry.markers = AE.serializeCompMarkers(it);
        }
        if (it instanceof FootageItem) {
            var src = it.mainSource;
            entry.frameRate = it.frameRate;
            entry.pixelAspect = it.pixelAspect;
            entry.hasVideo = it.hasVideo;
            entry.hasAudio = it.hasAudio;
            entry.footageMissing = AE.safeGet(function () { return it.footageMissing; }, false);
            var fs = AE.serializeFootageSource(src, AE.sourceFrameCount(it));
            for (var fk in fs) if (fs.hasOwnProperty(fk)) entry[fk] = fs[fk];
            if (src instanceof SolidSource) {
                entry.sourceWidth = it.width;
                entry.sourceHeight = it.height;
                entry.alphaMode = src.alphaMode;
            }
        }
        if (it instanceof CompItem || it instanceof FootageItem) {
            var px = AE.serializeProxy(it);
            if (px) entry.proxy = px;
        }
        doc.items.push(entry);
    }
    return doc;
};
