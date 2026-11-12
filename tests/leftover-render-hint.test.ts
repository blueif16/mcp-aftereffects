// Every TIMEOUT hint names a finished aerender that never exited (2026-10-30), and none tells anyone to kill it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LEFTOVER_RENDER_HINT } from "../src/transport/FileIpcTransport.js";

const SRC = readFileSync(fileURLToPath(new URL("../src/transport/FileIpcTransport.ts", import.meta.url)), "utf8");

describe("TIMEOUT hints", () => {
  it("name aerender / AfterFX and leave the stopping to the user", () => {
    expect(LEFTOVER_RENDER_HINT).toMatch(/aerender/);
    expect(LEFTOVER_RENDER_HINT).toMatch(/AfterFX/);
    expect(LEFTOVER_RENDER_HINT).toMatch(/user's call/);
    expect(LEFTOVER_RENDER_HINT).not.toMatch(/taskkill/i);
  });

  it("is added to all three TIMEOUT failures", () => {
    const timeouts = SRC.split('"TIMEOUT"').length - 1;
    expect(timeouts).toBeGreaterThanOrEqual(3);
    expect(SRC.match(/\+\s*LEFTOVER_RENDER_HINT|^\s*LEFTOVER_RENDER_HINT,/gm)?.length).toBe(3);
  });
});
