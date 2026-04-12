import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/media/autoplay-sound.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule media/autoplay-sound", () => {
  describe("HTML: fires when", () => {
    it("audio has autoplay with no muted and no controls", () => {
      const violations = runRule(rule, `<audio autoplay src="bgm.mp3"></audio>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("media/autoplay-sound");
      expect(violations[0]?.severity).toBe("error");
      expect(violations[0]?.message).toContain("<audio autoplay>");
    });

    it("video has autoplay with no muted and no controls", () => {
      const violations = runRule(rule, `<video autoplay src="hero.mp4"></video>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("<video autoplay>");
    });

    it("audio autoplay with a valued attribute still fires", () => {
      const violations = runRule(rule, `<audio autoplay="autoplay" src="bgm.mp3"></audio>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(1);
    });

    it("reports one violation per offending element", () => {
      const violations = runRule(
        rule,
        `<audio autoplay src="a.mp3"></audio><video autoplay src="v.mp4"></video>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(2);
    });
  });

  describe("HTML: does not fire when", () => {
    it("audio is autoplay muted", () => {
      const violations = runRule(rule, `<audio autoplay muted src="bgm.mp3"></audio>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("audio is autoplay with controls", () => {
      const violations = runRule(rule, `<audio autoplay controls src="narration.mp3"></audio>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("video is autoplay muted loop", () => {
      const violations = runRule(
        rule,
        `<video autoplay muted loop><source src="hero.mp4"></video>`,
        { filePath: "index.html" },
      );
      expect(violations).toHaveLength(0);
    });

    it("video has just controls, no autoplay", () => {
      const violations = runRule(rule, `<video controls src="demo.mp4"></video>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("audio has both muted and controls on autoplay", () => {
      const violations = runRule(rule, `<audio autoplay muted controls src="bgm.mp3"></audio>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });

    it("media element has neither autoplay nor anything else", () => {
      const violations = runRule(rule, `<audio src="bgm.mp3"></audio>`, {
        filePath: "index.html",
      });
      expect(violations).toHaveLength(0);
    });
  });

  describe("JSX: fires when", () => {
    it("audio autoplay shorthand with no muted or controls", () => {
      const violations = runRule(rule, `const X = <audio autoplay src="bgm.mp3" />;`);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.severity).toBe("error");
    });

    it("video autoPlay={true} with no muted or controls", () => {
      const violations = runRule(rule, `const X = <video autoplay={true} src="v.mp4" />;`);
      expect(violations).toHaveLength(1);
    });

    it("dynamic expression on autoplay is conservatively treated as present", () => {
      // Accepted false-positive: a runtime expression like {shouldAutoplay}
      // could be either true or false, but assuming it's false silently
      // hides real bugs. We flag it; users can suppress inline.
      const violations = runRule(
        rule,
        `const X = <audio autoplay={shouldAutoplay} src="bgm.mp3" />;`,
      );
      expect(violations).toHaveLength(1);
    });
  });

  describe("JSX: does not fire when", () => {
    it("audio autoplay muted shorthand", () => {
      const violations = runRule(rule, `const X = <audio autoplay muted src="bgm.mp3" />;`);
      expect(violations).toHaveLength(0);
    });

    it("audio autoplay with muted={true}", () => {
      const violations = runRule(rule, `const X = <audio autoplay muted={true} src="bgm.mp3" />;`);
      expect(violations).toHaveLength(0);
    });

    it("audio autoplay controls", () => {
      const violations = runRule(rule, `const X = <audio autoplay controls src="n.mp3" />;`);
      expect(violations).toHaveLength(0);
    });

    it("video autoplay={false} is treated as absent autoplay", () => {
      const violations = runRule(rule, `const X = <video autoplay={false} src="v.mp4" />;`);
      expect(violations).toHaveLength(0);
    });

    it("video with just controls, no autoplay", () => {
      const violations = runRule(rule, `const X = <video controls src="demo.mp4" />;`);
      expect(violations).toHaveLength(0);
    });
  });

  describe("rule metadata", () => {
    it("declares wcag22:1.4.2 and wcag21:1.4.2", () => {
      expect(rule.satisfies).toContain("wcag22:1.4.2");
      expect(rule.satisfies).toContain("wcag21:1.4.2");
    });

    it("is a node-scoped error rule", () => {
      expect(rule.severity).toBe("error");
      expect(rule.scope).toBe("node");
    });

    it("cites the audio-control normative quote", () => {
      expect(rule.docs?.normativeQuote).toContain("audio");
      expect(rule.docs?.normativeQuote).toContain("3 seconds");
    });
  });
});
