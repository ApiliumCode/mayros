import { describe, it, expect } from "vitest";
import { maskSensitiveOutput, isSensitivePath, listMaskPatternNames } from "./output-masking.js";

describe("Output Masking", () => {
  // 1
  it("masks AWS access key IDs", () => {
    const result = maskSensitiveOutput("key=AKIAIOSFODNN7EXAMPLE");
    expect(result.masked).toBe(true);
    expect(result.text).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result.text).toContain("AKIA***REDACTED***");
  });

  // 2
  it("masks GitHub personal access tokens", () => {
    const result = maskSensitiveOutput("token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij");
    expect(result.masked).toBe(true);
    expect(result.text).toContain("ghp_***REDACTED***");
  });

  // 3
  it("masks OpenAI API keys", () => {
    const result = maskSensitiveOutput("OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz");
    expect(result.masked).toBe(true);
    expect(result.text).toContain("sk-***REDACTED***");
  });

  // 4
  it("masks Slack tokens", () => {
    const result = maskSensitiveOutput("xoxb-FAKEFAKEFAKE-FAKEFAKE");
    expect(result.masked).toBe(true);
    expect(result.text).toContain("xox?-***REDACTED***");
  });

  // 5
  it("masks private keys", () => {
    const key =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----";
    const result = maskSensitiveOutput(key);
    expect(result.masked).toBe(true);
    expect(result.text).not.toContain("MIIEowIBAAKCAQEA");
  });

  // 6
  it("masks password in connection strings", () => {
    const result = maskSensitiveOutput("postgres://user:supersecretpwd@localhost:5432/db");
    expect(result.masked).toBe(true);
    expect(result.text).not.toContain("supersecretpwd");
  });

  // 7
  it("does not mask normal text", () => {
    const result = maskSensitiveOutput("Hello world, this is normal text");
    expect(result.masked).toBe(false);
    expect(result.redactions).toBe(0);
    expect(result.text).toBe("Hello world, this is normal text");
  });

  // 8
  it("counts multiple redactions", () => {
    const text = "keys: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij and sk-testkey1234567890abcdef";
    const result = maskSensitiveOutput(text);
    expect(result.redactions).toBeGreaterThanOrEqual(2);
  });

  // 9
  it("masks npm tokens", () => {
    const result = maskSensitiveOutput(
      "//registry.npmjs.org/:_authToken=npm_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
    );
    expect(result.masked).toBe(true);
    expect(result.text).toContain("npm_***REDACTED***");
  });

  // 10
  it("isSensitivePath detects .env files", () => {
    expect(isSensitivePath(".env")).toBe(true);
    expect(isSensitivePath(".env.local")).toBe(true);
    expect(isSensitivePath("src/.env.production")).toBe(true);
    expect(isSensitivePath("config/credentials.json")).toBe(true);
    expect(isSensitivePath("~/.ssh/id_rsa")).toBe(true);
  });

  // 11
  it("isSensitivePath does not flag normal files", () => {
    expect(isSensitivePath("src/app.ts")).toBe(false);
    expect(isSensitivePath("README.md")).toBe(false);
    expect(isSensitivePath("package.json")).toBe(false);
  });

  // 12
  it("listMaskPatternNames returns array of names", () => {
    const names = listMaskPatternNames();
    expect(Array.isArray(names)).toBe(true);
    expect(names.length).toBeGreaterThan(5);
    expect(names).toContain("github-token");
    expect(names).toContain("openai-key");
    expect(names).toContain("private-key");
  });

  // 13
  it("masks GitLab tokens", () => {
    const result = maskSensitiveOutput("GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx");
    expect(result.masked).toBe(true);
    expect(result.text).toContain("glpat-***REDACTED***");
  });

  // 14
  it("masks Bearer tokens in headers", () => {
    const result = maskSensitiveOutput(
      "Authorization: Bearer FAKEJWTHEADERFAKEFAKEFAKEFAKEFAKEFAKE.payload.signature",
    );
    expect(result.masked).toBe(true);
    expect(result.text).not.toContain("FAKEJWTHEADERFAKEFAKEFAKEFAKEFAKEFAKE");
  });

  // 15
  it("masks password fields in config", () => {
    const result = maskSensitiveOutput('password: "FAKE_test_password_123"');
    expect(result.masked).toBe(true);
    expect(result.text).not.toContain("FAKE_test_password_123");
  });

  // 16
  it("masks Stripe live keys", () => {
    const result = maskSensitiveOutput("STRIPE_KEY=sk_live_NOTREALFORTESTINGXXYYZZAA");
    expect(result.masked).toBe(true);
    expect(result.text).toContain("***REDACTED_STRIPE***");
    expect(result.text).not.toContain("sk_live_NOTREALFORTESTINGXXYYZZAA");
  });

  // 17
  it("masks SendGrid API keys", () => {
    const result = maskSensitiveOutput("SG.FAKEFAKEFAKEFAKEFAKEFK.FAKEFAKEFAKEFAKEFAKEFK1234");
    expect(result.masked).toBe(true);
    expect(result.text).toContain("SG.***REDACTED***");
  });

  // 18
  it("masks Azure storage account keys", () => {
    const result = maskSensitiveOutput(
      "AccountKey=FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE+/==",
    );
    expect(result.masked).toBe(true);
    expect(result.text).toContain("AccountKey=***REDACTED***");
  });

  // 19
  it("masks Discord bot tokens", () => {
    const token = "FAKEFAKEFAKEFAKEFAKEFAKEFK.FAKEfk.FAKEFAKEFAKEFAKEFAKEFAKEFAKEfak";
    const result = maskSensitiveOutput(`DISCORD_TOKEN=${token}`);
    expect(result.masked).toBe(true);
    expect(result.text).toContain("***REDACTED_DISCORD***");
  });

  // 20
  it("masks JWT tokens", () => {
    // Realistic JWT header + payload + signature
    const header = "eyJGQUtFIjoiRkFLRSIsInR5cCI6IkZBS0UifQFAKEFAKEFAKEFAKEFAKEFAKE";
    const payload = "eyJGQUtFIjoiRkFLRSIsIm5hbWUiOiJGQUtFIiwiaWF0IjowfQFAKEFAKEFAKEFAKE";
    const sig = "FAKEFAKEFAKEFAKEFAKEFAKE";
    const jwt = `${header}.${payload}.${sig}`;
    const result = maskSensitiveOutput(`Authorization: ${jwt}`);
    expect(result.masked).toBe(true);
    expect(result.text).toContain("***REDACTED_JWT***");
  });
});
