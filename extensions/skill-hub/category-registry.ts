/**
 * Skill Category Registry
 *
 * Provides a static registry of skill categories for Hub browsing
 * and classification.
 */

export type SkillCategory = {
  id: string;
  name: string;
  description: string;
  icon: string;
};

export const SKILL_CATEGORIES: SkillCategory[] = [
  {
    id: "security",
    name: "Security",
    description: "Security scanning, validation, and audit skills",
    icon: "shield",
  },
  {
    id: "code-quality",
    name: "Code Quality",
    description: "Linting, formatting, and code review skills",
    icon: "check",
  },
  {
    id: "data",
    name: "Data",
    description: "Data processing, transformation, and analysis skills",
    icon: "database",
  },
  {
    id: "integration",
    name: "Integration",
    description: "Third-party service integration skills",
    icon: "link",
  },
  {
    id: "testing",
    name: "Testing",
    description: "Test generation, execution, and coverage skills",
    icon: "test",
  },
  {
    id: "devops",
    name: "DevOps",
    description: "CI/CD, deployment, and infrastructure skills",
    icon: "gear",
  },
  {
    id: "documentation",
    name: "Documentation",
    description: "Documentation generation and maintenance skills",
    icon: "book",
  },
  {
    id: "other",
    name: "Other",
    description: "Miscellaneous skills",
    icon: "box",
  },
];

/**
 * Find a category by its unique ID.
 */
export function getCategoryById(id: string): SkillCategory | undefined {
  return SKILL_CATEGORIES.find((c) => c.id === id);
}

/**
 * Format all categories into a human-readable list string.
 */
export function formatCategoryList(): string {
  return SKILL_CATEGORIES.map((c) => `[${c.icon}] ${c.name} (${c.id}) — ${c.description}`).join(
    "\n",
  );
}
