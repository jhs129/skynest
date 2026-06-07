import { describe, it, expect } from "vitest";
import { getPersonalPostInitPrompt } from "../agent-config-base.js";
import { getStarter, listStarters } from "../index.js";

describe("getPersonalPostInitPrompt", () => {
  it("uses the second-brain framing with no codebase assumption", () => {
    const prompt = getPersonalPostInitPrompt();
    expect(prompt.instructions).toContain("SEED THE NEST");
    expect(prompt.instructions).toContain("personal second brain");
    expect(prompt.instructions).toContain("No codebase is assumed");
    expect(prompt.instructions).not.toContain("GENERATE CONTEXT.md");
  });

  it("addresses the agent directly", () => {
    const prompt = getPersonalPostInitPrompt();
    expect(prompt.instructions).toMatch(/YOU are the agent/);
    expect(prompt.instructions).toContain("Do not paraphrase this block");
  });

  it("offers personal-knowledge framings, not codebase framings", () => {
    const prompt = getPersonalPostInitPrompt();
    expect(prompt.instructions).toContain("thinking about lately");
    expect(prompt.instructions).toContain("mini ADR for your own life");
    expect(prompt.instructions).toContain("trying to learn more deeply");
    // Should NOT pitch codebase-specific options
    expect(prompt.instructions).not.toContain("3-line architecture summary of this codebase");
  });

  it("includes the 'or anything else' opening", () => {
    const prompt = getPersonalPostInitPrompt();
    expect(prompt.instructions).toContain("Or anything else");
  });
});

describe("personal starter registration", () => {
  it("is registered in the starter registry", () => {
    const starter = getStarter("personal");
    expect(starter).toBeDefined();
    expect(starter!.id).toBe("personal");
    expect(starter!.name).toBe("Personal / Second Brain");
  });

  it("ships no scaffolded template nodes (clean slate — no governance worksheet)", () => {
    const starter = getStarter("personal");
    expect(starter!.nodes).toEqual([]);
    expect(starter!.packs).toEqual([]);
  });

  it("appears in listStarters()", () => {
    const ids = listStarters().map((s) => s.id);
    expect(ids).toContain("personal");
  });

  it("getPrompt returns the personal post-init block", () => {
    const starter = getStarter("personal");
    const prompt = starter!.getPrompt();
    expect(prompt.instructions).toContain("STARTER: personal");
    expect(prompt.instructions).toContain("SEED THE NEST");
  });
});
