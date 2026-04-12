/**
 * Rule: semantics/table-headers
 * Satisfies: wcag22:1.3.1, wcag21:1.3.1
 * Spec: https://www.w3.org/TR/WCAG22/#info-and-relationships
 *
 * > Information, structure, and relationships conveyed through
 * > presentation can be programmatically determined or are available
 * > in text.
 *
 * Source: https://www.w3.org/TR/WCAG22/#info-and-relationships
 *
 * Flags data tables that have one or more `<td>` cells but no `<th>`
 * header cells. Header cells are the mechanism by which screen readers
 * announce column/row context for each data cell — "Price, $50" rather
 * than just "$50". A data table with no `<th>` is a named data
 * structure with no labels.
 *
 * Excluded from the check (handled as layout or empty scaffolding):
 *   - Tables with `role="presentation"` or `role="none"` — explicitly
 *     layout tables.
 *   - Tables with zero `<td>` descendants — probably empty/decorative
 *     scaffolding, or a structure holding other content.
 *
 * Nested tables are evaluated independently. When counting cells for a
 * given `<table>`, descent stops at child `<table>` elements so each
 * table is judged on its own cells, not its nested descendants'.
 *
 * Severity is `warning`, not `error`: ra11y can't always tell a
 * one-row caption layout from a real data table, so we surface the
 * concern for human review instead of hard-failing the scan.
 */

import { defineRule } from "../../api/plugin.ts";
import {
  findHtmlElementsByTag,
  findJsxElementsByTag,
  getHtmlAttribute,
  getJsxAttributeString,
} from "../../engine/ast-helpers.ts";
import type {
  HtmlDocument,
  HtmlElement,
  HtmlNode,
  JsxElement,
  JsxNode,
  TsxModule,
} from "../../types/ast.ts";

export const rule = defineRule({
  id: "semantics/table-headers",
  satisfies: ["wcag22:1.3.1", "wcag21:1.3.1"],
  severity: "warning",
  scope: "node",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".tsx", ".jsx"],
  },
  docs: {
    description:
      "Data tables must have <th> header cells so screen readers can announce column or row context for each data cell. A <table> with <td> cells but no <th> is flagged.",
    rationale:
      "Screen readers associate each <td> with its corresponding <th> and announce the header before (or alongside) the cell value, producing 'Price, $50' instead of just '$50'. Without <th>, the table is a named data structure with no labels — non-sighted users get a stream of values with no context. If the table is for visual layout only, mark it explicitly with role='presentation'.",
    goodExample: `<table>\n  <thead><tr><th scope="col">Product</th><th scope="col">Price</th></tr></thead>\n  <tbody><tr><td>Widget</td><td>$50</td></tr></tbody>\n</table>`,
    badExample: `<table>\n  <tr><td>Product</td><td>Price</td></tr>\n  <tr><td>Widget</td><td>$50</td></tr>\n</table>`,
    normativeQuote:
      "Information, structure, and relationships conveyed through presentation can be programmatically determined or are available in text.",
    references: [
      "https://www.w3.org/TR/WCAG22/#info-and-relationships",
      "https://www.w3.org/WAI/tutorials/tables/",
      "https://www.w3.org/WAI/tutorials/tables/two-headers/",
    ],
  },
  check(ctx) {
    if (ctx.language === "html") {
      checkHtml(ctx.ast as HtmlDocument, (v) => ctx.emit(v));
      return;
    }
    if (
      ctx.language === "tsx" ||
      ctx.language === "jsx" ||
      ctx.language === "ts" ||
      ctx.language === "js"
    ) {
      checkJsx(ctx.ast as TsxModule, (v) => ctx.emit(v));
    }
  },
});

type Emit = (v: {
  severity: "error" | "warning" | "info";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
}) => void;

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function checkHtml(doc: HtmlDocument, emit: Emit): void {
  for (const table of findHtmlElementsByTag(doc, "table")) {
    if (isLayoutHtmlTable(table)) continue;
    const counts = countHtmlCells(table);
    if (counts.td === 0) continue;
    if (counts.th > 0) continue;
    emit(buildHtmlViolation(table, counts.td));
  }
}

function isLayoutHtmlTable(table: HtmlElement): boolean {
  const role = getHtmlAttribute(table, "role");
  if (role === null) return false;
  const lowered = role.toLowerCase();
  return lowered === "presentation" || lowered === "none";
}

interface CellCounts {
  readonly th: number;
  readonly td: number;
}

function countHtmlCells(table: HtmlElement): CellCounts {
  let th = 0;
  let td = 0;
  const visit = (node: HtmlNode): void => {
    if (node.kind !== "HtmlElement") return;
    const tag = node.tagName.toLowerCase();
    // Stop at nested tables so each table is judged on its own cells.
    if (tag === "table") return;
    if (tag === "th") th += 1;
    else if (tag === "td") td += 1;
    for (const child of node.children) visit(child);
  };
  for (const child of table.children) visit(child);
  return { th, td };
}

function buildHtmlViolation(
  table: HtmlElement,
  tdCount: number,
): {
  severity: "warning";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
} {
  return {
    severity: "warning",
    location: {
      filePath: "",
      line: table.loc.start.line,
      column: table.loc.start.column,
    },
    message: `<table> has ${tdCount} <td> cell${tdCount === 1 ? "" : "s"} but no <th> header cells — screen readers will announce each value with no column or row context.`,
    suggestion:
      'Add <th scope="col"> cells in the first <tr> (or wrap them in <thead>) so each column is labeled. For a row-keyed table, use <th scope="row"> as the first cell of each row. If this <table> is purely for visual layout, mark it with role="presentation" instead.',
  };
}

// ---------------------------------------------------------------------------
// JSX
// ---------------------------------------------------------------------------

function checkJsx(module: TsxModule, emit: Emit): void {
  for (const table of findJsxElementsByTag(module, "table")) {
    if (isLayoutJsxTable(table)) continue;
    const counts = countJsxCells(table);
    if (counts.td === 0) continue;
    if (counts.th > 0) continue;
    emit(buildJsxViolation(table, counts.td));
  }
}

function isLayoutJsxTable(table: JsxElement): boolean {
  const role = getJsxAttributeString(table, "role");
  if (role === null) return false;
  return role === "presentation" || role === "none";
}

function countJsxCells(table: JsxElement): CellCounts {
  let th = 0;
  let td = 0;
  const visit = (node: JsxNode): void => {
    if (node.kind !== "JsxElement") return;
    const tag = node.tagName;
    if (tag === "table") return;
    if (tag === "th") th += 1;
    else if (tag === "td") td += 1;
    for (const child of node.children) visit(child);
  };
  for (const child of table.children) visit(child);
  return { th, td };
}

function buildJsxViolation(
  table: JsxElement,
  tdCount: number,
): {
  severity: "warning";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
} {
  return {
    severity: "warning",
    location: {
      filePath: "",
      line: table.loc.start.line,
      column: table.loc.start.column,
    },
    message: `<table> has ${tdCount} <td> cell${tdCount === 1 ? "" : "s"} but no <th> header cells — screen readers will announce each value with no column or row context.`,
    suggestion:
      'Add <th scope="col"> cells in the first <tr> (or wrap them in <thead>) so each column is labeled. For a row-keyed table, use <th scope="row"> as the first cell of each row. If this <table> is purely for visual layout, mark it with role="presentation" instead.',
  };
}
