/**
 * Tool Bridge Tests
 *
 * Tests cover: classifyMcpToolKind (read/write/exec/admin/other),
 * bridgeMcpTool (name prefixing, label, description),
 * jsonSchemaToTypeBox (string, number, boolean, object, array, unknown).
 */

import { describe, it, expect } from "vitest";
import { classifyMcpToolKind, bridgeMcpTool, jsonSchemaToTypeBox } from "./tool-bridge.js";

// ============================================================================
// classifyMcpToolKind
// ============================================================================

describe("classifyMcpToolKind", () => {
  it("classifies read tools by name", () => {
    expect(classifyMcpToolKind("get_user")).toBe("read");
    expect(classifyMcpToolKind("list-files")).toBe("read");
    expect(classifyMcpToolKind("read_config")).toBe("read");
    expect(classifyMcpToolKind("fetch_data")).toBe("read");
    expect(classifyMcpToolKind("search-logs")).toBe("read");
    expect(classifyMcpToolKind("query_db")).toBe("read");
    expect(classifyMcpToolKind("find-match")).toBe("read");
    expect(classifyMcpToolKind("show_status")).toBe("read");
    expect(classifyMcpToolKind("describe_table")).toBe("read");
  });

  it("classifies write tools by name", () => {
    expect(classifyMcpToolKind("create_user")).toBe("write");
    expect(classifyMcpToolKind("update-record")).toBe("write");
    expect(classifyMcpToolKind("delete_file")).toBe("write");
    expect(classifyMcpToolKind("remove-item")).toBe("write");
    expect(classifyMcpToolKind("set_value")).toBe("write");
    expect(classifyMcpToolKind("put_object")).toBe("write");
    expect(classifyMcpToolKind("post_message")).toBe("write");
    expect(classifyMcpToolKind("write_log")).toBe("write");
    expect(classifyMcpToolKind("modify-settings")).toBe("write");
    expect(classifyMcpToolKind("add-member")).toBe("write");
  });

  it("classifies exec tools by name", () => {
    expect(classifyMcpToolKind("run_test")).toBe("exec");
    expect(classifyMcpToolKind("exec-command")).toBe("exec");
    expect(classifyMcpToolKind("execute_query")).toBe("exec");
    expect(classifyMcpToolKind("invoke-api")).toBe("exec");
    expect(classifyMcpToolKind("call_function")).toBe("exec");
    expect(classifyMcpToolKind("start-service")).toBe("exec");
    expect(classifyMcpToolKind("stop_server")).toBe("exec");
    expect(classifyMcpToolKind("restart-daemon")).toBe("exec");
  });

  it("classifies admin tools by name", () => {
    expect(classifyMcpToolKind("admin_panel")).toBe("admin");
    expect(classifyMcpToolKind("manage-users")).toBe("admin");
    expect(classifyMcpToolKind("config_server")).toBe("admin");
    expect(classifyMcpToolKind("configure-db")).toBe("admin");
    expect(classifyMcpToolKind("deploy_app")).toBe("admin");
    expect(classifyMcpToolKind("install-plugin")).toBe("admin");
  });

  it("returns other for unclassifiable names", () => {
    expect(classifyMcpToolKind("process_data")).toBe("other");
    expect(classifyMcpToolKind("analyze")).toBe("other");
    expect(classifyMcpToolKind("transform")).toBe("other");
    expect(classifyMcpToolKind("my_custom_tool")).toBe("other");
  });

  it("uses description as fallback", () => {
    expect(classifyMcpToolKind("my_tool", "This tool will fetch data")).toBe("read");
    expect(classifyMcpToolKind("my_tool", "Create a new record")).toBe("write");
    expect(classifyMcpToolKind("my_tool", "Execute the build pipeline")).toBe("exec");
    expect(classifyMcpToolKind("my_tool", "Configure system settings")).toBe("admin");
  });

  it("name takes priority over description", () => {
    // Name says "get" (read) but description says "create" (write)
    expect(classifyMcpToolKind("get_user", "Create a new user")).toBe("read");
  });
});

// ============================================================================
// jsonSchemaToTypeBox
// ============================================================================

