// Generic property operations — set value, get value, for any property path.

import { readOnlyMode } from "../policy.js";
import {
  registerOp,
  jsxVal,
  jsxCompPreamble,
  jsxCompLayerPreamble,
  jsxPropertyLookup,
} from "../registry.js";

registerOp({
  name: "property.set",
  category: "property",
  description: "Set any layer property by path. layer can be index, name, 'selected', or 'all'.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "layer",
      type: "any",
      description: "Layer index, name, 'selected', or 'all'",
      required: true,
    },
    {
      name: "property",
      type: "array",
      description: 'Property path, e.g. ["Transform","Position"]',
      required: true,
    },
    { name: "value", type: "any", description: "Value to set", required: true },
  ],
  toJsx(args) {
    return `
            ${jsxCompPreamble(args)}
            var _layers = AE.resolveLayers(_comp, ${jsxVal(args.layer)});
            if (_layers.length === 0) return { ok: false, error: "no layers matched" };
            var _propPath = ${jsxVal(args.property)};
            var _value = ${jsxVal(args.value)};
            var _results = [];
            var _failed = 0;
            for (var _li = 0; _li < _layers.length; _li++) {
                var _layer = _layers[_li];
                var _node = _layer;
                var _miss = null;
                for (var _pi = 0; _pi < _propPath.length; _pi++) {
                    var _nx = null;
                    try { _nx = AE.childProperty(_node, _propPath[_pi]); } catch (eNx) {}
                    if (!_nx) { _miss = "property segment '" + _propPath[_pi] + "' not found under '" + (_node.name || _layer.name) + "' (property.list shows what exists)"; break; }
                    _node = _nx;
                }
                if (_miss) { _failed++; _results.push({ name: _layer.name, ok: false, error: _miss }); continue; }
                try {
                    if (_node.propertyType !== PropertyType.PROPERTY) throw new Error("group");
                    // Separated dimensions and __kind values route through
                    // AE.writeValue; setValue on a separated leader throws.
                    var _wr = AE.writeValue(_node, _value);
                    _results.push({ name: _layer.name, ok: true, matchName: _node.matchName, separated: _wr.separated });
                } catch(e) {
                    _failed++;
                    _results.push({ name: _layer.name, ok: false, error: AE.describeSetError(_node, e, _value) });
                }
            }
            var _res = { ok: _failed < _results.length, count: _results.length, failed: _failed, layers: _results };
            if (_failed > 0) {
                var _errs = [];
                for (var _ri = 0; _ri < _results.length; _ri++) if (!_results[_ri].ok) _errs.push(_results[_ri].name + ": " + _results[_ri].error);
                if (_failed === _results.length) _res.error = _errs.join("; ");
                else _res.warning = _errs.join("; ");
            }
            return _res;
        `;
  },
});

registerOp({
  name: "property.get",
  category: "property",
  readOnly: true,
  description: "Get the current value of any layer property by path.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "layer",
      type: "any",
      description: "1-based layer index, or the layer name",
      required: true,
    },
    { name: "property", type: "array", description: "Property path", required: true },
    {
      name: "time",
      type: "number",
      description: "If set, get value at this time (for animated properties)",
      required: false,
    },
  ],
  toJsx(args) {
    return `
            ${jsxCompLayerPreamble(args)}
            var _propPath = ${jsxVal(args.property)};
            ${jsxPropertyLookup()}
            var _val;
            if (${jsxVal(args.time ?? null)} !== null) {
                _val = _node.valueAtTime(${jsxVal(args.time)}, false);
            } else {
                _val = _node.value;
            }
            return {
                ok: true,
                name: _node.name,
                matchName: _node.matchName,
                value: AE.valueToJson(_val),
                numKeys: _node.numKeys || 0,
                hasExpression: _node.canSetExpression ? _node.expressionEnabled : false
            };
        `;
  },
});

