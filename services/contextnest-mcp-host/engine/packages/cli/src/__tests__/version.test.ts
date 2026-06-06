import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(here, "..", "..", "package.json");
const distPath = join(here, "..", "..", "dist", "index.js");

describe("ctx --version", () => {
  it("matches the version in package.json (so future bumps can't drift)", () => {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
    const output = execSync(`node "${distPath}" --version`, { encoding: "utf8" }).trim();
    expect(output).toBe(pkg.version);
  });
});