describe("jsonSchemaToTypeBox", () => {
  it("converts string type", () => {
    const result = jsonSchemaToTypeBox({ type: "string" });
    expect(result).toBeTruthy();
    expect((result as Record<string, unknown>).type).toBe("string");
  });

  it("converts string with description", () => {
    const result = jsonSchemaToTypeBox({
      type: "string",
      description: "A user name",
    }) as Record<string, unknown>;
    expect(result.type).toBe("string");
    expect(result.description).toBe("A user name");
  });

  it("converts number type", () => {
    const result = jsonSchemaToTypeBox({ type: "number" }) as Record<string, unknown>;
    expect(result.type).toBe("number");
  });

  it("converts integer type to number", () => {
    const result = jsonSchemaToTypeBox({ type: "integer" }) as Record<string, unknown>;
    expect(result.type).toBe("number");
  });

  it("converts boolean type", () => {
    const result = jsonSchemaToTypeBox({ type: "boolean" }) as Record<string, unknown>;
    expect(result.type).toBe("boolean");
  });

  it("converts object with properties", () => {
    const result = jsonSchemaToTypeBox({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name"],
    }) as Record<string, unknown>;

    expect(result.type).toBe("object");
    const props = result.properties as Record<string, Record<string, unknown>>;
    expect(props.name).toBeTruthy();
    expect(props.age).toBeTruthy();
    // Required fields are direct, optional fields are wrapped
    expect(result.required).toContain("name");
  });

  it("converts empty object", () => {
    const result = jsonSchemaToTypeBox({ type: "object" }) as Record<string, unknown>;
    expect(result.type).toBe("object");
  });

  it("converts array with items", () => {
    const result = jsonSchemaToTypeBox({
      type: "array",
      items: { type: "string" },
    }) as Record<string, unknown>;

    expect(result.type).toBe("array");
    const items = result.items as Record<string, unknown>;
    expect(items.type).toBe("string");
  });

  it("converts array without items to unknown array", () => {
    const result = jsonSchemaToTypeBox({ type: "array" }) as Record<string, unknown>;
    expect(result.type).toBe("array");
  });

  it("passes through unknown types via Type.Unsafe", () => {
    const schema = { type: "custom-type", format: "special" };
    const result = jsonSchemaToTypeBox(schema) as Record<string, unknown>;
    // Type.Unsafe wraps the original schema
    expect(result).toBeTruthy();
  });

  it("handles null/undefined input", () => {
    const result = jsonSchemaToTypeBox(null as unknown as Record<string, unknown>);
    expect(result).toBeTruthy();
  });

  it("handles string enum", () => {
    const result = jsonSchemaToTypeBox({
      type: "string",
      enum: ["a", "b", "c"],
    }) as Record<string, unknown>;
    expect(result.enum).toEqual(["a", "b", "c"]);
  });
});

// ============================================================================
// bridgeMcpTool
// ============================================================================

describe("bridgeMcpTool", () => {
  it("creates a bridged tool with correct fields", () => {
    const result = bridgeMcpTool(
      {
        name: "read_file",
        description: "Read a file from disk",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path" },
          },
          required: ["path"],
        },
      },
      "fs-server",
    );

    expect(result.name).toBe("read_file");
    expect(result.label).toBe("Read File");
    expect(result.description).toBe("Read a file from disk");
    expect(result.serverId).toBe("fs-server");
    expect(result.originalName).toBe("read_file");
    expect(result.parameters).toBeTruthy();
  });

  it("applies prefix to tool name", () => {
    const result = bridgeMcpTool(
      { name: "get_data", description: "Get data" },
      "api-server",
      "api",
    );

    expect(result.name).toBe("api_get_data");
    expect(result.originalName).toBe("get_data");
  });

  it("generates label from name with underscores", () => {
    const result = bridgeMcpTool({ name: "create_new_user" }, "server");

    expect(result.label).toBe("Create New User");
  });

  it("generates label from name with hyphens", () => {
    const result = bridgeMcpTool({ name: "list-all-items" }, "server");

    expect(result.label).toBe("List All Items");
  });

  it("uses fallback description when none provided", () => {
    const result = bridgeMcpTool({ name: "my_tool" }, "my-server");

    expect(result.description).toContain("my_tool");
    expect(result.description).toContain("my-server");
  });

  it("uses empty object schema when no inputSchema", () => {
    const result = bridgeMcpTool({ name: "simple_tool" }, "server");

    expect(result.parameters).toBeTruthy();
    const schema = result.parameters as Record<string, unknown>;
    expect(schema.type).toBe("object");
  });
});