registerOp({
  name: "property.list",
  category: "property",
  readOnly: true,
  description:
    "List child properties/groups at a path, with what each accepts. Leaves report valueType, value, range {min,max}, keyed, expression, and settable/hidden: " +
    "hidden:true means AE refuses writes there for this layer type, renderer or current settings (e.g. Material Options on meshes and 3D models, Reflection on A3D text, falloff radius with falloff None) — use the group the layer actually renders with. " +
    "Groups report hidden when their leaves are, and on parametric meshes active:true marks the 'Mesh Options'/'Bevel Options' group of the current mesh type (the other five share the names). " +
    "settable is found by writing each un-keyed value back unchanged; with probe:false (or AE_MCP_READONLY) nothing is written and settable is null.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "layer",
      type: "any",
      description: "1-based layer index, or the layer name",
      required: true,
    },
    {
      name: "property",
      type: "array",
      description: "Property path to a group. Use [] for the layer root.",
      required: true,
    },
    {
      name: "probe",
      type: "boolean",
      description: "Detect settable/hidden by writing current values back unchanged (default true)",
      required: false,
      default: true,
    },
  ],
  toJsx(args) {
    const probe = args.probe !== false && !readOnlyMode();
    return `
            ${jsxCompLayerPreamble(args)}
            var _propPath = ${jsxVal(args.property)};
            ${jsxPropertyLookup()}
            if (!_node.numProperties && _node.propertyType === PropertyType.PROPERTY) return { ok: false, error: "not a property group (leaf property '" + _node.name + "')" };
            var _probe = ${jsxVal(probe)};
            var _isMesh = AE.isMeshLayer(_layer);
            var children = [];
            for (var i = 1; i <= _node.numProperties; i++) {
                var ch = _node.property(i);
                var _isGroup = ch.propertyType !== PropertyType.PROPERTY;
                var _e = {
                    index: i,
                    name: ch.name,
                    matchName: ch.matchName,
                    isGroup: _isGroup,
                    numChildren: ch.numProperties || 0
                };
                if (_isGroup) {
                    if (_isMesh) { var _act = AE.meshGroupActive(_layer, ch.matchName); if (_act !== null) _e.active = _act; }
                    if (ch.matchName === "ADBE Light Env Atom") _e.note = "the environment light's source is a layer attribute: set it with light.set_source";
                    if (_probe && _e.active !== false) {
                        if (AE.groupHidden(ch) === true) _e.hidden = true;
                    } else if (_e.active === false) {
                        _e.hidden = true;
                    }
                } else {
                    _e.valueType = AE.PROPERTY_VALUE_TYPE_NAMES[ch.propertyValueType] || ch.propertyValueType;
                    if (ch.propertyValueType !== PropertyValueType.NO_VALUE && ch.propertyValueType !== PropertyValueType.CUSTOM_VALUE) {
                        var _v = AE.safeGet(function () { return AE.valueToJson(ch.value); }, null);
                        // TextDocuments and shapes are bulky; property.get reads them.
                        if (_v === null || typeof _v !== "object" || _v instanceof Array) _e.value = _v;
                    }
                    var _rng = AE.propertyRange(ch);
                    if (_rng) _e.range = _rng;
                    var _units = AE.safeGet(function () { return ch.unitsText; }, "");
                    if (_units) _e.units = _units;
                    var _nk = AE.safeGet(function () { return ch.numKeys; }, 0);
                    if (_nk > 0) _e.keyed = _nk;
                    if (AE.safeGet(function () { return ch.canSetExpression && ch.expressionEnabled && ch.expression.length > 0; }, false)) _e.expression = true;
                    if (!AE.safeGet(function () { return ch.canVaryOverTime; }, true)) _e.animatable = false;
                    if (_probe) {
                        var _ps = AE.probeSettable(ch);
                        _e.settable = _ps.settable;
                        if (_ps.hidden) _e.hidden = true;
                        if (_ps.reason && !_ps.hidden && _ps.settable === false) _e.why = _ps.reason;
                    } else {
                        _e.settable = null;
                    }
                }
                children.push(_e);
            }
            var _out = { ok: true, path: _propPath, children: children };
            if (_isMesh && _propPath.length === 0) _out.meshType = AE.meshTypeName(_layer);
            return _out;
        `;
  },
});

registerOp({
  name: "property.add",
  category: "property",
  description:
    'Add a property to an indexed group by matchName (PropertyGroup.addProperty). Unlocks text animators (\'ADBE Text Animator\' on ["Text","Animators"]), layer styles, shape contents, etc. Use property.list to discover group paths.',
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "layer",
      type: "any",
      description: "1-based layer index, or the layer name",
      required: true,
    },
    {
      name: "property",
      type: "array",
      description:
        'Path to the group to add into, e.g. ["Text","Animators"]. Use [] for layer root.',
      required: true,
    },
    {
      name: "matchName",
      type: "string",
      description:
        'Match name (or display name) of the property to add, e.g. "ADBE Text Animator". NOTE: adding to an indexed group re-creates it, invalidating prior property references.',
      required: true,
    },
    { name: "name", type: "string", description: "Rename the new property", required: false },
  ],
  toJsx(args) {
    const renameJsx = args.name
      ? `try { _added.name = ${jsxVal(args.name)}; } catch (eName) {}`
      : "";
    return `
            ${jsxCompLayerPreamble(args)}
            var _propPath = ${jsxVal(args.property)};
            ${jsxPropertyLookup()}
            var _mn = ${jsxVal(args.matchName)};
            var _canAdd = false;
            try { _canAdd = _node.canAddProperty(_mn); } catch (eCan) {
                return { ok: false, error: "not a property group that supports addProperty" };
            }
            if (!_canAdd) return { ok: false, error: "group '" + _node.matchName + "' cannot add '" + _mn + "'" };
            var _added = _node.addProperty(_mn);
            ${renameJsx}
            return { ok: true, name: _added.name, matchName: _added.matchName, propertyIndex: _added.propertyIndex };
        `;
  },
});

