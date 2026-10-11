import { promises as fs } from "node:fs";
import * as path from "node:path";
import { z } from "zod";

import { rejectedOutputPath } from "../config.js";
import { errorResult } from "../errors.js";
import { isAbsolutePath, relativizeFootagePaths, toSlash } from "../footage-paths.js";
import { defineTool, jsonResult, toMcpResult } from "./define-tool.js";

export const projectExportTool = defineTool({
  name: "ae_project_export_json",
  title: "Export project JSON",
  description:
    "Serialize the entire project to JSON (folders, comps, layers, keyframes, effects, " +
    "shapes, markers, time remap, solids, footage with interpretation, sequences, proxies, project settings; " +
    "Advanced 3D: 3D models, parametric meshes with mesh/bevel options, materials, extrusion and bevels, " +
    "environment-light sources). " +
    "Write to `outPath` or return inline. `relativeTo` makes footage paths under a directory relative.",
  group: "document",
  blockedInReadOnly: false,
  effect: "write",
  inputShape: {
    outPath: z
      .string()
      .optional()
      .describe(
        "If set, write the exported JSON to this absolute path on disk. " +
          "If omitted, the JSON is returned inline in the tool response (can get large).",
      ),
    pretty: z
      .boolean()
      .optional()
      .describe(
        "Pretty-print the JSON (2-space indent). Default: true when writing to disk, false otherwise.",
      ),
    relativeTo: z
      .string()
      .optional()
      .describe(
        "Absolute directory. Footage paths inside it are written relative to it and the document records it as `pathBase`, " +
          "so ae_project_import_json resolves them again (or against its own baseDir when the media moved).",
      ),
  },
  handler: async (args, transport) => {
    if (args.relativeTo !== undefined && !isAbsolutePath(args.relativeTo)) {
      return errorResult(
        "INVALID_ARGS",
        `relativeTo must be an absolute directory, got '${args.relativeTo}'`,
        {
          hint: "Pass the media root as an absolute path, e.g. D:/studio-mirror/my-video.",
        },
      );
    }
    if (args.outPath) {
      const rejection = rejectedOutputPath(args.outPath);
      if (rejection !== null) {
        return errorResult("IO", rejection, {
          details: { outPath: path.resolve(args.outPath) },
          hint: "Write the document somewhere outside the mailbox, or omit outPath to receive it inline.",
        });
      }
    }
    const code = `
        var doc = AE.exportProject();
        return doc;
    `;
    // Export can touch thousands of properties on large projects — bump the timeout.
    const result = await transport.execute({
      code,
      label: "project_export_json",
      timeoutMs: 300_000,
    });
    if (!result.ok) return toMcpResult(result);

    const doc = result.result;
    if (args.relativeTo !== undefined && doc && typeof doc === "object") {
      relativizeFootagePaths(doc, args.relativeTo);
      (doc as Record<string, unknown>).pathBase = toSlash(args.relativeTo).replace(/\/+$/, "");
    }
    const pretty = args.pretty ?? !!args.outPath;
    const jsonText = JSON.stringify(doc, null, pretty ? 2 : 0);

    if (args.outPath) {
      const abs = path.resolve(args.outPath);
      try {
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, jsonText, "utf8");
      } catch (err) {
        return errorResult(
          "IO",
          `exported the project but could not write ${abs}: ${err instanceof Error ? err.message : String(err)}`,
          {
            details: { outPath: abs, bytes: Buffer.byteLength(jsonText, "utf8") },
            hint: "Pick a writable absolute path, or omit outPath to receive the document inline.",
          },
        );
      }
      return jsonResult({
        writtenTo: abs.replace(/\\/g, "/"),
        bytes: Buffer.byteLength(jsonText, "utf8"),
        itemCount:
          doc && typeof doc === "object" && "items" in (doc as Record<string, unknown>)
            ? ((doc as { items: unknown[] }).items?.length ?? 0)
            : 0,
        durationMs: result.durationMs,
      });
    }

    // Inline return — put the JSON text in a single text block, plus structured content
    return {
      content: [{ type: "text", text: jsonText }],
      structuredContent: {
        ok: true,
        doc,
        durationMs: result.durationMs,
      },
      isError: false,
    };
  },
});
