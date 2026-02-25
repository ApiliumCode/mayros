/**
 * Skill Dependency Resolver
 *
 * Resolves a dependency graph using topological sort (Kahn's algorithm),
 * detects circular dependencies, and validates semver ranges.
 */

import type { HubClient } from "./hub-client.js";

export type SkillDependency = {
  slug: string;
  version: string; // semver range
};

export type ResolvedSkill = {
  slug: string;
  version: string; // exact resolved version
  dependencies: string[]; // slugs of direct dependencies
};

export type ResolvedGraph = {
  order: ResolvedSkill[]; // topologically sorted install order
  total: number;
};

export class DependencyResolver {
  /**
   * Resolve a dependency graph from root dependencies.
   * Returns a topologically sorted install order.
   *
   * @throws if circular dependencies are detected or a dependency cannot be resolved
   */
  async resolve(rootDeps: SkillDependency[], hubClient: HubClient): Promise<ResolvedGraph> {
    const resolved = new Map<string, ResolvedSkill>();
    const visited = new Set<string>();
    const resolving = new Set<string>(); // for cycle detection

    // DFS resolution
    const visit = async (dep: SkillDependency): Promise<void> => {
      if (resolved.has(dep.slug)) return;

      if (resolving.has(dep.slug)) {
        throw new Error(`Circular dependency detected: ${dep.slug} is already being resolved`);
      }

      resolving.add(dep.slug);

      // Fetch skill info from Hub
      const skillInfo = await hubClient.getSkill(dep.slug);
      if (!skillInfo) {
        throw new Error(`Dependency "${dep.slug}" not found on Hub`);
      }

      // Validate version compatibility
      const { satisfies } = await import("semver");
      if (!satisfies(skillInfo.version, dep.version)) {
        throw new Error(
          `Dependency "${dep.slug}" version ${skillInfo.version} does not satisfy range ${dep.version}`,
        );
      }

      // Resolve sub-dependencies from Hub API metadata
      const subDeps: SkillDependency[] = (skillInfo.dependencies ?? []).map((d) => ({
        slug: d.slug,
        version: d.version,
      }));

      // Resolve sub-dependencies first
      for (const subDep of subDeps) {
        await visit(subDep);
      }

      resolving.delete(dep.slug);

      resolved.set(dep.slug, {
        slug: dep.slug,
        version: skillInfo.version,
        dependencies: subDeps.map((d) => d.slug),
      });
    };

    for (const dep of rootDeps) {
      await visit(dep);
    }

    // Topological sort using Kahn's algorithm
    const order = topologicalSort(resolved);

    return { order, total: order.length };
  }
}

/**
 * Kahn's algorithm for topological sorting.
 */
function topologicalSort(skills: Map<string, ResolvedSkill>): ResolvedSkill[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const [slug, skill] of skills) {
    if (!inDegree.has(slug)) inDegree.set(slug, 0);
    if (!adjacency.has(slug)) adjacency.set(slug, []);

    for (const dep of skill.dependencies) {
      adjacency.get(dep)?.push(slug) ?? adjacency.set(dep, [slug]);
      inDegree.set(slug, (inDegree.get(slug) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [slug, degree] of inDegree) {
    if (degree === 0) queue.push(slug);
  }

  const sorted: ResolvedSkill[] = [];
  while (queue.length > 0) {
    const slug = queue.shift()!;
    const skill = skills.get(slug);
    if (skill) sorted.push(skill);

    for (const neighbor of adjacency.get(slug) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (sorted.length !== skills.size) {
    throw new Error("Circular dependency detected in topological sort");
  }

  return sorted;
}
