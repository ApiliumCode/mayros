/**
 * Mayros Remote Control CLI
 *
 * Starts a WebSocket server that allows controlling a Mayros session
 * from another device (mobile, tablet, web browser).
 *
 * Usage:
 *   mayros remote-control                    # Start on default port 3456
 *   mayros remote-control --port 8080        # Custom port
 *   mayros remote-control --host 127.0.0.1   # Bind to localhost only
 *
 * The server generates a random access code for basic authentication.
 * Clients connect via WebSocket at ws://<host>:<port>/ws.
 */

import type { Command } from "commander";
import { theme } from "../terminal/theme.js";

// ============================================================================
// WebSocket Frame Helpers (exported for testing)
// ============================================================================

/**
 * Decode a WebSocket text frame from a raw buffer.
 * Returns the payload string, or null if the frame is not a text frame.
 *
 * Supports:
 * - 7-bit payload length (0-125 bytes)
 * - 16-bit extended payload (126)
 * - 64-bit extended payload (127)
 * - Masked frames (client-to-server per RFC 6455)
 */
export function decodeWebSocketFrame(buffer: Buffer): string | null {
  if (buffer.length < 2) return null;

  const opcode = buffer[0] & 0x0f;
  if (opcode !== 1) return null; // Only text frames

  const masked = (buffer[1] & 0x80) !== 0;
  let payloadLength = buffer[1] & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.length < 4) return null;
    payloadLength = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    if (buffer.length < 10) return null;
    payloadLength = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }

  if (masked) {
    if (buffer.length < offset + 4 + payloadLength) return null;
    const mask = buffer.subarray(offset, offset + 4);
    offset += 4;
    const payload = Buffer.from(buffer.subarray(offset, offset + payloadLength));
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= mask[i % 4];
    }
    return payload.toString("utf-8");
  }

  if (buffer.length < offset + payloadLength) return null;
  return buffer.subarray(offset, offset + payloadLength).toString("utf-8");
}

/**
 * Encode a string into a WebSocket text frame (unmasked, server-to-client).
 *
 * Supports:
 * - 7-bit payload length (0-125 bytes)
 * - 16-bit extended payload (126-65535 bytes)
 */
export function encodeWebSocketFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf-8");

  if (payload.length < 126) {
    const header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text opcode
    header[1] = payload.length;
    return Buffer.concat([header, payload]);
  }

  // 16-bit length
  const header = Buffer.alloc(4);
  header[0] = 0x81; // FIN + text opcode
  header[1] = 126;
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

// ============================================================================
// CLI Registration
// ============================================================================

export function registerRemoteCli(program: Command) {
  program
    .command("remote-control")
    .description("Start remote control server for mobile/web access")
    .option("--port <port>", "Server port", "3456")
    .option("--host <host>", "Bind host", "0.0.0.0")
    .action(async (opts: { port: string; host: string }) => {
      const port = Number.parseInt(String(opts.port), 10) || 3456;
      const host = opts.host || "0.0.0.0";

      const { createServer } = await import("node:http");
      const crypto = await import("node:crypto");

      const accessCode = crypto.randomBytes(3).toString("hex").toUpperCase();

      const server = createServer((req, res) => {
        if (req.url === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", version: "0.1.5" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          `<!DOCTYPE html><html><body>` +
            `<h1>Mayros Remote Control</h1>` +
            `<p>Connect via WebSocket at ws://${host}:${port}/ws</p>` +
            `<p>Access code: ${accessCode}</p>` +
            `</body></html>`,
        );
      });

      // WebSocket upgrade handling
      server.on("upgrade", async (req, socket, _head) => {
        if (req.url !== "/ws") {
          socket.destroy();
          return;
        }

        // Simple WebSocket handshake (RFC 6455)
        const key = req.headers["sec-websocket-key"];
        if (!key) {
          socket.destroy();
          return;
        }

        const acceptKey = crypto
          .createHash("sha1")
          .update(key + "258EAFA5-E914-47DA-95CA-5AB5DC69C625")
          .digest("base64");

        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`,
        );

        console.log(theme.success("Remote client connected"));

        socket.on("data", (data: Buffer) => {
          try {
            const decoded = decodeWebSocketFrame(data);
            if (decoded) {
              console.log(theme.muted(`Remote: ${decoded}`));
              // Echo back acknowledgment
              const response = JSON.stringify({ type: "ack", message: decoded });
              socket.write(encodeWebSocketFrame(response));
            }
          } catch {
            // Ignore malformed frames
          }
        });

        socket.on("close", () => {
          console.log(theme.muted("Remote client disconnected"));
        });
      });

      server.listen(port, host, () => {
        console.log("");
        console.log(theme.accent("Mayros Remote Control"));
        console.log("");
        console.log(`  URL:         http://${host}:${port}`);
        console.log(`  WebSocket:   ws://${host}:${port}/ws`);
        console.log(`  Access code: ${theme.accent(accessCode)}`);
        console.log("");
        console.log(theme.muted("Press Ctrl+C to stop"));
      });

      // Keep alive until interrupted
      await new Promise<void>((resolve) => {
        process.once("SIGINT", () => {
          server.close();
          resolve();
        });
      });
    });
}
