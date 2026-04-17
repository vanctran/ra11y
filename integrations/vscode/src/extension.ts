/**
 * ra11y VS Code extension — thin wrapper over the MCP server.
 *
 * What this does today:
 *   - Lazily spawns `ra11y --mcp` as a child process and persists the
 *     MCP session across commands (see {@link Ra11yMcpClient}).
 *   - Registers the `ra11y.scanWorkspace` command (Command Palette →
 *     "ra11y: Scan Workspace") that calls `scan_project` and pushes
 *     findings into the Problems panel as VS Code Diagnostics.
 *   - When `ra11y.scanOnSave` is true (default), re-runs the same scan
 *     after a relevant document is saved. We re-scan the whole
 *     workspace rather than the single file; switching to per-file
 *     `scan_file` is listed in the README as next work.
 *
 * What's explicitly not done (see README):
 *   - Code-action quick fixes (using the MCP `suggest_fix` tool).
 *   - Streaming partial results.
 *   - Packaging for the marketplace (`vsce`), publisher setup,
 *     telemetry, or auth.
 */

import * as path from "node:path";
import * as vscode from "vscode";
import { Ra11yMcpClient } from "./mcp-client";
import type { Ra11yFileEntry, Ra11yFinding, Ra11ySeverity } from "./types";

const DIAGNOSTIC_SOURCE = "ra11y";
/** Extensions the scan + save-watcher react to. Keep in sync with package.json activationEvents. */
const SUPPORTED_EXTS = new Set([".tsx", ".jsx", ".ts", ".js", ".html", ".htm", ".css", ".vue", ".svelte"]);

let client: Ra11yMcpClient | null = null;
let diagnostics: vscode.DiagnosticCollection | null = null;
let output: vscode.OutputChannel | null = null;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("ra11y");
  diagnostics = vscode.languages.createDiagnosticCollection("ra11y");
  context.subscriptions.push(output, diagnostics);

  context.subscriptions.push(
    vscode.commands.registerCommand("ra11y.scanWorkspace", () => runScan(context, "command")),
    vscode.commands.registerCommand("ra11y.restartServer", () => restartServer(context)),
    vscode.workspace.onDidSaveTextDocument((doc) => handleSave(context, doc)),
  );

  output.appendLine("[ra11y] extension activated");
}

export function deactivate(): void {
  if (client !== null) {
    client.dispose();
    client = null;
  }
  if (diagnostics !== null) {
    diagnostics.dispose();
    diagnostics = null;
  }
  output = null;
}

// ─── command handlers ──────────────────────────────────────────────────────

async function handleSave(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("ra11y");
  if (cfg.get<boolean>("scanOnSave", true) !== true) return;
  const ext = path.extname(document.uri.fsPath).toLowerCase();
  if (!SUPPORTED_EXTS.has(ext)) return;
  await runScan(context, "save");
}

async function restartServer(context: vscode.ExtensionContext): Promise<void> {
  if (client !== null) {
    client.dispose();
    client = null;
  }
  getOutput().appendLine("[ra11y] server stopped; will relaunch on next scan");
  await runScan(context, "restart");
}

async function runScan(context: vscode.ExtensionContext, trigger: string): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder === undefined) {
    void vscode.window.showWarningMessage("ra11y: open a workspace folder before scanning.");
    return;
  }
  const cfg = vscode.workspace.getConfiguration("ra11y");
  const c = getClient(context, folder.uri.fsPath);
  const startedAt = Date.now();
  try {
    const response = await c.scanProject({
      cwd: folder.uri.fsPath,
      standard: cfg.get<string>("standard", "wcag22"),
      level: cfg.get<"A" | "AA" | "AAA">("level", "AA"),
      minSeverity: cfg.get<"error" | "warning" | "info">("minSeverity", "info"),
      additionalPaths: cfg.get<readonly string[]>("additionalPaths", []),
    });
    applyDiagnostics(folder.uri.fsPath, response.files);
    const elapsed = Date.now() - startedAt;
    getOutput().appendLine(
      `[ra11y] scan (${trigger}) complete in ${elapsed}ms: ${response.plan.summary ?? "no summary"}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    getOutput().appendLine(`[ra11y] scan failed: ${message}`);
    void vscode.window.showErrorMessage(`ra11y scan failed: ${message}`);
  }
}

// ─── diagnostics plumbing ──────────────────────────────────────────────────

/**
 * Replaces the extension's diagnostic set with the latest scan
 * findings. URIs are rebuilt from the scanner's file paths (which may
 * be relative to the workspace root — we resolve against {@link rootFs}
 * to make them absolute before asking VS Code for a URI).
 */
function applyDiagnostics(rootFs: string, files: readonly Ra11yFileEntry[]): void {
  const col = diagnostics;
  if (col === null) return;
  col.clear();
  for (const file of files) {
    const abs = path.isAbsolute(file.path) ? file.path : path.join(rootFs, file.path);
    const uri = vscode.Uri.file(abs);
    const items = file.findings.map((f) => toDiagnostic(f));
    col.set(uri, items);
  }
}

function toDiagnostic(finding: Ra11yFinding): vscode.Diagnostic {
  // ra11y emits 1-based line/column; VS Code ranges are 0-based.
  // We don't get an end column from the wire shape today — highlight
  // the single character at the reported position and let the message
  // carry the rest. A future revision can plumb endLine/endColumn
  // through the finding formatter.
  const line = Math.max(0, finding.line - 1);
  const column = Math.max(0, finding.column - 1);
  const range = new vscode.Range(line, column, line, column + 1);
  const diag = new vscode.Diagnostic(range, buildMessage(finding), toVsSeverity(finding.severity));
  diag.source = DIAGNOSTIC_SOURCE;
  diag.code = finding.ruleId;
  return diag;
}

function buildMessage(finding: Ra11yFinding): string {
  const base = finding.message;
  const fix = finding.fix !== undefined && finding.fix.length > 0 ? ` Fix: ${finding.fix}` : "";
  const crit = finding.criteria.length > 0 ? ` [${finding.criteria.join(", ")}]` : "";
  return `${base}${fix}${crit}`;
}

function toVsSeverity(severity: Ra11ySeverity): vscode.DiagnosticSeverity {
  if (severity === "error") return vscode.DiagnosticSeverity.Error;
  if (severity === "warning") return vscode.DiagnosticSeverity.Warning;
  return vscode.DiagnosticSeverity.Information;
}

// ─── lifecycle helpers ─────────────────────────────────────────────────────

function getClient(context: vscode.ExtensionContext, cwd: string): Ra11yMcpClient {
  if (client !== null) return client;
  const cfg = vscode.workspace.getConfiguration("ra11y");
  const command = cfg.get<string>("command", "ra11y");
  client = new Ra11yMcpClient({
    command,
    cwd,
    output: getOutput(),
  });
  context.subscriptions.push({ dispose: () => client?.dispose() });
  return client;
}

function getOutput(): vscode.OutputChannel {
  if (output === null) {
    output = vscode.window.createOutputChannel("ra11y");
  }
  return output;
}
