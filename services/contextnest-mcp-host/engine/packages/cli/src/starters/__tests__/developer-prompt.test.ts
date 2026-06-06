import { describe, it, expect } from "vitest";
import {
  getPostInitPrompt,
  getDeveloperPostInitPrompt,
} from "../agent-config-base.js";
import { getStarter } from "../index.js";

describe("getDeveloperPostInitPrompt", () => {
  it("returns second-brain framing, not governance framing", () => {
    const prompt = getDeveloperPostInitPrompt();
    expect(prompt.instructions).toContain("SEED THE NEST");
    expect(prompt.instructions).toContain("ONE real node");
    expect(prompt.instructions).not.toContain("GENERATE CONTEXT.md");
  });

  it("addresses the agent directly to break out of 'report output' mode", () => {
    const prompt = getDeveloperPostInitPrompt();
    expect(prompt.instructions).toMatch(/YOU are the agent/);
    expect(prompt.instructions).toContain("Do not paraphrase this block");
    expect(prompt.instructions).toContain("Begin with Step 1 immediately");
  });

  it("tells the agent not to talk about governance on day one", () => {
    const prompt = getDeveloperPostInitPrompt();
    expect(prompt.instructions).toMatch(/Don.?t mention[\s\S]*?versioning/i);
    expect(prompt.instructions).toContain("compliance unless the user asks");
  });

  it("reuses the shared BASE_CONTEXT (ctx commands reference)", () => {
    const dev = getDeveloperPostInitPrompt();
    const generic = getPostInitPrompt("executive", "Executive vault");
    expect(dev.context).toBe(generic.context);
  });
});

describe("developer starter getPrompt", () => {
  it("uses the developer-specific instructions", () => {
    const starter = getStarter("developer");
    expect(starter).toBeDefined();
    const prompt = starter!.getPrompt();
    expect(prompt.instructions).toContain("SEED THE NEST");
  });
});

describe("other starters keep the generic instructions", () => {
  it("executive starter still uses GENERATE CONTEXT.md", () => {
    const starter = getStarter("executive");
    expect(starter).toBeDefined();
    const prompt = starter!.getPrompt();
    expect(prompt.instructions).toContain("GENERATE CONTEXT.md");
    expect(prompt.instructions).not.toContain("SEED THE NEST");
  });
});
