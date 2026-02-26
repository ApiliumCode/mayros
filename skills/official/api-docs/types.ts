export interface Snippet {
  operation: string;
  language: string;
  code: string;
}

export interface SnippetResult {
  original: unknown;
  snippets: Snippet[];
}
