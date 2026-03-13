/**
 * `mayros mailbox` — Agent mailbox CLI.
 *
 * Persistent messaging between agents backed by AIngle Cortex.
 *
 * Subcommands:
 *   list     — List messages in an agent's inbox
 *   read     — Read a specific message and mark it as read
 *   send     — Send a message to another agent
 *   archive  — Archive a message
 *   stats    — Show mailbox statistics
 */

import type { Command } from "commander";
import {
  AgentMailbox,
  isValidMailMessageType,
  isValidMailStatus,
} from "../../extensions/agent-mesh/agent-mailbox.js";
import { resolveCortexClient, resolveNamespace } from "./shared/cortex-resolution.js";

// ============================================================================
// Registration
// ============================================================================

export function registerMailboxCli(program: Command) {
  const mb = program
    .command("mailbox")
    .description("Agent mailbox — persistent messaging between agents")
    .option("--cortex-host <host>", "Cortex host (default: 127.0.0.1 or from config)")
    .option("--cortex-port <port>", "Cortex port (default: 19090 or from config)")
    .option("--cortex-token <token>", "Cortex auth token (or set CORTEX_AUTH_TOKEN)");

  // ---- list ----

  mb.command("list")
    .description("List messages in an agent's inbox")
    .option("--agent <id>", "Agent ID (defaults to current agent)")
    .option("--status <status>", "Filter by status (unread|read|archived)")
    .option("--type <type>", "Filter by message type")
    .option("--from <id>", "Filter by sender agent ID")
    .option("--limit <n>", "Max messages", "20")
    .option("--format <format>", "Output format (terminal|json)", "terminal")
    .action(async (opts, cmd) => {
      const parentOpts = cmd.parent.opts();
      const client = resolveCortexClient(
        {
          host: parentOpts.cortexHost,
          port: parentOpts.cortexPort,
          token: parentOpts.cortexToken,
        },
        { pluginName: "agent-mesh" },
      );
      const ns = resolveNamespace("agent-mesh");

      try {
        const healthy = await client.isHealthy();
        if (!healthy) {
          console.log("Cortex offline. Cannot list mailbox.");
          return;
        }

        const mailbox = new AgentMailbox(client, ns);
        const agent = opts.agent ?? "main";

        const messages = await mailbox.inbox({
          agent,
          status: opts.status && isValidMailStatus(opts.status) ? opts.status : undefined,
          type: opts.type && isValidMailMessageType(opts.type) ? opts.type : undefined,
          from: opts.from,
          limit: Number.parseInt(opts.limit, 10) || 20,
        });

        if (opts.format === "json") {
          console.log(JSON.stringify(messages, null, 2));
          return;
        }

        if (messages.length === 0) {
          console.log(`No messages for ${agent}.`);
          return;
        }

        console.log(`Inbox for ${agent} (${messages.length} messages):`);
        for (const m of messages) {
          const readMark = m.status === "unread" ? "*" : " ";
          const preview = m.content.length > 60 ? m.content.slice(0, 60) + "…" : m.content;
          console.log(`  ${readMark} ${m.id}  from:${m.from}  [${m.type}]  ${preview}`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      } finally {
        client.destroy();
      }
    });

  // ---- read ----

  mb.command("read")
    .description("Read a specific message and mark it as read")
    .argument("<messageId>", "Message ID")
    .option("--agent <id>", "Recipient agent ID (defaults to main)")
    .option("--format <format>", "Output format (terminal|json)", "terminal")
    .action(async (messageId, opts, cmd) => {
      const parentOpts = cmd.parent.opts();
      const client = resolveCortexClient(
        {
          host: parentOpts.cortexHost,
          port: parentOpts.cortexPort,
          token: parentOpts.cortexToken,
        },
        { pluginName: "agent-mesh" },
      );
      const ns = resolveNamespace("agent-mesh");

      try {
        const healthy = await client.isHealthy();
        if (!healthy) {
          console.log("Cortex offline. Cannot read message.");
          return;
        }

        const mailbox = new AgentMailbox(client, ns);
        const agent = opts.agent ?? "main";

        const msg = await mailbox.getMessage(agent, messageId);
        if (!msg) {
          console.log(`Message ${messageId} not found.`);
          return;
        }

        // Mark as read
        await mailbox.markRead(agent, messageId);

        if (opts.format === "json") {
          console.log(JSON.stringify({ ...msg, status: "read" }, null, 2));
          return;
        }

        console.log(`Message ${msg.id}:`);
        console.log(`  from: ${msg.from}`);
        console.log(`  to: ${msg.to}`);
        console.log(`  type: ${msg.type}`);
        console.log(`  sent: ${msg.sentAt}`);
        if (msg.replyTo) {
          console.log(`  replyTo: ${msg.replyTo}`);
        }
        console.log(`  status: read`);
        console.log(`\n${msg.content}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      } finally {
        client.destroy();
      }
    });

  // ---- send ----

  mb.command("send")
    .description("Send a message to another agent")
    .requiredOption("--from <id>", "Sender agent ID")
    .requiredOption("--to <id>", "Recipient agent ID")
    .requiredOption("--content <text>", "Message content")
    .option(
      "--type <type>",
      "Message type (task|finding|question|status|knowledge-share|delegation-context)",
      "task",
    )
    .option("--reply-to <id>", "Parent message ID for threading")
    .option("--format <format>", "Output format (terminal|json)", "terminal")
    .action(async (opts, cmd) => {
      const parentOpts = cmd.parent.opts();
      const client = resolveCortexClient(
        {
          host: parentOpts.cortexHost,
          port: parentOpts.cortexPort,
          token: parentOpts.cortexToken,
        },
        { pluginName: "agent-mesh" },
      );
      const ns = resolveNamespace("agent-mesh");

      try {
        const healthy = await client.isHealthy();
        if (!healthy) {
          console.log("Cortex offline. Cannot send message.");
          return;
        }

        if (!isValidMailMessageType(opts.type)) {
          console.error(`Invalid message type: ${opts.type}`);
          return;
        }

        const mailbox = new AgentMailbox(client, ns);

        const msg = await mailbox.send({
          from: opts.from,
          to: opts.to,
          content: opts.content,
          type: opts.type,
          replyTo: opts.replyTo,
        });

        if (opts.format === "json") {
          console.log(JSON.stringify(msg, null, 2));
          return;
        }

        console.log(`Message sent:`);
        console.log(`  id: ${msg.id}`);
        console.log(`  from: ${msg.from} → to: ${msg.to}`);
        console.log(`  type: ${msg.type}`);
        if (msg.replyTo) {
          console.log(`  replyTo: ${msg.replyTo}`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      } finally {
        client.destroy();
      }
    });

  // ---- archive ----

  mb.command("archive")
    .description("Archive a message")
    .argument("<messageId>", "Message ID")
    .option("--agent <id>", "Recipient agent ID (defaults to main)")
    .action(async (messageId, opts, cmd) => {
      const parentOpts = cmd.parent.opts();
      const client = resolveCortexClient(
        {
          host: parentOpts.cortexHost,
          port: parentOpts.cortexPort,
          token: parentOpts.cortexToken,
        },
        { pluginName: "agent-mesh" },
      );
      const ns = resolveNamespace("agent-mesh");

      try {
        const healthy = await client.isHealthy();
        if (!healthy) {
          console.log("Cortex offline. Cannot archive message.");
          return;
        }

        const mailbox = new AgentMailbox(client, ns);
        const agent = opts.agent ?? "main";

        const ok = await mailbox.markArchived(agent, messageId);
        if (!ok) {
          console.log(`Message ${messageId} not found.`);
          return;
        }

        console.log(`Message ${messageId} archived.`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      } finally {
        client.destroy();
      }
    });

  // ---- stats ----

  mb.command("stats")
    .description("Show mailbox statistics for an agent")
    .option("--agent <id>", "Agent ID (defaults to main)")
    .option("--format <format>", "Output format (terminal|json)", "terminal")
    .action(async (opts, cmd) => {
      const parentOpts = cmd.parent.opts();
      const client = resolveCortexClient(
        {
          host: parentOpts.cortexHost,
          port: parentOpts.cortexPort,
          token: parentOpts.cortexToken,
        },
        { pluginName: "agent-mesh" },
      );
      const ns = resolveNamespace("agent-mesh");

      try {
        const healthy = await client.isHealthy();
        if (!healthy) {
          console.log("Cortex offline. Cannot get mailbox stats.");
          return;
        }

        const mailbox = new AgentMailbox(client, ns);
        const agent = opts.agent ?? "main";

        const stats = await mailbox.stats(agent);

        if (opts.format === "json") {
          console.log(JSON.stringify(stats, null, 2));
          return;
        }

        console.log(`Mailbox stats for ${agent}:`);
        console.log(`  total: ${stats.total}`);
        console.log(`  unread: ${stats.unread}`);
        console.log(`  read: ${stats.read}`);
        console.log(`  archived: ${stats.archived}`);
        if (Object.keys(stats.byType).length > 0) {
          console.log(`  by type:`);
          for (const [type, count] of Object.entries(stats.byType)) {
            console.log(`    ${type}: ${count}`);
          }
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      } finally {
        client.destroy();
      }
    });
}
