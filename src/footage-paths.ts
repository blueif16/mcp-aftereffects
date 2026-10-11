// Footage path rewriting for project documents.
//
// Export can make footage paths relative to a directory (`relativeTo`), so a
// document describes a self-contained project that can move. Import resolves
// them again: `pathMap` rewrites prefixes first (e.g. one machine's media root
// to another's), then any path still relative is joined onto `baseDir`, which
// defaults to the `pathBase` the export recorded.
//
// Paths are compared with forward slashes; Windows drive and UNC prefixes are
// matched case-insensitively, since that is how the file system treats them.

import * as path from "node:path";

export interface PathMapEntry {
  from: string;
  to: string;
}

export interface ResolveOptions {
  baseDir?: string;
  pathMap?: PathMapEntry[];
}

export interface ResolveReport {
  /** Paths changed by pathMap or baseDir. */
  rewritten: number;
  /** Paths still relative after resolution (no baseDir to join them to). */
  unresolved: string[];
}

type Holder = Record<string, unknown>;

export function toSlash(p: string): string {
  return p.replace(/\\/g, "/");
}

export function isAbsolutePath(p: string): boolean {
  const s = toSlash(p);
  return /^[A-Za-z]:\//.test(s) || s.startsWith("/");
}

function isWindowsish(p: string): boolean {
  const s = toSlash(p);
  return /^[A-Za-z]:\//.test(s) || s.startsWith("//");
}

function trimSlash(p: string): string {
  const s = toSlash(p);
  return s.length > 1 && s.endsWith("/") && !/^[A-Za-z]:\/$/.test(s) ? s.replace(/\/+$/, "") : s;
}

/** True when `p` is `dir` or inside it. */
function startsWithDir(p: string, dir: string): boolean {
  const a = toSlash(p);
  const d = trimSlash(dir);
  const ci = isWindowsish(d);
  const aa = ci ? a.toLowerCase() : a;
  const dd = ci ? d.toLowerCase() : d;
  return aa === dd || aa.startsWith(dd.endsWith("/") ? dd : dd + "/");
}

function joinPath(base: string, rel: string): string {
  const b = trimSlash(base);
  // posix.normalize keeps "D:/" and "//server" prefixes intact and folds ./..
  const joined = path.posix.normalize(`${b}/${toSlash(rel)}`);
  return b.startsWith("//") && !joined.startsWith("//") ? "/" + joined : joined;
}

/** Every object in the document that carries a footage `file` path. */
export function footagePathHolders(doc: unknown): Holder[] {
  const out: Holder[] = [];
  const items = (doc as { items?: unknown })?.items;
  if (!Array.isArray(items)) return out;
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const item = it as Holder;
    if (typeof item.file === "string") out.push(item);
    const proxy = item.proxy;
    if (proxy && typeof proxy === "object" && typeof (proxy as Holder).file === "string") {
      out.push(proxy as Holder);
    }
  }
  return out;
}

/** Make footage paths under `base` relative to it. Returns how many changed. */
export function relativizeFootagePaths(doc: unknown, base: string): number {
  let n = 0;
  const d = trimSlash(base);
  for (const h of footagePathHolders(doc)) {
    for (const key of ["file", "missingFootagePath"] as const) {
      const v = h[key];
      if (typeof v !== "string" || !isAbsolutePath(v) || !startsWithDir(v, d)) continue;
      const rel = toSlash(v).slice(d.length).replace(/^\/+/, "");
      h[key] = rel === "" ? "." : rel;
      if (key === "file") n++;
    }
  }
  return n;
}

/** Apply pathMap, then join relative paths onto baseDir. Mutates the document. */
export function resolveFootagePaths(doc: unknown, opts: ResolveOptions): ResolveReport {
  const report: ResolveReport = { rewritten: 0, unresolved: [] };
  const maps = (opts.pathMap ?? []).map((m) => ({ from: trimSlash(m.from), to: trimSlash(m.to) }));
  for (const h of footagePathHolders(doc)) {
    for (const key of ["file", "missingFootagePath"] as const) {
      const orig = h[key];
      if (typeof orig !== "string") continue;
      let v = toSlash(orig);
      const m = maps.find((e) => startsWithDir(v, e.from));
      if (m) v = m.to + v.slice(m.from.length);
      if (!isAbsolutePath(v)) {
        if (opts.baseDir) v = joinPath(opts.baseDir, v);
        else if (key === "file") report.unresolved.push(v);
      }
      if (v !== orig) {
        h[key] = v;
        if (key === "file") report.rewritten++;
      }
    }
  }
  return report;
}
