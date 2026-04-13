/**
 * Unit tests for the review/captcha finder (wcag22:3.3.8, wcag22:3.3.9).
 */

import { describe, expect, it } from "bun:test";
import { finder } from "../../../src/review/finders/captcha.ts";
import { runFinder } from "../../helpers/run-finder.ts";

describe("review/captcha", () => {
  it("flags an import from react-google-recaptcha", () => {
    const source = `import ReCAPTCHA from "react-google-recaptcha";`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("react-google-recaptcha");
  });

  it("flags an import from @hcaptcha/react-hcaptcha", () => {
    const source = `import HCaptcha from "@hcaptcha/react-hcaptcha";`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("@hcaptcha/react-hcaptcha");
  });

  it("flags an import from a Turnstile package", () => {
    const source = `import { Turnstile } from "@marsidev/react-turnstile";`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
  });

  it("flags a CommonJS require of a CAPTCHA package", () => {
    const source = `const ReCAPTCHA = require("react-google-recaptcha");`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
  });

  it("flags a JSX <ReCAPTCHA /> component usage", () => {
    const source = `export const Form = () => <ReCAPTCHA sitekey="key" />;`;
    const out = runFinder(finder, source);
    const reasons = out.map((c) => c.reason).join("\n");
    expect(reasons).toContain("<ReCAPTCHA>");
  });

  it("flags a JSX <Turnstile /> component usage", () => {
    const source = `export const Form = () => <Turnstile siteKey="key" />;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
  });

  it("flags a CAPTCHA vendor host string in raw source", () => {
    const source = `const SCRIPT = "https://www.google.com/recaptcha/api.js";`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("www.google.com/recaptcha");
  });

  it("flags Cloudflare Turnstile vendor host", () => {
    const source = `const URL = "https://challenges.cloudflare.com/turnstile/v0/api.js";`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
  });

  it("flags an HTML <script src> pointing at hCaptcha", () => {
    const source = `<script src="https://js.hcaptcha.com/1/api.js"></script>`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("js.hcaptcha.com");
  });

  it("does not flag non-CAPTCHA imports or components", () => {
    const source = `
      import Button from "@/components/Button";
      export const X = () => <Button label="recaptcha" />;
    `;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("does not flag similarly-named user identifiers", () => {
    const source = `const captchaLabel = "Please verify"; const reCaptchaFlag = false;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("emits one candidate per matching criterion id for both 3.3.8 and 3.3.9", () => {
    const source = `import ReCAPTCHA from "react-google-recaptcha";`;
    const out = runFinder(finder, source);
    const ids = new Set(out.map((c) => c.criterionId));
    expect(ids.has("wcag22:3.3.8")).toBe(true);
    expect(ids.has("wcag22:3.3.9")).toBe(true);
  });

  it("deduplicates same-location duplicate signals", () => {
    const source = `import ReCAPTCHA from "react-google-recaptcha";`;
    const out = runFinder(finder, source);
    const locations = new Set(out.map((c) => `${c.location.line}:${c.location.column}`));
    expect(locations.size).toBe(1);
  });

  it("flags multiple distinct vendor scripts in one file", () => {
    const source = `
      <html>
        <script src="https://www.google.com/recaptcha/api.js"></script>
        <script src="https://js.hcaptcha.com/1/api.js"></script>
      </html>
    `;
    const out = runFinder(finder, source, { filePath: "input.html" });
    const hosts = new Set(
      out.map((c) => c.reason.match(/"([^"]+)"/)?.[1]).filter((v): v is string => Boolean(v)),
    );
    expect(hosts.size).toBeGreaterThanOrEqual(2);
  });
});
