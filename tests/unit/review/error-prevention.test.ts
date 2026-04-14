/**
 * Unit tests for the review/error-prevention finder (wcag22:3.3.4).
 */

import { describe, expect, it } from "bun:test";
import { finder } from "../../../src/review/finders/error-prevention.ts";
import { runFinder } from "../../helpers/run-finder.ts";

describe("review/error-prevention", () => {
  it("flags an HTML checkout form with no confirmation signal", () => {
    const source = `<form id="checkout"><input name="cc" /><button type="submit">Pay</button></form>`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out.length).toBeGreaterThan(0);
  });

  it("flags a JSX payment form with no confirmation signal", () => {
    const source = `const x = <form className="payment-form"><button type="submit">Submit</button></form>;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
  });

  it("flags a JSX form whose name references a destructive action", () => {
    const source = `const x = <form name="delete-account"><button type="submit">Delete</button></form>;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
  });

  it("does not flag when the file has a consent checkbox", () => {
    const source = `const x = <div><form id="checkout"><input type="checkbox" name="accept-terms" /><button type="submit">Pay</button></form></div>;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("does not flag when the file has a review-style submit button", () => {
    const source = `const x = <form id="payment"><button type="submit">Review order</button></form>;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("does not flag when onSubmit invokes confirm()", () => {
    const source = `const x = <form name="subscribe" onSubmit={(e) => { if (!confirm('Sure?')) e.preventDefault(); }}><button type="submit">Subscribe</button></form>;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("does not flag a generic contact form", () => {
    const source = `const x = <form id="contact-us"><input name="message" /><button type="submit">Send</button></form>;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("does not flag a layout utility class like order-1", () => {
    const source = `const x = <form className="order-1 flex"><input name="q" /><button type="submit">Go</button></form>;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("emits candidates across all four covered standards", () => {
    const source = `const x = <form id="checkout"><button type="submit">Pay</button></form>;`;
    const out = runFinder(finder, source);
    const ids = new Set(out.map((c) => c.criterionId));
    expect(ids.has("wcag22:3.3.4")).toBe(true);
    expect(ids.has("wcag21:3.3.4")).toBe(true);
    expect(ids.has("section508:3.3.4")).toBe(true);
    expect(ids.has("en301549:9.3.3.4")).toBe(true);
  });
});
