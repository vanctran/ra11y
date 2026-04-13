---
title: "media/autoplay-sound"
severity: "error"
scope: "node"
satisfies: ["wcag22:1.4.2", "wcag21:1.4.2"]
---
# `media/autoplay-sound`
- **Severity:** error
- **Scope:** node
- **Satisfies:** `wcag22:1.4.2`, `wcag21:1.4.2`
- **Applies to:** .html, .htm, .tsx, .jsx
## What it checks
<audio> and <video> that autoplay with sound must give the user a mechanism to stop or mute them — either the native controls UI or a muted attribute.
## Why it matters
Audio that starts unexpectedly is disorienting for screen reader users (it competes with the synthesized voice they rely on) and hostile to anyone browsing in a shared space. WCAG 1.4.2 requires a mechanism to pause, stop, or independently control the volume of any audio that plays for more than 3 seconds.
## Normative quote
> If any audio on a Web page plays automatically for more than 3 seconds, either a mechanism is available to pause or stop the audio, or a mechanism is available to control audio volume independently from the overall system volume level.
## Good example
```tsx
<video autoplay muted loop><source src="hero.mp4" type="video/mp4"></video>
```
## Bad example
```tsx
<audio autoplay src="bgm.mp3"></audio>
```
## References
- <https://www.w3.org/TR/WCAG22/#audio-control>
- <https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html>
