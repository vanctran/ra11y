/**
 * Integration test: MCP server subprocess.
 *
 * Spawns `ra11y --mcp` as a child process and drives it through a
 * realistic agent workflow: initialize → scan → explain → suggest_fix → rescan.
 * Validates the full JSON-RPC protocol round-trip over stdio.
 */

import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const BAD_ALT = join(
  PROJECT_ROOT,
  "tests",
  "fixtures",
  "bad",
  "alt-text-missing",
  "img-no-alt.html",
);

/**
 * Spawns the MCP server, sends a sequence of JSON-RPC messages, and
 * collects all responses. Handles newline-delimited JSON.
 */
async function mcpSession(
  messages: readonly Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const proc = Bun.spawn(["bun", "run", "src/cli.ts", "--mcp"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd: PROJECT_ROOT,
  });

  // Send all messages at once, newline-delimited.
  const payload = `${messages.map((m) => JSON.stringify(m)).join("\n")}\n`;
  proc.stdin.write(payload);
  proc.stdin.end();

  const text = await new Response(proc.stdout).text();
  proc.kill();

  return text
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function toolCall(
  id: number,
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

describe("MCP session: full agent workflow", () => {
  it("initialize → scan → explain_rule → scan_file → configure", async () => {
    const responses = await mcpSession([
      // 1. Initialize
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-agent", version: "1.0" },
        },
      },
      // 2. Notification (no response expected)
      { jsonrpc: "2.0", method: "notifications/initialized" },
      // 3. List tools
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      // 4. Scan the bad fixture
      toolCall(3, "scan", { paths: [BAD_ALT] }),
      // 5. Explain the rule
      toolCall(4, "explain_rule", { ruleId: "media/alt-text-missing" }),
      // 6. Rescan with scan_file
      toolCall(5, "scan_file", { path: BAD_ALT }),
      // 7. Configure session
      toolCall(6, "configure", { standard: "wcag21", level: "AA" }),
      // 8. List rules filtered by standard
      toolCall(7, "list_rules", { standard: "wcag21" }),
    ]);

    // We should get 7 responses (notification has no response).
    expect(responses.length).toBe(7);

    // 1. Initialize response
    const init = responses[0];
    expect(init.id).toBe(1);
    const initResult = init.result as Record<string, unknown>;
    expect(initResult.protocolVersion).toBe("2024-11-05");
    expect((initResult.serverInfo as Record<string, unknown>).name).toBe("ra11y");

    // 2. tools/list response
    const list = responses[1];
    expect(list.id).toBe(2);
    const tools = (list.result as { tools: unknown[] }).tools;
    expect(tools.length).toBe(10);

    // 3. Scan response — should find violations
    const scan = responses[2];
    expect(scan.id).toBe(3);
    const scanResult = (scan.result as { content: Array<{ text: string }> }).content[0];
    const scanData = JSON.parse(scanResult.text) as {
      plan: { totalFindings: number };
      files: Array<{ findings: Array<{ ruleId: string; line: number }> }>;
    };
    expect(scanData.plan.totalFindings).toBeGreaterThan(0);

    // 4. Explain rule response
    const explain = responses[3];
    expect(explain.id).toBe(4);
    const explainResult = (explain.result as { content: Array<{ text: string }> }).content[0];
    const explainData = JSON.parse(explainResult.text) as Record<string, unknown>;
    expect(explainData.id).toBe("media/alt-text-missing");
    expect(typeof explainData.rationale).toBe("string");

    // 5. scan_file response — same findings
    const rescan = responses[4];
    expect(rescan.id).toBe(5);
    const rescanResult = (rescan.result as { content: Array<{ text: string }> }).content[0];
    const rescanData = JSON.parse(rescanResult.text) as {
      findings: Array<{ ruleId: string }>;
    };
    expect(rescanData.findings.length).toBeGreaterThan(0);

    // 6. Configure response
    const configure = responses[5];
    expect(configure.id).toBe(6);
    const configResult = (configure.result as { content: Array<{ text: string }> }).content[0];
    const configData = JSON.parse(configResult.text) as {
      active: { standard: string; level: string };
    };
    expect(configData.active.standard).toBe("wcag21");
    expect(configData.active.level).toBe("AA");

    // 7. List rules (filtered by wcag21)
    const listRules = responses[6];
    expect(listRules.id).toBe(7);
    const listResult = (listRules.result as { content: Array<{ text: string }> }).content[0];
    const listData = JSON.parse(listResult.text) as { rules: unknown[] };
    expect(listData.rules.length).toBeGreaterThan(0);
  });
});
