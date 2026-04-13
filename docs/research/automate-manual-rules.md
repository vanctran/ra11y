# Automating manual-only WCAG criteria

**Branch:** `research/automate-manual-rules`
**Date:** 2026-04-13
**Revision:** 2 — §§1, 2, 3 partially superseded by §6 after two independent reviews. Read §6 first.
**Scope:** every WCAG 2.2 criterion classified `automatable: "manual"` in `src/standards/wcag-shared/rows.ts` and `src/standards/wcag22/criteria.ts` (53 criteria total). Equivalent criteria in WCAG 2.1, Section 508, and EN 301 549 are covered by the same finders via the registry's reciprocal index.

This is a **survey**, not an implementation. For each criterion it proposes a candidate static signal, judges feasibility, and assigns confidence and effort. Implementation should follow per-criterion, gated on real-world fixtures (see §5 and §6).

---

## 1. The architectural answer is already here

ra11y already distinguishes two contracts:

- **Rule** → emits `Violation[]`. Pass/fail. Used when the spec failure is statically decidable (alt missing, lang missing, contrast computable).
- **CandidateFinder** → emits `ReviewCandidate[]`. *Surfaces needles*, makes no pass/fail claim, biased toward false positives. The reviewer makes the call. Defined in `src/types/review.ts`; six finders live in `src/review/finders/`.

For manual criteria, the question is never "can we write a Rule" (the answer is no — that's why they're manual). The question is **"can we write a CandidateFinder that meaningfully shrinks the surface a reviewer must inspect?"**

A finder is worth shipping when it:
1. Has **high recall** on the criterion's failure modes (we'd rather over-flag than miss),
2. Has a **bounded false-positive rate** so the reviewer isn't drowned, and
3. Surfaces **specific locations** (file:line) so the review prompt is actionable.

A finder is *not* worth shipping when:
- The signal is `everything` (e.g., 2.4.5 Multiple Ways: every page is in scope; flagging every page = no signal),
- The signal is `nothing` (e.g., 1.2.x media — JSX `<video>` exists, but transcript existence is invisible to a static scan unless we encode conventions),
- The reviewer's task per location is identical to the reviewer's task without the finder (no shrink).

Six finders exist today (`meaningful-sequence`, `media-alternatives`, `no-keyboard-trap`, `on-input-change`, `sensory-characteristics`, `use-of-color`). They cover ~14 of the 53 manual criteria via reciprocal mapping.

---

## 2. Per-criterion analysis

Verdict legend:

- ✅ **Build a finder** — clear signal, finder will pay for itself.
- 🟡 **Build with caveats** — signal exists but is weak, noisy, or covers only a subset; ship with a conservative threshold.
- 🟥 **Leave manual** — no useful static signal, or signal would generate so much noise it harms the reviewer.
- 🟦 **Already covered** — existing finder addresses this criterion.

Confidence: H = high, M = medium, L = low. Effort: S = ≤1 day, M = 2–5 days (research + fixtures + finder + tests), L = >5 days or research dependency.

### Principle 1 — Perceivable