registerOp({
  name: "property.remove",
  category: "property",
  description:
    "Remove a property or group by path (Property.remove). Works on members of indexed groups: effects, masks, shape contents, text animators, layer styles.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "layer",
      type: "any",
      description: "1-based layer index, or the layer name",
      required: true,
    },
    {
      name: "property",
      type: "array",
      description: "Path to the property to remove",
      required: true,
    },
  ],
  toJsx(args) {
    return `
            ${jsxCompLayerPreamble(args)}
            var _propPath = ${jsxVal(args.property)};
            // An empty path leaves _node === _layer, and Layer.remove() would
            // delete the whole layer. property.add accepts [] for the layer
            // root, so a caller has every reason to try it here too.
            if (!_propPath.length) return { ok: false, error: "property path is empty — that would remove the layer itself, not a property" };
            ${jsxPropertyLookup()}
            var _removedName = _node.name;
            try { _node.remove(); } catch (eRm) {
                return { ok: false, error: "cannot remove '" + _removedName + "': " + AE.errText(eRm) };
            }
            return { ok: true, removed: _removedName };
        `;
  },
});

registerOp({
  name: "property.separate_dimensions",
  category: "property",
  description:
    "Separate (or rejoin) the dimensions of a multi-dimensional property such as Position. When separated, animate the followers (e.g. X Position) individually.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "layer",
      type: "any",
      description: "1-based layer index, or the layer name",
      required: true,
    },
    {
      name: "property",
      type: "array",
      description: "Property path (e.g. Position)",
      required: true,
    },
    {
      name: "separated",
      type: "boolean",
      description: "true=separate, false=rejoin",
      required: true,
    },
  ],
  toJsx(args) {
    return `
            ${jsxCompLayerPreamble(args)}
            var _propPath = ${jsxVal(args.property)};
            ${jsxPropertyLookup()}
            if (!_node.isSeparationLeader) return { ok: false, error: "property cannot separate dimensions" };
            _node.dimensionsSeparated = ${jsxVal(!!args.separated)};
            return { ok: true, dimensionsSeparated: _node.dimensionsSeparated };
        `;
  },
});

registerOp({
  name: "property.move",
  category: "property",
  description:
    "Reorder a property within its parent INDEXED group (PropertyBase.moveTo): masks, shape contents, text animators. For effects use effect.move.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "layer",
      type: "any",
      description: "1-based layer index, or the layer name",
      required: true,
    },
    {
      name: "property",
      type: "array",
      description: "Path to the property to move (a member of an indexed group)",
      required: true,
    },
    {
      name: "toIndex",
      type: "number",
      description: "1-based target position within the parent group",
      required: true,
    },
  ],
  toJsx(args) {
    return `
            ${jsxCompLayerPreamble(args)}
            var _propPath = ${jsxVal(args.property)};
            ${jsxPropertyLookup()}
            var _parent = _node.parentProperty;
            if (!_parent || _parent.propertyType !== PropertyType.INDEXED_GROUP) {
                return { ok: false, error: "property is not a member of an indexed group — only those can be reordered" };
            }
            var _to = ${jsxVal(args.toIndex)};
            if (_to < 1 || _to > _parent.numProperties) return { ok: false, error: "toIndex out of range (1-" + _parent.numProperties + ")" };
            try { _node.moveTo(_to); } catch (eMv) { return { ok: false, error: "moveTo failed: " + AE.errText(eMv) }; }
            var _order = [];
            for (var _i = 1; _i <= _parent.numProperties; _i++) _order.push(_parent.property(_i).name);
            return { ok: true, order: _order };
        `;
  },
});

registerOp({
  name: "property.select",
  category: "property",
  description:
    "Select or deselect a property in the timeline (PropertyBase.selected) - stages it for UI-side actions and makes it visible with the U-shortcut workflow.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "layer",
      type: "any",
      description: "1-based layer index, or the layer name",
      required: true,
    },
    { name: "property", type: "array", description: "Property path", required: true },
    {
      name: "selected",
      type: "boolean",
      description: "true=select, false=deselect (default true)",
      required: false,
      default: true,
    },
  ],
  toJsx(args) {
    return `
            ${jsxCompLayerPreamble(args)}
            var _propPath = ${jsxVal(args.property)};
            ${jsxPropertyLookup()}
            try { _node.selected = ${jsxVal(args.selected !== false)}; } catch (eSl) { return { ok: false, error: "selected set failed: " + AE.errText(eSl) }; }
            return { ok: true, property: _node.name, selected: _node.selected };
        `;
  },
});
