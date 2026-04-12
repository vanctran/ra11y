import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/media/video-captions-missing.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule media/video-captions-missing", () => {
  describe("HTML: fires when", () => {
    it("video has no track child", () => {
      const violations = runRule(rule, `<video src="launch.mp4" controls></video>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("media/video-captions-missing");
      expect(violations[0]?.severity).toBe("warning");
    });

    it("video has only a descriptions track, no captions", () => {
      const violations = runRule(
        rule,
        `<video src="x.mp4"><track kind="descriptions" src="x.vtt"></video>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(1);
    });

    it("video has a chapters track, no captions", () => {
      const violations = runRule(
        rule,
        `<video src="x.mp4"><track kind="chapters" src="x.vtt"></video>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(1);
    });
  });

  describe("HTML: does not fire when", () => {
    it("video has a captions track", () => {
      const violations = runRule(
        rule,
        `<video src="x.mp4"><track kind="captions" src="x.vtt" srclang="en"></video>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it("video has a subtitles track (treated equivalently)", () => {
      const violations = runRule(
        rule,
        `<video src="x.mp4"><track kind="subtitles" src="x.vtt" srclang="es"></video>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it("video is explicitly aria-hidden", () => {
      const violations = runRule(rule, `<video src="x.mp4" aria-hidden="true"></video>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });
  });

  describe("JSX: fires when", () => {
    it("video has no track child", () => {
      const violations = runRule(rule, `const X = <video src="x.mp4" controls />;`);
      expect(violations).toHaveLength(1);
    });
  });

  describe("JSX: does not fire when", () => {
    it("video has a captions track", () => {
      const violations = runRule(
        rule,
        `const X = <video src="x.mp4"><track kind="captions" src="x.vtt" /></video>;`,
      );
      expect(violations).toHaveLength(0);
    });
  });

  describe("rule metadata", () => {
    it("declares wcag22:1.2.2 and wcag21:1.2.2", () => {
      expect(rule.satisfies).toContain("wcag22:1.2.2");
      expect(rule.satisfies).toContain("wcag21:1.2.2");
    });
  });
});
