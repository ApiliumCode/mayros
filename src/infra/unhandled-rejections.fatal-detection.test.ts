import process from "node:process";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { installUnhandledRejectionHandler } from "./unhandled-rejections.js";

describe("installUnhandledRejectionHandler - fatal detection", () => {
  let exitCalls: Array<string | number | null> = [];
  let stderrMessages: string[] = [];
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>;
  let originalExit: typeof process.exit;

  beforeAll(() => {
    originalExit = process.exit.bind(process);
    installUnhandledRejectionHandler();
  });

  beforeEach(() => {
    exitCalls = [];
    stderrMessages = [];

    vi.spyOn(process, "exit").mockImplementation((code?: string | number | null): never => {
      if (code !== undefined && code !== null) {
        exitCalls.push(code);
      }
      return undefined as never;
    });

    // Mock stderr.write to capture messages and invoke the callback synchronously
    // so that process.exit is called within the same tick as process.emit.
    stderrWriteSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((...args: unknown[]): boolean => {
        const data = args[0];
        if (typeof data === "string") {
          stderrMessages.push(data);
        }
        // Find the callback argument (2nd or 3rd arg) and invoke it synchronously
        for (let i = 1; i < args.length; i++) {
          if (typeof args[i] === "function") {
            (args[i] as () => void)();
            break;
          }
        }
        return true;
      });

    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
    stderrWriteSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  afterAll(() => {
    process.exit = originalExit;
  });

  describe("fatal errors", () => {
    it("exits on fatal runtime codes", () => {
      const fatalCases = [
        { code: "ERR_OUT_OF_MEMORY", message: "Out of memory" },
        { code: "ERR_SCRIPT_EXECUTION_TIMEOUT", message: "Script execution timeout" },
        { code: "ERR_WORKER_OUT_OF_MEMORY", message: "Worker out of memory" },
      ] as const;

      for (const { code, message } of fatalCases) {
        exitCalls = [];
        const err = Object.assign(new Error(message), { code });
        process.emit("unhandledRejection", err, Promise.resolve());
        expect(exitCalls).toEqual([1]);
      }

      const hasFatalMsg = stderrMessages.some(
        (msg) =>
          msg.includes("[mayros] FATAL unhandled rejection:") && msg.includes("Out of memory"),
      );
      expect(hasFatalMsg).toBe(true);
    });
  });

  describe("configuration errors", () => {
    it("exits on configuration error codes", () => {
      const configurationCases = [
        { code: "INVALID_CONFIG", message: "Invalid config" },
        { code: "MISSING_API_KEY", message: "Missing API key" },
      ] as const;

      for (const { code, message } of configurationCases) {
        exitCalls = [];
        const err = Object.assign(new Error(message), { code });
        process.emit("unhandledRejection", err, Promise.resolve());
        expect(exitCalls).toEqual([1]);
      }

      const hasConfigMsg = stderrMessages.some(
        (msg) =>
          msg.includes("[mayros] CONFIGURATION ERROR - requires fix:") &&
          msg.includes("Invalid config"),
      );
      expect(hasConfigMsg).toBe(true);
    });
  });

  describe("non-fatal errors", () => {
    it("does not exit on known transient network errors", () => {
      const transientCases = [
        Object.assign(new TypeError("fetch failed"), {
          cause: { code: "UND_ERR_CONNECT_TIMEOUT", syscall: "connect" },
        }),
        Object.assign(new Error("DNS resolve failed"), { code: "UND_ERR_DNS_RESOLVE_FAILED" }),
        Object.assign(new Error("Connection reset"), { code: "ECONNRESET" }),
        Object.assign(new Error("Timeout"), { code: "ETIMEDOUT" }),
      ];

      for (const transientErr of transientCases) {
        exitCalls = [];
        process.emit("unhandledRejection", transientErr, Promise.resolve());
        expect(exitCalls).toEqual([]);
      }

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[mayros] Non-fatal unhandled rejection (continuing):",
        expect.stringContaining("fetch failed"),
      );
    });

    it("exits on generic errors without code", () => {
      const genericErr = new Error("Something went wrong");

      process.emit("unhandledRejection", genericErr, Promise.resolve());

      expect(exitCalls).toEqual([1]);
      const hasGenericMsg = stderrMessages.some(
        (msg) =>
          msg.includes("[mayros] Unhandled promise rejection:") &&
          msg.includes("Something went wrong"),
      );
      expect(hasGenericMsg).toBe(true);
    });
  });
});
