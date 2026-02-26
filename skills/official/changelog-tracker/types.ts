export interface VersionComparison {
  from: string;
  to: string;
  bump: "major" | "minor" | "patch" | "unknown";
  breaking: boolean;
}

export interface ChangelogAnalysis {
  versions: string[];
  comparisons: VersionComparison[];
  breakingChanges: string[];
}