| ID | Title | Verdict | Existing finder | Proposed signal | Conf | Effort |
|----|-------|---------|-----------------|-----------------|------|--------|
| 1.2.1 | Audio-only / Video-only (Prerecorded) | 🟦 | `media-alternatives` | `<audio>`, `<video>`, common embed iframes (YouTube, Vimeo, Loom, Wistia hosts) | H | — |
| 1.2.3 | Audio Description / Media Alt | 🟦 | `media-alternatives` | same `<video>` set; emit candidate per video element | H | — |
| 1.2.4 | Captions (Live) | 🟡 | `media-alternatives` (extend) | `<video>` whose `src` matches live-stream patterns (`.m3u8`, `mediaLive`, `livestream`, Twitch/YouTube live URLs); WebRTC peer connection nodes | M | M |
| 1.2.5 | Audio Description (Prerecorded) | 🟦 | `media-alternatives` | every `<video>` is a candidate unless it carries `<track kind="descriptions">` | H | — |
| 1.2.6 | Sign Language | 🟦 | `media-alternatives` | every `<video>` is a candidate (no static signal of sign language presence) | M | — |
| 1.2.7 | Extended Audio Description | 🟦 | `media-alternatives` | same as 1.2.5 | M | — |
| 1.2.8 | Media Alternative (Prerecorded) | 🟦 | `media-alternatives` | same as 1.2.1 | M | — |
| 1.2.9 | Audio-only (Live) | 🟡 | `media-alternatives` (extend) | `<audio>` whose `src` matches live-stream patterns | L | M |
| 1.3.2 | Meaningful Sequence | 🟦 | `meaningful-sequence` | CSS `flex-direction: row-reverse`, `order:`, `direction: rtl`, `position: absolute` siblings — already covered | M | — |
| 1.3.3 | Sensory Characteristics | 🟦 | `sensory-characteristics` | text matching `/the (red|green|left|right|top|bottom|round) (button\|icon\|panel)/i`, "click here", "see above" — already covered | M | — |
| 1.3.6 | Identify Purpose | 🟥 | — | requires personalization metadata (microdata, ARIA 1.2 purpose tokens). Almost no real-world adoption — flagging every page would drown the reviewer | L | L |
| 1.4.1 | Use of Color | 🟦 | `use-of-color` | className with status color (red/green/warn) + no icon/text/aria-label — already covered | M | — |
| 1.4.5 | Images of Text | ✅ | — | `<img src>` matching `*.{png,jpg,gif,webp,svg}` with filename or alt text containing word patterns (`-text`, `-banner`, `-quote`, `-headline`); SVG `<text>` elements as candidates | M | M |
| 1.4.7 | Low/No Background Audio | 🟥 | — | acoustic property — invisible to static scan | H | — |
| 1.4.8 | Visual Presentation | 🟡 | — | CSS `text-align: justify`, fixed `width:` on text containers, `line-height` < 1.5 on `<p>`/`<article>` text | L | M |
| 1.4.9 | Images of Text (No Exception) | ✅ | — | same finder as 1.4.5; AAA threshold = same locations, different criterion ID | M | — |

### Principle 2 — Operable

