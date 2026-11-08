import { promises as fs } from "node:fs";
import * as path from "node:path";
import { z } from "zod";

import { errorResult } from "../errors.js";
import { footagePathHolders, resolveFootagePaths } from "../footage-paths.js";
import { validateAeProjectDoc } from "../validate.js";
import { defineTool, jsonResult, toMcpResult } from "./define-tool.js";
import { withAfterEffectsForeground } from "../transport/dialogs.js";
import { annotateDrops } from "./import-drops.js";

export const projectImportTool = defineTool({
  name: "ae_project_import_json",
  title: "Import project JSON",
  description:
    "Rebuild the project from JSON (produced by ae_project_export_json). " +
    "Supports `clearFirst`, `dryRun` (validate-only, lists missing footage), `skipValidation`, " +
    "and footage relinking via `baseDir` / `pathMap`.",
  group: "document",
  blockedInReadOnly: true,
  effect: "destructive",
  inputShape: {
    inPath: z
      .string()
      .optional()
      .describe(
        "Absolute path to a JSON document produced by ae_project_export_json. Mutually exclusive with `json`.",
      ),
    json: z
      .unknown()
      .optional()
      .describe("Inline JSON document (object, not string). Mutually exclusive with `inPath`."),
    clearFirst: z
      .boolean()
      .optional()
      .describe(
        "Remove all existing items from the current project before importing. Default: false (appends).",
      ),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        "If true, validate the document and return a plan without touching AE. Useful for debugging malformed exports.",
      ),
    skipValidation: z
      .boolean()
      .optional()
      .describe(
        "Skip Node-side schema validation. Only use if you trust the input and want to hand broken data to AE for diagnosis.",
      ),
    baseDir: z
      .string()
      .optional()
      .describe(
        "Directory that relative footage paths resolve against. Defaults to the `pathBase` recorded by an export with `relativeTo`.",
      ),
    pathMap: z
      .array(z.object({ from: z.string(), to: z.string() }))
      .optional()
      .describe(
        "Footage path prefix rewrites applied before `baseDir`, first match wins, e.g. [{from: 'D:/old-media', to: 'E:/media'}].",
      ),
    strict: z
      .boolean()
      .optional()
      .describe(
        "Fail (PARTIAL_IMPORT, listing what was lost) when any property or group with a value, keys or an expression could not be imported. Without it the import succeeds and the result carries `dropped` and a hint. The project is already changed either way.",
      ),
    projectSettings: z
      .boolean()
      .optional()
      .describe(
        "Apply the document's project settings (color management, bit depth, time display). Default: only with clearFirst.",
      ),
  },
  handler: async (args, transport) => {
    let doc: unknown;
    if (args.inPath) {
      const abs = path.resolve(args.inPath);
      try {
        doc = JSON.parse(await fs.readFile(abs, "utf8"));
      } catch (err) {
        return errorResult(
          "IO",
          `cannot read project document at ${abs}: ${err instanceof Error ? err.message : String(err)}`,
          { details: { inPath: abs } },
        );
      }
    } else if (args.json !== undefined) {
      doc = args.json;
    } else {
      return errorResult("INVALID_ARGS", "must provide either `inPath` or `json`", {
        hint: "`inPath` takes an absolute path to a document produced by ae_project_export_json; `json` takes the document inline as an object.",
      });
    }

    // Relink footage before validation, so the plan and AE see final paths.
    const recordedBase =
      doc && typeof doc === "object" && typeof (doc as { pathBase?: unknown }).pathBase === "string"
        ? (doc as { pathBase: string }).pathBase
        : undefined;
    const baseDir = args.baseDir ?? recordedBase;
    const relink = resolveFootagePaths(doc, { baseDir, pathMap: args.pathMap });
    if (relink.unresolved.length > 0) {
      return errorResult(
        "INVALID_ARGS",
        `${relink.unresolved.length} footage path(s) are relative and there is no baseDir to resolve them against`,
        {
          details: { unresolved: relink.unresolved.slice(0, 20) },
          hint: "Pass baseDir (the directory the paths are relative to), or pathMap entries that make them absolute.",
        },
      );
    }

    // Node-side validation: catch malformed docs before hitting AE.
    let warnings: unknown[] = [];
    if (!args.skipValidation) {
      const v = validateAeProjectDoc(doc);
      if (!v.ok) {
        return errorResult(
          "VALIDATION",
          "document failed schema validation:\n" +
            v.issues.map((i) => `  ${i.path || "(root)"}: ${i.message}`).join("\n"),
          {
            details: { issues: v.issues, warnings: v.warnings },
            hint: "Run with dryRun: true to inspect the plan, or skipValidation: true to hand the document to AE as-is for diagnosis.",
          },
        );
      }
      warnings = v.warnings;
    }

    // dryRun short-circuits BEFORE any AE mutation, with or without
    // validation — `skipValidation` must never turn a dry run into a real one.
    if (args.dryRun) {
      const items = (doc as { items?: unknown[] }).items ?? [];
      return jsonResult({
        dryRun: true,
        valid: !args.skipValidation,
        itemCount: items.length,
        warnings,
        summary: summarizePlan(doc),
        relinked: relink.rewritten,
        missingFootage: await missingFootage(doc),
      });
    }

    // The document travels as `payload`, NOT inlined into the generated source.
    // A real project serializes to megabytes; embedding that as an ExtendScript
    // literal meant handing the ES3 parser a multi-megabyte expression and
    // making every character in every layer name an escaping hazard. As a
    // payload it is parsed once, by JSON.parse, before our code ever runs.
    const code = `
        return AE.importProject(payload.doc, payload.opts);
    `;
    const run = () =>
      transport.execute({
        code,
        payload: {
          doc,
          opts: {
            clearFirst: !!args.clearFirst,
            ...(args.projectSettings !== undefined
              ? { projectSettings: args.projectSettings }
              : {}),
          },
        },
        label: "project_import_json",
        timeoutMs: 600_000,
      });
    // Layer styles are added through Layer-menu commands, which AE only runs
    // while its window has the foreground. Borrow it for this one call and
    // hand it back; every other import leaves the user's desktop alone.
    const result = documentUsesLayerStyles(doc)
      ? await withAfterEffectsForeground(run)
      : await run();
    const dropped = result.ok ? annotateDrops(result) : [];
    if (args.strict && dropped.length) {
      return errorResult("PARTIAL_IMPORT", `${dropped.length} value(s) were not imported:\n  ` + dropped.slice(0, 20).join("\n  "), {
        details: { dropped, result: result.result },
        hint: "The project was already changed. Fix the document (see `dropped`) and import again, or remove the partial items.",
      });
    }
    return toMcpResult(result);
  },
});

