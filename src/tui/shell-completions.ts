/**
 * Shell completion providers — offer git and npm subcommand completions
 * for the TUI shell input when the user is typing shell commands.
 */

export type ShellCompletion = {
  value: string;
  label: string;
  description?: string;
};

export type ShellCompletionProvider = {
  prefix: string;
  getCompletions(partial: string): ShellCompletion[];
};

const GIT_SUBCOMMANDS: ShellCompletion[] = [
  { value: "status", label: "status", description: "Show working tree status" },
  { value: "add", label: "add", description: "Add file contents to index" },
  { value: "commit", label: "commit", description: "Record changes to repository" },
  { value: "push", label: "push", description: "Update remote refs" },
  { value: "pull", label: "pull", description: "Fetch and integrate changes" },
  { value: "checkout", label: "checkout", description: "Switch branches or restore files" },
  { value: "branch", label: "branch", description: "List, create, or delete branches" },
  { value: "merge", label: "merge", description: "Join development histories" },
  { value: "rebase", label: "rebase", description: "Reapply commits on top of another base" },
  { value: "log", label: "log", description: "Show commit logs" },
  { value: "diff", label: "diff", description: "Show changes between commits" },
  { value: "stash", label: "stash", description: "Stash pending changes" },
  { value: "fetch", label: "fetch", description: "Download objects and refs" },
  { value: "clone", label: "clone", description: "Clone a repository" },
  { value: "init", label: "init", description: "Create an empty repository" },
  { value: "reset", label: "reset", description: "Reset current HEAD to a state" },
  { value: "tag", label: "tag", description: "Create, list, or delete tags" },
  { value: "remote", label: "remote", description: "Manage set of tracked repositories" },
  {
    value: "cherry-pick",
    label: "cherry-pick",
    description: "Apply changes from specific commits",
  },
  { value: "bisect", label: "bisect", description: "Binary search for a bug" },
];

const NPM_SUBCOMMANDS: ShellCompletion[] = [
  { value: "install", label: "install", description: "Install dependencies" },
  { value: "run", label: "run", description: "Run a script" },
  { value: "test", label: "test", description: "Run tests" },
  { value: "start", label: "start", description: "Start the application" },
  { value: "build", label: "build", description: "Build the project" },
  { value: "init", label: "init", description: "Create package.json" },
  { value: "publish", label: "publish", description: "Publish a package" },
  { value: "update", label: "update", description: "Update packages" },
  { value: "uninstall", label: "uninstall", description: "Remove a package" },
  { value: "outdated", label: "outdated", description: "Check for outdated packages" },
  { value: "list", label: "list", description: "List installed packages" },
  { value: "audit", label: "audit", description: "Security audit" },
  { value: "pack", label: "pack", description: "Create a tarball" },
  { value: "link", label: "link", description: "Symlink a package" },
  { value: "ci", label: "ci", description: "Clean install" },
];

const PNPM_SUBCOMMANDS: ShellCompletion[] = [
  { value: "install", label: "install", description: "Install dependencies" },
  { value: "add", label: "add", description: "Add a package" },
  { value: "remove", label: "remove", description: "Remove a package" },
  { value: "run", label: "run", description: "Run a script" },
  { value: "test", label: "test", description: "Run tests" },
  { value: "build", label: "build", description: "Build the project" },
  { value: "update", label: "update", description: "Update packages" },
  { value: "outdated", label: "outdated", description: "Check outdated packages" },
  { value: "list", label: "list", description: "List packages" },
  { value: "store", label: "store", description: "Manage pnpm store" },
  { value: "exec", label: "exec", description: "Execute a command" },
  { value: "dlx", label: "dlx", description: "Run a package without installing" },
];

function createProvider(prefix: string, completions: ShellCompletion[]): ShellCompletionProvider {
  return {
    prefix,
    getCompletions(partial: string): ShellCompletion[] {
      const lower = partial.toLowerCase();
      return completions.filter((c) => c.value.startsWith(lower));
    },
  };
}

const PROVIDERS: ShellCompletionProvider[] = [
  createProvider("git ", GIT_SUBCOMMANDS),
  createProvider("npm ", NPM_SUBCOMMANDS),
  createProvider("pnpm ", PNPM_SUBCOMMANDS),
  createProvider("yarn ", NPM_SUBCOMMANDS), // yarn shares many npm subcommands
];

export function getShellCompletions(input: string): ShellCompletion[] {
  const trimmed = input.trimStart();
  for (const provider of PROVIDERS) {
    if (trimmed.startsWith(provider.prefix)) {
      const partial = trimmed.slice(provider.prefix.length);
      // Only complete the first subcommand (not nested args)
      if (!partial.includes(" ")) {
        return provider.getCompletions(partial);
      }
    }
  }
  return [];
}

export function listProviderPrefixes(): string[] {
  return PROVIDERS.map((p) => p.prefix.trim());
}
