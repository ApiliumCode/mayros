import { stripAnsi } from "../terminal/ansi.js";

export type A11yEvent =
  | { type: "system"; text: string }
  | { type: "user"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool-start"; name: string; detail?: string }
  | { type: "tool-result"; name: string; text: string; isError?: boolean }
  | { type: "status"; text: string };

export class A11yRenderer {
  private writer: (text: string) => void;

  constructor(writer?: (text: string) => void) {
    this.writer = writer ?? ((text) => process.stdout.write(text));
  }

  emit(event: A11yEvent): void {
    const line = this.formatEvent(event);
    this.writer(line + "\n");
  }

  announce(text: string): void {
    this.writer(`--- ${stripAnsi(text)} ---\n`);
  }

  private formatEvent(event: A11yEvent): string {
    switch (event.type) {
      case "system":
        return `[System] ${stripAnsi(event.text)}`;
      case "user":
        return `[You] ${stripAnsi(event.text)}`;
      case "assistant":
        return `[Assistant] ${stripAnsi(event.text)}`;
      case "tool-start":
        return event.detail
          ? `[Tool] ${stripAnsi(event.name)}: ${stripAnsi(event.detail)}`
          : `[Tool] ${stripAnsi(event.name)}`;
      case "tool-result":
        return event.isError
          ? `[Error] ${stripAnsi(event.name)}: ${stripAnsi(event.text)}`
          : `[Result] ${stripAnsi(event.name)}: ${stripAnsi(event.text)}`;
      case "status":
        return `[Status] ${stripAnsi(event.text)}`;
    }
  }
}

export function isA11yMode(): boolean {
  const value = process.env.MAYROS_ACCESSIBILITY;
  return value === "1" || value === "true";
}