| ID | Title | Verdict | Existing finder | Proposed signal | Conf | Effort |
|----|-------|---------|-----------------|-----------------|------|--------|
| 2.1.2 | No Keyboard Trap | 🟦 | `no-keyboard-trap` | `e.preventDefault()` in `keydown`/`keypress` handler that captures Tab; focus-trap libraries; modal components without escape handlers | M | — |
| 2.1.3 | Keyboard (No Exception) | 🟦 | `no-keyboard-trap` | superset of 2.1.2 — same finder serves both | M | — |
| 2.2.1 | Timing Adjustable | ✅ | — | `setTimeout`/`setInterval` with `>= 20000ms`, `Date.now()` countdown patterns, `<meta http-equiv="refresh">` | H | M |
| 2.2.3 | No Timing | ✅ | — | superset of 2.2.1; same finder, AAA criterion ID | H | — |
| 2.2.4 | Interruptions | 🟡 | — | `Notification.requestPermission`, `alert(`, modal libraries used outside event handlers (auto-firing), WebSocket `onmessage` triggering UI changes | L | M |
| 2.2.5 | Re-authenticating | 🟥 | — | session-handling lives at the framework/server layer; almost nothing in the rendered output | L | — |
| 2.2.6 | Timeouts | ✅ | — | same signal as 2.2.1, gated on session/idle keywords (`idleTimeout`, `sessionTimeout`, `logout`, `signOut`) | M | M |
| 2.3.1 | Three Flashes or Below Threshold | ✅ | — | CSS `@keyframes` whose name matches `flash\|blink\|strobe` or whose body alternates `opacity` 3+ times under 1s; `animation-iteration-count: infinite` with short duration | M | M |
| 2.3.2 | Three Flashes (AAA) | ✅ | — | same finder as 2.3.1, stricter criterion ID | M | — |
| 2.4.5 | Multiple Ways | 🟥 | — | "is a sitemap, search, or navigation present at the site level?" — needs cross-page index, beyond per-file scope. Could become a project-scope finder later | L | L |
| 2.4.8 | Location | 🟡 | — | `<nav>` / `aria-current="page"` / breadcrumb patterns missing on routes — needs project-level info | L | L |
| 2.4.10 | Section Headings | 🟡 | — | `<section>` / `<article>` without an `<h*>` child → candidate ("does this section need a heading?") | M | S |
| 2.5.1 | Pointer Gestures | ✅ | — | event handlers for `pointermove`+`pointerdown` combined, `touchmove`, `gesturestart`, swipe libraries (`react-swipeable`, `hammerjs`, `react-use-gesture`); `wheel` listeners | H | M |
| 2.5.4 | Motion Actuation | ✅ | — | `DeviceMotionEvent`, `DeviceOrientationEvent`, `addEventListener('devicemotion'\|'deviceorientation'\|'shake')` | H | S |
| 2.5.6 | Concurrent Input Mechanisms | 🟥 | — | restriction is "the app refuses input modality X" — invisible to static scan | M | — |
| 2.4.11 | Focus Not Obscured (Min) | 🟡 | — | CSS `position: sticky\|fixed` on header/footer/dialog without `:focus-within` adjustment → candidate. Many false positives, but the failure mode is real | M | M |
| 2.4.12 | Focus Not Obscured (Enh) | 🟡 | — | same as 2.4.11, stricter criterion ID | M | — |
| 2.4.13 | Focus Appearance | 🟡 | — | CSS `:focus { outline: none }` without compensating `box-shadow`/`outline` on `:focus-visible` — partial overlap with existing focus rules. Expand to flag custom focus styles whose contrast vs background is < 3:1 (computable when colors are static) | M | M |

### Principle 3 — Understandable

| ID | Title | Verdict | Existing finder | Proposed signal | Conf | Effort |
|----|-------|---------|-----------------|-----------------|------|--------|
| 3.1.3 | Unusual Words | 🟥 | — | requires NLP / dictionary lookup; "unusual" is per-domain. Out of scope for a zero-dep static scanner | H | — |
| 3.1.4 | Abbreviations | 🟡 | — | regex for `\b[A-Z]{2,5}\b` in JSX/HTML text content not wrapped in `<abbr>` | L | S |
| 3.1.5 | Reading Level | 🟥 | — | NLP/statistical model required (Flesch-Kincaid). Out of scope | H | — |
| 3.1.6 | Pronunciation | 🟥 | — | invisible to static scan | H | — |
| 3.2.1 | On Focus | 🟦 | `on-input-change` | `onFocus` handlers calling `navigate`/`router.push`/`location.assign`/`form.submit`/`window.open` — already covered | M | — |
| 3.2.2 | On Input | 🟦 | `on-input-change` | `onChange` on inputs/selects calling `navigate`/`submit`/`window.open` — already covered | M | — |
| 3.2.3 | Consistent Navigation | 🟥 | — | requires comparing `<nav>` order across multiple pages — project-scope, beyond current per-file finders | M | L |
| 3.2.4 | Consistent Identification | 🟥 | — | requires cross-page comparison of component labels — project-scope | M | L |
| 3.2.5 | Change on Request | 🟡 | — | superset of 3.2.1+3.2.2, plus auto-firing `useEffect` with navigation — extend `on-input-change` finder | M | S |
| 3.2.6 | Consistent Help (new in 2.2) | 🟥 | — | requires cross-page comparison of help affordance position — project-scope | M | L |
| 3.3.1 | Error Identification | ✅ | — | form components (`<form>`, `<input required>`, react-hook-form, formik) without an `aria-describedby` linking to an error region; error-state classes (`is-invalid`, `error`) without role="alert" or aria-live | M | M |
| 3.3.3 | Error Suggestion | 🟡 | — | superset of 3.3.1; reviewer also checks suggestion presence, finder can't help further | L | — |
| 3.3.4 | Error Prevention (Legal/Financial) | 🟡 | — | forms with `<input type="submit">` whose action URL/handler matches `/checkout\|payment\|delete\|cancel\|transfer/` and no confirmation step (no second submit, no modal between) | L | M |
| 3.3.5 | Help | 🟥 | — | "is help available" — every form is a candidate; no shrink | L | — |
| 3.3.6 | Error Prevention (All) | 🟡 | — | superset of 3.3.4 with looser action filter | L | M |
| 3.3.7 | Redundant Entry (new in 2.2) | 🟡 | — | multi-step forms (`<form>` with `step` state, wizard libraries) where the same field name appears on multiple steps without a default value → flag the second occurrence | M | M |
| 3.3.8 | Accessible Authentication (Min) (new in 2.2) | ✅ | — | `<input type="password">` siblings of CAPTCHA components (`reCAPTCHA`, `hcaptcha`, `turnstile`), puzzle-image components, "type the characters you see" copy patterns | H | S |
| 3.3.9 | Accessible Authentication (Enh) | ✅ | — | same finder as 3.3.8 | H | — |