function documentUsesLayerStyles(doc: unknown): boolean {
  try {
    return JSON.stringify(doc).includes('"ADBE Layer Styles"');
  } catch {
    return false;
  }
}

function summarizePlan(doc: unknown): Record<string, number | unknown> {
  const items = (doc as { items?: Array<{ type: string; layers?: unknown[] }> }).items ?? [];
  let folders = 0,
    comps = 0,
    solids = 0,
    files = 0,
    sequences = 0,
    placeholders = 0,
    proxies = 0,
    layers = 0;
  for (const it of items) {
    const f = it as unknown as { sourceKind?: string; sequence?: unknown; proxy?: unknown };
    if (f.proxy) proxies++;
    if (it.type === "FolderItem") folders++;
    else if (it.type === "CompItem") {
      comps++;
      if (Array.isArray(it.layers)) layers += it.layers.length;
    } else if (it.type === "FootageItem") {
      if (f.sourceKind === "solid") solids++;
      else if (f.sourceKind === "file") {
        files++;
        if (f.sequence) sequences++;
      } else if (f.sourceKind === "placeholder") placeholders++;
    }
  }
  return { folders, comps, solids, files, sequences, placeholders, proxies, layers };
}

/**
 * Footage files the import would not find. Paths are as AE will see them;
 * the server runs on the same machine as AE, so a missing file here is a
 * placeholder there.
 */
async function missingFootage(doc: unknown): Promise<string[]> {
  const missing: string[] = [];
  for (const h of footagePathHolders(doc)) {
    if (h.sourceKind !== "file") continue;
    const file = h.file as string;
    try {
      await fs.access(file);
    } catch {
      missing.push(file);
    }
  }
  return missing;
}
