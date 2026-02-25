import { describe, it, expect, vi } from "vitest";
import { DependencyResolver } from "./dependency-resolver.js";

function mockHubClient(skills: Record<string, { version: string }>) {
  return {
    getSkill: vi.fn().mockImplementation(async (slug: string) => {
      const info = skills[slug];
      if (!info) return null;
      return {
        slug,
        version: info.version,
        name: slug,
        description: "",
        author: "",
        downloads: 0,
        rating: 0,
        publishedAt: "",
      };
    }),
  } as any;
}

describe("DependencyResolver", () => {
  it("resolves a single dependency", async () => {
    const resolver = new DependencyResolver();
    const hub = mockHubClient({ "my-skill": { version: "1.2.3" } });

    const result = await resolver.resolve([{ slug: "my-skill", version: "^1.0.0" }], hub);

    expect(result.total).toBe(1);
    expect(result.order[0]!.slug).toBe("my-skill");
    expect(result.order[0]!.version).toBe("1.2.3");
  });

  it("resolves multiple independent dependencies", async () => {
    const resolver = new DependencyResolver();
    const hub = mockHubClient({
      "skill-a": { version: "1.0.0" },
      "skill-b": { version: "2.5.1" },
    });

    const result = await resolver.resolve(
      [
        { slug: "skill-a", version: "^1.0.0" },
        { slug: "skill-b", version: "^2.0.0" },
      ],
      hub,
    );

    expect(result.total).toBe(2);
    expect(result.order.map((s) => s.slug)).toContain("skill-a");
    expect(result.order.map((s) => s.slug)).toContain("skill-b");
  });

  it("throws for missing dependency", async () => {
    const resolver = new DependencyResolver();
    const hub = mockHubClient({});

    await expect(
      resolver.resolve([{ slug: "nonexistent", version: "^1.0.0" }], hub),
    ).rejects.toThrow("not found");
  });

  it("throws for version mismatch", async () => {
    const resolver = new DependencyResolver();
    const hub = mockHubClient({ "old-skill": { version: "0.5.0" } });

    await expect(resolver.resolve([{ slug: "old-skill", version: "^1.0.0" }], hub)).rejects.toThrow(
      "does not satisfy",
    );
  });

  it("deduplicates repeated dependencies", async () => {
    const resolver = new DependencyResolver();
    const hub = mockHubClient({ shared: { version: "1.0.0" } });

    const result = await resolver.resolve(
      [
        { slug: "shared", version: "^1.0.0" },
        { slug: "shared", version: "^1.0.0" },
      ],
      hub,
    );

    expect(result.total).toBe(1);
  });

  it("handles empty dependency list", async () => {
    const resolver = new DependencyResolver();
    const hub = mockHubClient({});

    const result = await resolver.resolve([], hub);
    expect(result.total).toBe(0);
    expect(result.order).toEqual([]);
  });
});