### Principle 4 — Robust

| ID | Title | Verdict | Existing finder | Proposed signal | Conf | Effort |
|----|-------|---------|-----------------|-----------------|------|--------|
| 4.1.1 | Parsing (obsolete in 2.2) | 🟥 | — | obsolete; do not invest | H | — |

---

## 3. Recommended build order

Sorted by **value × confidence ÷ effort**. Each item is a single new CandidateFinder unless noted.

### Tier 1 — ship next (high confidence, small surface, real failure mode)

1. **`review/timing` — covers 2.2.1, 2.2.3, 2.2.6.** Signal: `setTimeout`/`setInterval` ≥ 20s, `<meta refresh>`, idle/session keyword gating for 2.2.6. Three criteria, one finder. Effort M. Conf H.
2. **`review/motion-actuation` — covers 2.5.4.** Signal: `DeviceMotionEvent`, `DeviceOrientationEvent`, listener strings. Tiny surface, near-zero false positives. Effort S. Conf H.
3. **`review/captcha` — covers 3.3.8, 3.3.9.** Signal: known CAPTCHA component imports (`react-google-recaptcha`, `@hcaptcha/react-hcaptcha`, `turnstile`), CAPTCHA hostnames in `<script src>`. Effort S. Conf H.
4. **`review/pointer-gestures` — covers 2.5.1.** Signal: gesture libs + `pointermove`+`pointerdown`+`touchmove` listener combos. Effort M. Conf H.
5. **`review/flash` — covers 2.3.1, 2.3.2.** Signal: CSS `@keyframes` named/structured as flash/blink, `animation-iteration-count: infinite` on opacity-toggling keyframes with duration < 333ms. Effort M. Conf M.

### Tier 2 — ship if Tier 1 lands clean (real failure mode, noisier signal)

6. **`review/images-of-text` — covers 1.4.5, 1.4.9.** Signal: `<img>` with banner/quote/headline filename or alt patterns, SVG `<text>` elements. Conf M. Risk: many decorative banners flagged.
7. **`review/error-identification` — covers 3.3.1.** Signal: form inputs lacking `aria-describedby`/`aria-invalid` wiring. Conf M. Risk: noisy on simple forms; gate on form complexity.
8. **`review/focus-obscured` — covers 2.4.11, 2.4.12.** Signal: sticky/fixed headers without focus-within compensation. Conf M.
9. **`review/focus-appearance` — covers 2.4.13.** Extend to compute focus-style contrast where colors are static. Conf M.
10. **Extend `on-input-change` to cover 3.2.5.** Add `useEffect` + navigation pattern. Effort S.
11. **`review/redundant-entry` — covers 3.3.7.** Multi-step form duplicated field detection. Conf M.
12. **`review/section-headings` — covers 2.4.10.** `<section>` / `<article>` without heading child. Conf M, but high false-positive risk for layout `<section>` use.

