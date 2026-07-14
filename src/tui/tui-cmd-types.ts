/**
 * Shared types for TUI command handler groups.
 *
 * Each command group module exports a function matching the
 * CommandGroupHandler signature. The dispatcher in tui-command-handlers.ts
 * iterates over the groups until one returns true (handled).
 */

import type { Component, TUI } from "@earendil-works/pi-tui";
import type { SessionsPatchResult } from "../gateway/protocol/index.js";
import type { ChatLog } from "./components/chat-log.js";
import type { GatewayChatClient } from "./gateway-chat.js";
import type { TuiOptions, TuiStateAccess } from "./tui-types.js";

/**
 * Full context passed to every command group. Includes the base dependencies
 * (client, chatLog, tui, state, ...) plus the shared closures (sendMessage,
 * setAgent, selectors) that are constructed once in createCommandHandlers
 * and reused across groups.
 */
export type CommandHandlerContext = {
  client: GatewayChatClient;
  chatLog: ChatLog;
  tui: TUI;
  opts: TuiOptions;
  state: TuiStateAccess;
  deliverDefault: boolean;
  openOverlay: (component: Component) => void;
  closeOverlay: () => void;
  refreshSessionInfo: () => Promise<void>;
  loadHistory: () => Promise<void>;
  setSession: (key: string) => Promise<void>;
  refreshAgents: () => Promise<void>;
  abortActive: () => Promise<void>;
  setActivityStatus: (text: string) => void;
  formatSessionKey: (key: string) => string;
  applySessionInfoFromPatch: (result: SessionsPatchResult) => void;
  noteLocalRunId: (runId: string) => void;
  forgetLocalRunId?: (runId: string) => void;
  mouseHandler?: { enable(): void; disable(): void; isEnabled(): boolean };
  // Shared closures — constructed once, passed to all groups.
  sendMessage: (text: string, displayText?: string) => Promise<void>;
  setAgent: (id: string) => Promise<void>;
  openModelSelector: () => Promise<void>;
  openAgentSelector: () => Promise<void>;
  openSessionSelector: () => Promise<void>;
  openSettings: () => void;
};

/**
 * A command group handler. Returns true if the command was handled (matched
 * a case), false to let the dispatcher try the next group.
 */
export type CommandGroupHandler = (
  ctx: CommandHandlerContext,
  name: string,
  args: string,
  raw: string,
) => Promise<boolean>;
