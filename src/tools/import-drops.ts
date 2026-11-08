// Import must never lose data silently. jsx/import.jsx reports every property or group that carries a value, keys
// or an expression but could not be found or added as a "DROPPED: ..." warning (e.g. a text-animator property
// written outside its "ADBE Text Animator Properties" group, or a misspelt matchName). This turns those warnings
// into a first-class `dropped` list and a hint, and, with `strict`, into a failure the caller cannot miss.

export interface ImportResultLike {
  ok: boolean;
  result?: unknown;
}

export function droppedFrom(result: ImportResultLike): string[] {
  const r = result.result as { warnings?: unknown } | undefined;
  const w = r && Array.isArray(r.warnings) ? r.warnings : [];
  return w.filter((x): x is string => typeof x === "string" && x.startsWith("DROPPED:"));
}

/** Adds `dropped` + `hint` to a successful import result when anything was dropped. Returns the dropped list. */
export function annotateDrops(result: ImportResultLike): string[] {
  const dropped = droppedFrom(result);
  if (dropped.length && result.result && typeof result.result === "object") {
    const r = result.result as Record<string, unknown>;
    r.dropped = dropped;
    r.hint =
      `${dropped.length} property/group value(s) were NOT imported (listed in \`dropped\`). ` +
      "Text-animator properties belong under group 'ADBE Text Animator Properties' of an 'ADBE Text Animator'; " +
      "check matchNames against an export of a layer built by hand.";
  }
  return dropped;
}