### Tier 3 — postpone or decline

13. **2.4.5, 2.4.8, 3.2.3, 3.2.4, 3.2.6** — require project-scope (cross-file) analysis. Worth doing once we add a project-scope finder API; until then, leave manual.
14. **3.3.4, 3.3.6** — destructive-action confirmation. Signal exists but is contextual; ship later only if real-world fixtures justify.
15. **2.2.4** — interruptions; signal too noisy.
16. **3.1.4** — abbreviations; very noisy, AAA, low value.
17. **1.4.8** — visual presentation; AAA, weak signal.

### Decline (no useful static signal)

18. **1.3.6, 1.4.7, 2.2.5, 2.5.6, 3.1.3, 3.1.5, 3.1.6, 3.3.5, 4.1.1** — leave manual permanently.

---

## 4. What this report does NOT settle

- **False-positive rate per finder.** Until we run each candidate finder against real-world fixtures (`tests/fixtures/real-world/`), confidence numbers above are author estimates. Each Tier 1 finder needs ≥30 sanitized real-world samples (good and bad) before merging.
- **Reviewer harm threshold.** A finder that produces 500 candidates per page hurts more than it helps — it trains reviewers to dismiss the report. Each finder should be capped at a measured per-page emission rate (suggest: ≤20 candidates per criterion per page, with a `--review-budget` config knob).
- **Per-finder hill-climbing.** Once a finder is built and has labeled fixtures, `/autoresearch` becomes useful: mutable file = the finder, harness = `bun test fixtures && print precision/recall/F1`, hill-climb. **Do not autoresearch a finder before its fixture set exists** — you'll overfit to ten samples.

---

## 5. Recommended next concrete step

Pick **`review/timing`** (Tier 1, item 1) as the first build:

- Three criteria (2.2.1, 2.2.3, 2.2.6) covered by one finder.
- Signal is unambiguous: `setTimeout(_, n)` where `n >= 20000` literal or `<meta http-equiv="refresh" content="N">`.
- Failure mode is real and well-documented in the WCAG techniques (G133, F41, F40).
- Real-world fixtures are easy to collect: any session-timeout component, any auto-refresh dashboard.

Workflow to use: `/add-rule` is rule-shaped; this is finder-shaped. Either (a) extend `/add-rule` to take a finder template, or (b) follow the manual finder pattern in `src/review/finders/use-of-color.ts` as the model and write it by hand. Option (b) is faster today.

---

## 6. Revised plan (post-review)

Two independent reviewers pushed back. This section supersedes §3 on what to build and reframes the moat argument.

### Corrections to the original analysis

- **"Manual criterion never becomes a Rule" is false.** `src/rules/document/meta-refresh.ts` is a live Rule for SC 2.2.1/2.2.4/3.2.5 — criteria this report classified as manual. The Rule/CandidateFinder line is not as bright as §1 implies; some "manual" criteria have narrow slices already covered as Rules.
- **`review/timing` double-counts `<meta refresh>`** — already a Rule. Drop that signal from the finder proposal. The remaining setTimeout/setInterval half is noisy (every debounce, poll, heartbeat) unless gated on session/idle/logout keywords, so Tier 1 placement is wrong.
- **`review/flash` will fire on Tailwind `animate-pulse` / `animate-ping`** — both ship with WCAG-safe durations but match the opacity-toggling-infinite signal. Certification-surface boy-who-cried-wolf. Demote below Tier 2 until a precision-validated signal exists.
- **"axe/eslint-jsx-a11y/Pa11y don't do this" is wrong.** axe has `incomplete` results. HTML_CodeSniffer emits WCAG2AA warnings. Neither structures it as a first-class typed surface, but the *existence* of needs-review output is not novel.
- **VPAT integration is scaffolded, not built.** `src/reports/vpat.ts:133` emits generic "Not Evaluated" remarks today. Candidates do not flow through to the VPAT Remarks column. Treating VPAT-native output as a current feature is incorrect — it's a gap.
- **Fixture maintenance cost understated.** `tests/fixtures/real-world/` does not exist. "Need 30 per finder" is really "need to start the corpus from zero."
- **Reviewer-budget cap of 20/criterion/page is theatrical** on a 200-page site.

