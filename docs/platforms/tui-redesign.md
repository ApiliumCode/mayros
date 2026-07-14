---
title: TUI Redesign Roadmap
description: Audit of the current terminal UI and prioritized plan for reaching a polished, best-in-class experience.
---

# TUI Redesign Roadmap

This document captures the current state of the Mayros terminal UI (`mayros code` / `mayros tui`), the gaps identified during an internal audit, and a prioritized roadmap for the next redesign pass. It is a planning artifact; implementation is tracked separately.

## Current state at a glance

The TUI is a gateway client: it renders in the terminal and talks to a running `mayros gateway` daemon over WebSocket. The rendering, input, and component layer comes from the shared terminal UI dependency; Mayros adds the slash-command surface, themes, vim mode, mouse scrolling, accessibility fallback, and the gateway chat client.

| Area                    | Maturity                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rendering and streaming | Mature. Event-driven render loop, full assistant-message re-render on each delta.                                                                |
| Slash commands          | Mature in count (40+ built-in), uneven in depth. Core session commands are first-class; ecosystem commands are prompt-injection shims.           |
| Themes                  | Mature. Ten palettes with 22 color tokens each, live hot-swap.                                                                                   |
| Vim mode                | Basic. Custom implementation; operators partially stubbed, no visual or command-line mode.                                                       |
| Accessibility           | Split. A linear text-mode TUI exists but is a separate, feature-poor implementation.                                                             |
| Platform coverage       | Gaps. Clipboard image paste and `/copy` work on macOS and Linux only; Windows and Wayland are unsupported.                                       |
| Architecture            | Workable but strained. Two monolithic files (`tui.ts`, `tui-command-handlers.ts`), a mutable god-object state, and two parallel palette systems. |

## Architectural constraints

These shape what a redesign can and cannot do without larger upstream work.

- **The terminal UI dependency is the rendering floor.** Layout capabilities (vertical-stack containers, select-list overlays) bound what Mayros can render. The tightest couplings are a `CustomEditor` that subclasses the shared editor and a `ChatLog` that subclasses the shared container. Refactoring either to composition requires an adapter layer or upstream changes.
- **The gateway is mandatory.** The TUI cannot run without a reachable gateway daemon. There is no in-process fallback, which affects offline use and dev ergonomics.
- **Theme hot-swap relies on singleton mutation.** Active theme objects are mutated in place so existing references stay live. Any snapshotting or caching of theme values would break live switching.
- **Mutable state object.** The TUI threads a single state object through every handler with manual render requests. There is no reactive store, although the signal libraries used elsewhere in the repo are available as a foundation.
- **Two parallel TUI implementations.** The graphical TUI and the accessibility TUI share almost no code. Every new feature currently needs to be implemented twice or skipped in one of them.
- **Two palette systems.** Terminal output (onboarding, prompts, CLI tables) and the TUI use separate palette modules with different accent colors. Visual consistency across the CLI experience requires unifying them.

## Gaps by category

### Rendering

- No inline image rendering despite the shared terminal dependency shipping the capability. Image content blocks currently render as text placeholders.
- The diff renderer hardcodes colors instead of consuming the active theme, so diffs look wrong under light or high-contrast themes.
- Only vertical-stack layout; no split panes or resizable regions beyond the select-list overlay.
- Full assistant-text re-render on every streaming delta; long messages may degrade.

### Input

- Vim operator-plus-motion combinations are a simplified stub (non-linewise motions collapse to single-character operations). No visual mode, no command-line mode, no search, no repeat, no registers beyond a single yank buffer.
- The vim bridge does not appear to be wired from the TUI side; motions may silently no-op if the bridge is never connected. This needs verification before any vim work.
- Ctrl+C does not abort the active run; only Escape does. This is surprising and should align with user expectations.
- A cross-session input history store exists in code but is not connected to the main loop.

### Commands

- Ecosystem commands (`/team`, `/tasks`, `/workflow`, `/rules`, `/mailbox`, `/sync`, `/trace`, `/kg`, `/plan`) inject a prompt that asks the model to call a tool, rather than being first-class features. Results depend on the model.
- Several commands lack argument autocomplete.
- The theme preset list is duplicated in two files and can drift.
- The README command list is stale relative to the implementation.

### Themes

- The terminal palette and the TUI palette are separate modules with different accent colors.
- No user-defined custom themes.
- No colorblind-optimized palettes beyond the existing high-contrast option.
- No explicit `NO_COLOR` or `FORCE_COLOR` handling in the TUI.

### Accessibility

- The accessibility TUI is a stripped-down parallel implementation: no slash commands beyond exit, no session switching, no abort, no model selection. It excludes screen-reader users from most functionality.
- No screen-reader announcements in the graphical TUI.
- No monochrome or no-color mode in the graphical TUI.

### Robustness and platform

- Clipboard image paste and `/copy` support macOS and Linux (xclip) only. Windows and Wayland are unsupported.
- Several silent `catch` blocks swallow errors without logging.
- Disconnect handling shows hints but does not auto-reconnect with backoff.
- Window resize handling is delegated entirely to the shared terminal dependency and is not verified end-to-end in Mayros.

## Roadmap

Priorities are assigned as P0 (correctness or blocker), P1 (high-value polish), and P2 (nice to have).

### P0 — Correctness and blockers

1. ~~**Verify the vim bridge is connected.**~~ **Resolved: vim mode has been disabled.** The bridge was never wired and the rendering dependency does not expose the cursor API needed to fix it cleanly. The `/vim` command now reports that the feature is unavailable, the dead handler and its tests have been removed, and the config flag is deprecated. Emacs/readline-style keybindings (Ctrl+A/E/W/U/K) remain available via the editor.
2. **Accessibility TUI feature parity.** Either linearize the graphical renderer for screen readers or bring slash commands, session switching, and abort into the accessibility TUI. The current split excludes users from most functionality.

### P1 — High-value polish

3. **Inline image rendering.** Use the shared terminal image component to render image content blocks inline instead of text placeholders.
4. **Unify the palettes.** Merge the terminal palette and the TUI palette into one source of truth; make the diff renderer and every component consume the active theme.
5. **Complete vim mode.** Implement real operator-plus-motion semantics and add visual mode, or adopt a proven keymap pattern.
6. **Windows and Wayland clipboard support.** Add the platform-native clipboard commands for `/copy` and image paste.
7. **Make Ctrl+C abort the active run** with a double-press-to-exit fallback, keeping Escape as a secondary abort.
8. **Refresh the README** to reflect the actual theme count and command list.

### P2 — Nice to have

9. Terminal color-scheme auto-detection to pick dark or light theme automatically.
10. Wire the cross-session input history store into the main loop, or remove the dead code.
11. User-defined custom themes loaded from a config directory.
12. Argument autocomplete for every command; deduplicate the theme preset list.
13. Colorblind-optimized palettes and a true monochrome mode.
14. Incremental streaming render for long assistant messages.
15. Replace silent error swallowing with structured logging behind a debug flag.
16. Split the two monolithic TUI files to bring them under the file-size guideline.

## Next steps

The first implementation pass should focus on the P0 items, since both block a trustworthy feature surface: vim cannot be extended on top of an unwired bridge, and the accessibility TUI cannot ship as the screen-reader path while it lacks core commands. The P1 items are the bulk of the visible polish work and can be sequenced independently once the P0 verifications land.
