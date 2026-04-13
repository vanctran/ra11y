---
title: "media/video-captions-missing"
severity: "warning"
scope: "node"
satisfies: ["wcag22:1.2.2", "wcag21:1.2.2"]
---
# `media/video-captions-missing`
- **Severity:** warning
- **Scope:** node
- **Satisfies:** `wcag22:1.2.2`, `wcag21:1.2.2`
- **Applies to:** .html, .htm, .tsx, .jsx
## What it checks
<video> elements with audio content need a <track kind='captions'> child so deaf and hard-of-hearing users can follow the dialogue.
## Why it matters
Captions are the minimum accessible representation of spoken content in prerecorded video. Without them, deaf users are locked out of the information — and in contexts where sound is off by default (social feeds, waiting rooms, open-plan offices) captions also benefit hearing users.
## Normative quote
> Captions are provided for all prerecorded audio content in synchronized media.
## Good example
```tsx
<video src="launch.mp4" controls><track kind="captions" src="launch.vtt" srclang="en" label="English"></video>
```
## Bad example
```tsx
<video src="launch.mp4" controls></video>
```
## References
- <https://www.w3.org/TR/WCAG22/#captions-prerecorded>
- <https://www.w3.org/WAI/media/av/captions/>