### Tier corrections (supersedes §3)

Promotions and demotions after review:

- 3.3.1 Error Identification → **promoted**. Narrow signal: `aria-invalid={true}` or `is-invalid` class without an `aria-describedby` pointing at a text region. Tight enough for Tier 1-adjacent.
- 2.4.10 Section Headings → **demoted to Tier 3**. Every shadcn/Tailwind `<section>` layout primitive would fire.
- 1.4.5/1.4.9 Images of Text → **split**. SVG `<text>` detection is tight (Tier 2). Image-filename heuristics are noisy (decline).
- `review/pointer-gestures` → **split**. Library-import detection (hammerjs, react-use-gesture, react-swipeable) is tight. Raw pointer/touch listener detection is noisy — every carousel, drag-drop, modal.
- `review/timing` → **defer** until session/idle-gated signal has real fixtures.
- `review/flash` → **defer** until animation-name exclusion list is validated.

### Revised moat framing

The moat is **not** "we have more finders than axe." It's the *workflow*: typed `CandidateFinder` → `ReviewCandidate[]` → persisted reviewer verdicts → VPAT evidence. Finders are the input; the differentiation is the full loop.

Ranked by hardness to copy and impact:

1. **Evidence ledger (new).** Extend `.ra11y-manual.json` (already referenced at `src/reports/certification.ts:14`) into a component-hash-keyed store of manual verdicts that survives rescans and invalidates on diff. Reviewed evidence compounds across audits. No other scanner does this; it ties component identity, diff invalidation, and audit history into one durable artifact. This is the real moat.
2. **VPAT bridge.** Wire `ReviewCandidate` + ledger verdicts into `src/reports/vpat.ts:133` so "Remarks and Explanations" carries real per-SC evidence, not boilerplate. Fills a gap we currently over-state as a feature.
3. **Fixture corpus (`tests/fixtures/real-world/`).** Sanitized real-world failure patterns. Prerequisite for safely expanding any finder; itself a detection-side moat (labeled failure corpora compound, competitors cannot fake them quickly).
4. **Project-scope finder API.** Unlocks 2.4.5 / 3.2.3 / 3.2.4 / 3.2.6 (cross-page consistency SCs). Real engineering — route canonicalization + identity matching. Do after #1–3 prove the workflow.
5. Framework-aware finders — easy to copy; skip unless Tier A proves high recall gains are on the table.
6. Optional LLM-assisted pre-draft — near-zero moat; feature, not differentiation.

### Revised build order (supersedes §3 "Tier 1/2/3")

**Tier A — ship now (2 finders, small, clean signal).**

1. `review/captcha` → covers 3.3.8, 3.3.9. Signal: known CAPTCHA component imports (`react-google-recaptcha`, `@hcaptcha/react-hcaptcha`, `react-turnstile`) + known CAPTCHA hostnames (`www.google.com/recaptcha`, `hcaptcha.com`, `challenges.cloudflare.com`) in `<script src>`. Near-zero FP.
2. `review/motion-actuation` → covers 2.5.4. Signal: `DeviceMotionEvent` / `DeviceOrientationEvent` references, `addEventListener('devicemotion'|'deviceorientation', …)`. No other purpose for these APIs.

**Tier B — the actual moat (ordered).**

3. Evidence ledger.
4. VPAT bridge.
5. Start `tests/fixtures/real-world/` with sanitized samples for Tier A finders before expanding.

**Tier C — long horizon.**

6. Project-scope finder API.
7. Revisit deferred finders (timing, flash, pointer-gestures raw, images-of-text, error-identification) one at a time, each gated on real-world fixtures and a measured precision target.

**Decline.**

Everything classified 🟥 in §2 stays manual permanently. No further investigation.
