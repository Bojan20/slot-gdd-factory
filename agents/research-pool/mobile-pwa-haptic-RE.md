# Mobile PWA · Haptic · WCAG 2.2 AA · Touch · Safe-Area Encyclopedia

> **Purpose**: Single canonical reference for `slot-gdd-factory` UIArchitect + RGArchitect agents covering every viewport / safe-area / touch / haptic / accessibility decision a slot game must defend at audit time.
> **Audience**: Block authors (`src/blocks/*.mjs`), GDD parser, regulator submission, RG submission, retrofit sweeps.
> **Scope discipline**: Strictly mobile/PWA/tactile/a11y surface. Audio is OUT (see `rule_audio_off_until_asked`). Math/RNG/PAR is OUT (see `rule_no_math_unless_asked`).
> **Vendor neutrality**: No vendor / brand / title names anywhere below (see `rule_no_vendor_mentions`). All comparisons reference "industry baseline" or "reference benchmark".
> **Reading mode**: Tables-first per `rule_format_tables_always` + `rule_responsive_status_grid`. Every list ≥ 2 items becomes a grid.

---

## Table of Contents

| #   | Section                                                | Anchor                         |
| --: | :----------------------------------------------------- | :----------------------------- |
| 1   | Viewport Units Deep Dive                               | `#1-viewport-units-deep-dive`  |
| 2   | Safe-Area Insets (notch / dynamic island / home bar)   | `#2-safe-area-insets`          |
| 3   | iOS Haptic API                                         | `#3-ios-haptic-api`            |
| 4   | Android VibrationEffect API                            | `#4-android-vibrationeffect-api` |
| 5   | WCAG 2.2 AA Compliance Matrix                          | `#5-wcag-22-aa-compliance-matrix` |
| 6   | Touch Target Sizing                                    | `#6-touch-target-sizing`       |
| 7   | Spin Button Affordances                                | `#7-spin-button-affordances`   |
| 8   | Reduced Motion Support                                 | `#8-reduced-motion-support`    |
| 9   | Color Vision Deficiency                                | `#9-color-vision-deficiency`   |
| 10  | Screen Reader Support                                  | `#10-screen-reader-support`    |
| 11  | PWA Manifest Slot-Specific                             | `#11-pwa-manifest-slot-specific` |
| 12  | iOS Safari Quirks Catalog                              | `#12-ios-safari-quirks-catalog` |
| 13  | Citation Index                                         | `#13-citation-index`           |
| 14  | Appendix A — Block Coverage Mapping                    | `#14-appendix-a-block-coverage-mapping` |
| 15  | Appendix B — Test Fixture Proposals                    | `#15-appendix-b-test-fixture-proposals` |
| 16  | Appendix C — Decision Heuristics for Architects        | `#16-appendix-c-decision-heuristics` |

---

## 1. Viewport Units Deep Dive

### 1.1 The Six-Way Split (CSS Values & Units L4)

CSS Values and Units Module Level 4 standardised **three families** of viewport units, each in four flavours (`vw`, `vh`, `vmin`, `vmax`). The families exist because mobile browsers expand/contract chrome (URL bar, tab strip, toolbar) during scroll, which used to silently break `100vh` layouts on iOS Safari and Chrome Android.

| Family    | Meaning                                           | When the value changes                                                                                       | Slot-game use case                                  |
| :-------- | :------------------------------------------------ | :----------------------------------------------------------------------------------------------------------- | :-------------------------------------------------- |
| `vh/vw`   | "Classic" viewport — equals **large** in most UAs | Officially "UA-defined"; in practice acts like `lvh` on iOS Safari, like `dvh` on Chrome Android pre-108     | Avoid for full-bleed; legacy code only              |
| `svh/svw` | **Small** viewport — chrome fully expanded        | Stable; never grows                                                                                          | Use for top HUD that must stay below URL bar always |
| `lvh/lvw` | **Large** viewport — chrome fully retracted       | Stable; never shrinks                                                                                        | Use for background canvas full-bleed                |
| `dvh/dvw` | **Dynamic** viewport — current actual size        | Updates on every chrome show/hide; throttled to ~16ms                                                        | Use for game stage; rarely for footer (jitter risk) |

### 1.2 Why `100vh` Broke Slot Footers (2018-2022)

Pre-iOS 15.4 and pre-Chrome 108, `100vh` was implemented inconsistently:

| Browser           | `100vh` resolved to | URL-bar collapse behavior                  | Footer impact                          |
| :---------------- | :------------------ | :----------------------------------------- | :------------------------------------- |
| iOS Safari 9–15.3 | `lvh` (large)       | URL bar visible at load → footer below fold | Spin button hidden behind URL bar      |
| Chrome Android <108 | `dvh` (dynamic)   | URL bar collapses on scroll → layout jumps  | Reels jitter as user scrolls           |
| Firefox Android   | `lvh` (large)       | Same as iOS Safari pre-15.4                | Same footer cutoff                     |
| Samsung Internet  | `dvh` (dynamic)     | Collapsing chrome                          | Layout reflow during URL bar animation |

### 1.3 Browser Support Matrix (2024-2026)

| Browser            | Version introduced `svh/lvh/dvh` | Stability notes                          | 2026 deployment share (approx) |
| :----------------- | :------------------------------- | :--------------------------------------- | :----------------------------- |
| Safari (iOS/macOS) | 15.4 (March 2022)                | Stable; `dvh` updates on scroll-end only | iOS 15.4+ ≈ 99 %               |
| Chrome (desktop)   | 108 (Nov 2022)                   | Stable                                   | 100 %                          |
| Chrome (Android)   | 108 (Nov 2022)                   | Stable; `dvh` updates per-frame on scroll | ≈ 98 %                        |
| Edge               | 108 (Nov 2022)                   | Stable                                   | 100 %                          |
| Firefox            | 101 (May 2022)                   | Stable                                   | 100 %                          |
| Samsung Internet   | 21 (April 2023)                  | Stable; matches Chrome behavior          | ≈ 95 %                         |
| Opera Android      | 73 (Dec 2022)                    | Stable                                   | 100 %                          |
| UC Browser         | Not supported                    | Falls back to `vh` (= `lvh`)             | Tail risk only                 |

### 1.4 Canonical Slot Layout Template

```css
/* Background canvas — always full-bleed, no jitter */
.slot-stage {
  height: 100lvh;          /* fallback for older UAs */
  height: 100dvh;          /* progressive enhancement */
  width: 100lvw;
  width: 100dvw;
}

/* Top HUD — must never overlap browser chrome */
.slot-hud-top {
  position: fixed;
  top: env(safe-area-inset-top, 0);
  height: 56px;
  width: 100svw;            /* SHRINKS chrome-safe */
}

/* Bottom dock — spin button + bet controls */
.slot-hud-bottom {
  position: fixed;
  bottom: env(safe-area-inset-bottom, 0);
  height: 88px;
  width: 100svw;            /* survives URL-bar reveal */
}
```

### 1.5 `padding-block` Notched-Device Pattern

```css
/* Outer container that respects both notch and home indicator */
.slot-root {
  padding-block: env(safe-area-inset-top) env(safe-area-inset-bottom);
  padding-inline: env(safe-area-inset-left) env(safe-area-inset-right);
  box-sizing: border-box;
  min-height: 100dvh;
}
```

| Property             | iOS portrait | iOS landscape (notch left) | iOS landscape (notch right) | Android portrait | Android landscape |
| :------------------- | :----------- | :------------------------- | :-------------------------- | :--------------- | :---------------- |
| `safe-area-inset-top`    | 44–59 px     | 0                          | 0                           | 24–48 px (status bar) | 0                |
| `safe-area-inset-bottom` | 34 px (home indicator) | 21 px               | 21 px                       | 0 (gesture nav) or 48 px (3-button) | same       |
| `safe-area-inset-left`   | 0            | 44–59 px                   | 0                           | 0                | 0 or display cutout |
| `safe-area-inset-right`  | 0            | 0                          | 44–59 px                    | 0                | 0 or display cutout |

### 1.6 `viewport-fit=cover` Meta Tag

To opt into edge-to-edge rendering on notched devices, the HTML head MUST include:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
```

| Option             | Effect on `env(safe-area-inset-*)` | Effect on background paint                    | Recommended for slots |
| :----------------- | :---------------------------------- | :-------------------------------------------- | :-------------------- |
| `viewport-fit=auto` (default) | All insets resolve to `0` | UA leaves letterbox strips around notch | **No**                |
| `viewport-fit=contain` | Same as auto                   | Same as auto                                  | No                    |
| `viewport-fit=cover` | Real-valued insets exposed       | Background paints under notch / status bar    | **Yes — required**    |

### 1.7 iOS PWA Standalone vs. Browser Viewport

| Mode                 | Address bar | `100dvh` accuracy | `safe-area-inset-top` value | `theme-color` honored |
| :------------------- | :---------- | :---------------- | :-------------------------- | :-------------------- |
| Safari tab           | Visible at load, collapses on scroll | Updates dynamically | 47 px (status + URL bar) | Color flash on tab strip |
| Safari "Add to Home Screen" PWA | None       | Stable, matches `100lvh` | 44 px (status bar only) | Honored on status bar |
| In-app browser (Facebook/Instagram WebView) | Custom chrome | Inconsistent | Variable | Ignored                  |

### 1.8 Common Bugs & Mitigations

| Symptom                                          | Root cause                                     | Mitigation                                       |
| :----------------------------------------------- | :--------------------------------------------- | :----------------------------------------------- |
| Spin button hidden behind URL bar on first load  | Used `100vh` (=`lvh`) for footer position      | Switch to `100svh` + `env(safe-area-inset-bottom)` |
| Reels jitter as user scrolls a chat panel        | Used `100dvh` for stage container              | Switch to `100lvh`; jitter only on container that does not need to track chrome |
| Layout reflow when keyboard appears              | Used `100dvh` for input dialog                 | Use `100svh` + `visualViewport.height` listener for keyboard-aware UI |
| iOS PWA shows 1-px white strip at bottom         | Missing `viewport-fit=cover`                   | Add to meta tag                                  |
| Background color does not bleed under notch      | Missing `viewport-fit=cover` OR painting only inside safe area | Paint `body { background: ... }` AND add cover meta |

---

## 2. Safe-Area Insets

### 2.1 The Four `env()` Properties

| CSS function                          | Returns                                   | First UA support                | Spec                          |
| :------------------------------------ | :---------------------------------------- | :------------------------------ | :---------------------------- |
| `env(safe-area-inset-top)`            | Pixels above content-safe region          | iOS 11, Chrome Android 69       | CSS Round Display Level 1 §6  |
| `env(safe-area-inset-right)`          | Pixels right of content-safe region       | iOS 11, Chrome Android 69       | CSS Round Display Level 1 §6  |
| `env(safe-area-inset-bottom)`         | Pixels below content-safe region          | iOS 11, Chrome Android 69       | CSS Round Display Level 1 §6  |
| `env(safe-area-inset-left)`           | Pixels left of content-safe region        | iOS 11, Chrome Android 69       | CSS Round Display Level 1 §6  |

All four take an optional fallback: `env(safe-area-inset-top, 0px)`. **Always supply a fallback** — older UAs (KaiOS, UC Browser, in-app WebViews of legacy social apps) will paint `unset` otherwise, which collapses to `auto` and breaks `padding-block`.

### 2.2 iPhone Notch / Dynamic Island Dimensions (CSS px)

| Device                                   | Top inset (portrait) | Top inset (landscape) | Bottom inset (portrait) | Bottom inset (landscape) | Side inset (landscape) |
| :--------------------------------------- | :------------------- | :-------------------- | :---------------------- | :----------------------- | :--------------------- |
| iPhone 11 / 11 Pro / 11 Pro Max          | 44                   | 0                     | 34                      | 21                       | 44                     |
| iPhone 12 / 12 mini / 12 Pro / 12 Pro Max | 47                  | 0                     | 34                      | 21                       | 47 (44 on mini)        |
| iPhone 13 / 13 mini / 13 Pro / 13 Pro Max | 47                  | 0                     | 34                      | 21                       | 47 (44 on mini)        |
| iPhone 14 / 14 Plus                      | 47                   | 0                     | 34                      | 21                       | 47                     |
| iPhone 14 Pro / 14 Pro Max (Dynamic Island) | 59                | 0                     | 34                      | 21                       | 59                     |
| iPhone 15 / 15 Plus / 15 Pro / 15 Pro Max | 59                  | 0                     | 34                      | 21                       | 59                     |
| iPhone 16 / 16 Plus / 16 Pro / 16 Pro Max | 59                  | 0                     | 34                      | 21                       | 59                     |
| iPhone SE (2nd / 3rd gen)                | 20 (status bar)      | 0                     | 0                       | 0                        | 0                      |

> Note: Dynamic Island adds 16 CSS px of vertical real-estate vs. classic notch (59 vs. 47). Designs that anchor a "balance pill" near the top must reserve at least 59 px to clear flagship devices.

### 2.3 iPad Split-View Behavior

| Split mode                          | Top inset | Bottom inset | Side inset | Notes                                              |
| :---------------------------------- | :-------- | :----------- | :--------- | :------------------------------------------------- |
| Fullscreen (any iPad with home button) | 20     | 0            | 0          | Only status bar                                    |
| Fullscreen (iPad Pro 11 / 12.9 face-ID) | 24    | 20           | 0          | Status bar + home indicator                        |
| Slide Over (floating window)        | 20        | 20           | 0          | Returns insets of the floating window, not the host |
| Split View 50/50                    | 20        | 20           | 0          | Application sees its half as a full viewport       |
| Stage Manager (iPad Pro M1+)        | 20        | 20           | 0          | Same as split — app does not see chrome of other apps |

> Slot games on iPad Pro should treat `safe-area-inset-bottom: 20px` as the minimum reservation for the home indicator in all configurations.

### 2.4 Android Display Cutouts

Android 9+ exposes display cutouts through the Display Cutout API; web exposure is via `env(safe-area-inset-*)` once `viewport-fit=cover` is set.

| Cutout style              | Typical inset           | Example device families       | Notes                                            |
| :------------------------ | :---------------------- | :---------------------------- | :----------------------------------------------- |
| Notch (centered)          | 24–28 px top            | Pixel 3 XL                    | Symmetric; landscape pushes content right        |
| Notch (waterdrop)         | 18–24 px top            | Mid-range Android 2019–2021   | Smaller than iPhone notch                        |
| Hole-punch (top-left)     | 24 px top, ~16 px left  | Galaxy S10–S24                | Asymmetric — left-edge UI must respect inset     |
| Hole-punch (top-center)   | 24–32 px top            | Pixel 6/7/8/9                 | Symmetric; treat like centered notch             |
| Waterfall display         | 0 px top + 8–16 px sides | Curved-edge flagships         | Side-edge UI must inset; gesture conflict risk   |
| Folded inner display      | 0 top, 0 bottom         | Galaxy Fold/Flip inner        | Crease invisible to CSS — design around it manually |
| Foldable cover screen     | 24 px top, 34 px bottom | Galaxy Flip cover             | Treat as tiny phone                              |

### 2.5 Landscape vs. Portrait Inset Swap

A common bug: developers cache `safe-area-inset-top` on load and never re-read it. On orientation change, the notch moves from top to side (or both, on the Dynamic Island in landscape), and cached values cause UI clipping.

**Correct pattern**: pure CSS via `env()` resolves the swap automatically. JavaScript-side, listen to `screen.orientation.change` and recompute any cached canvas / WebGL viewport.

```js
screen.orientation.addEventListener('change', () => {
  // Re-read every inset; do NOT cache between orientation changes.
  const top = getComputedStyle(document.documentElement)
              .getPropertyValue('--safe-top');
  // ...
});
```

```css
:root {
  --safe-top:    env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left:   env(safe-area-inset-left, 0px);
  --safe-right:  env(safe-area-inset-right, 0px);
}
```

### 2.6 Safe-Area Anti-Patterns

| Anti-pattern                                           | Why it fails                                  | Correct alternative                                |
| :----------------------------------------------------- | :-------------------------------------------- | :------------------------------------------------- |
| `body { padding: 44px 0 34px 0; }` hardcoded           | Breaks on iPhone SE (0), iPad (20), Android (24) | Use `env(safe-area-inset-*)` with fallback         |
| Caching `getComputedStyle()` value in JS at load       | Stale after orientation change                | Read on every `resize` + `orientationchange` event |
| Painting absolute-positioned UI without inset          | Notch overlaps balance / spin                 | `top: calc(env(safe-area-inset-top) + 8px)`        |
| Using `vh` for footer offset                           | URL bar collision on iOS Safari               | `bottom: env(safe-area-inset-bottom) + svh delta`  |
| Ignoring `viewport-fit=cover` because "it looks fine in simulator" | Real device shows letterbox        | Always set `viewport-fit=cover` for slot games     |

---

## 3. iOS Haptic API

### 3.1 The Hard Truth — iOS Safari Has No Haptic API for Web

As of iOS 17.5 (latest stable confirmed 2026-06), there is **no JavaScript API that triggers the Taptic Engine from inside Safari, in-app browsers, or installed PWAs**.

| Path                                       | Web availability on iOS                              | Verdict                          |
| :----------------------------------------- | :--------------------------------------------------- | :------------------------------- |
| `navigator.vibrate(pattern)`               | **Not implemented** (silent no-op since iOS 9, 2015) | Useless                          |
| Web Vibration API spec compliance          | Apple has publicly declined to implement (W3C TAG response) | Useless                   |
| Service worker `Notification.vibrate`      | Not implemented; spec field ignored                  | Useless                          |
| Gamepad haptic actuators (`hapticActuators`) | Gamepad API supported, but actuator array always empty for iOS controllers | Useless |
| `UIImpactFeedbackGenerator`                | Swift-only, requires native app                      | Hybrid only                      |
| WKWebView JS bridge (`window.webkit.messageHandlers`) | Available — native side calls `UIImpactFeedbackGenerator` | Hybrid only            |
| iOS 17 experimental `WebAPIs.Haptics`      | Behind feature flag in Safari Technology Preview; NOT shipped to stable | Do not depend on   |
| `Notification API` with `vibrate` field via PWA | Field exists, ignored on iOS                    | Useless                          |

**Hard rule for slot-gdd-factory**: never gate user-facing affordances on haptic feedback on iOS web. Haptic is **additive**; visual + (when audio is later enabled) auditory feedback must carry the full information load. The block lifecycle MUST execute its visual response unconditionally and only emit haptic as an opportunistic add-on.

### 3.2 Hybrid App Bridge — Reference Pattern

For apps wrapped as native shells (WKWebView), the bridge looks like:

```js
// Web side — feature-detect bridge presence, never assume
function tryHaptic(kind) {
  const bridge = window.webkit?.messageHandlers?.haptic;
  if (!bridge) return false;
  try {
    bridge.postMessage({ kind });   // 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error'
    return true;
  } catch {
    return false;
  }
}
```

```swift
// Swift side
class HapticHandler: NSObject, WKScriptMessageHandler {
  func userContentController(_ ctl: WKUserContentController, didReceive msg: WKScriptMessage) {
    guard let payload = msg.body as? [String: String], let kind = payload["kind"] else { return }
    switch kind {
      case "light":   UIImpactFeedbackGenerator(style: .light).impactOccurred()
      case "medium":  UIImpactFeedbackGenerator(style: .medium).impactOccurred()
      case "heavy":   UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
      case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
      case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
      case "error":   UINotificationFeedbackGenerator().notificationOccurred(.error)
      default: break
    }
  }
}
```

### 3.3 `UIImpactFeedbackGenerator` Reference

| Generator class                            | Styles                                     | Apple HIG semantic                                | Slot equivalent             |
| :----------------------------------------- | :----------------------------------------- | :------------------------------------------------ | :-------------------------- |
| `UIImpactFeedbackGenerator(style:)`        | `.light`, `.medium`, `.heavy`, `.soft` (iOS 13+), `.rigid` (iOS 13+) | Physical-impact metaphor                 | Reel stop, button press     |
| `UISelectionFeedbackGenerator()`           | Single `.selectionChanged()`               | Discrete change (picker tick, bet step)           | Bet +/- tick                |
| `UINotificationFeedbackGenerator()`        | `.success`, `.warning`, `.error`           | Outcome announcement                              | Win confirmation, autoplay stop, error |
| `CHHapticEngine` (Core Haptics)            | Arbitrary AHAP patterns                    | Custom choreography                               | Big-win Roll-Up texture (hybrid only) |

### 3.4 Web Vibration on iOS — Confirmation by Spec

The W3C Vibration API (`https://www.w3.org/TR/vibration/`) defines `navigator.vibrate` and lists "implementation status" as "User agents may choose not to expose vibration capabilities even if hardware exists". Apple's documented stance in WebKit bug tracker: not planned. Treat this as load-bearing for the iOS feature matrix:

| iOS major version | Safari version | `navigator.vibrate` returns | Effect              |
| :---------------- | :------------- | :-------------------------- | :------------------ |
| iOS 9 – 17.5      | 9 – 17.5       | `false`                     | No-op               |
| iPadOS 13 – 17.5  | 13 – 17.5      | `false`                     | No-op               |
| iOS 18 (beta seed, 2026-Q2) | 18 beta | `false`                | No-op (no change)   |

### 3.5 Slot Game Design Implication

| Feature                          | Visual carrier (required)                 | Tactile carrier (iOS web)      | Tactile carrier (Android web)      | Tactile carrier (hybrid)        |
| :------------------------------- | :---------------------------------------- | :----------------------------- | :--------------------------------- | :------------------------------ |
| Spin button press                | Press state animation                     | None                           | `navigator.vibrate(10)`            | `.light` impact                 |
| Reel stop                        | Reel snap + dust                          | None                           | `navigator.vibrate(15)`            | `.medium` impact                |
| Small win                        | Symbol pulse + line draw                  | None                           | `navigator.vibrate(20)`            | `.success` notification         |
| Big-win Roll-Up                  | Counter + zoom + sparkle                  | None                           | `navigator.vibrate([30,20,30,20,60])` | `CHHapticEngine` AHAP roll      |
| Free-spin trigger                | Plaque + symbol explosion                 | None                           | `navigator.vibrate([50,30,50,30,100])` | `.success` + `.heavy` impact   |
| Jackpot                          | Full-screen reveal                        | None                           | `navigator.vibrate([60,40,60,40,60,40,150])` | Long AHAP texture            |
| Autoplay stop (RG event)         | Banner + freeze                           | None                           | `navigator.vibrate(200)`           | `.warning` notification         |

---

## 4. Android VibrationEffect API

### 4.1 The Web Vibration API — Pattern Syntax

The Web Vibration API exposes `navigator.vibrate(pattern)` where `pattern` is either an integer (milliseconds) or an array `[on, off, on, off, ...]` of integer milliseconds. Maximum pattern length is UA-defined; Chrome caps at 10 seconds total.

| Call shape                            | Behavior                                            | Returns |
| :------------------------------------ | :-------------------------------------------------- | :------ |
| `navigator.vibrate(0)`                | Cancels any ongoing vibration                       | `true`  |
| `navigator.vibrate(100)`              | Single 100 ms pulse                                 | `true`  |
| `navigator.vibrate([100, 50, 100])`   | 100 on, 50 off, 100 on                              | `true`  |
| `navigator.vibrate([0, 100])`         | 0 on, 100 off — effectively does nothing            | `true`  |
| `navigator.vibrate([100, 50, 100, 50, ...])` total > 10000 ms | Cancelled by UA              | `false` |

### 4.2 Browser Support Matrix

| Browser                  | Support              | User-gesture gate      | Max pattern length      | Notes                                          |
| :----------------------- | :------------------- | :--------------------- | :---------------------- | :--------------------------------------------- |
| Chrome Android           | Yes (since v32)      | Required since v60 (2017) | 10 s total           | Cancels on tab background                      |
| Samsung Internet         | Yes                  | Required               | 10 s total              | Same as Chrome                                 |
| Firefox Android          | Yes (since v16)      | Required               | 10 s total              | Honors `prefers-reduced-motion` voluntarily — not all builds |
| Edge Android             | Yes (Chromium-based) | Required               | 10 s total              | Same as Chrome                                 |
| Opera Android            | Yes                  | Required               | 10 s total              | Same as Chrome                                 |
| Chrome Desktop           | Method exists, no-op | n/a                    | n/a                     | Returns `true` but no hardware                 |
| Firefox Desktop          | Method exists, no-op | n/a                    | n/a                     | Same                                           |
| Edge Desktop             | Method exists, no-op | n/a                    | n/a                     | Same                                           |
| Safari (any)             | Method exists, no-op | n/a                    | n/a                     | See section 3                                  |
| Chrome iOS               | Method exists, no-op | n/a                    | n/a                     | Uses WebKit underneath                         |

### 4.3 User-Gesture Requirement

Since Chrome 60 (2017), `navigator.vibrate` only fires if the calling JS stack frame originated from a "user activation" — a tap, click, key press, or pointer event. Calls from `setTimeout`, `requestAnimationFrame`, `setInterval`, or async-await microtasks beyond the gesture grace window (≤ 5 s) silently fail.

```js
// FAILS — runs outside the gesture
button.addEventListener('click', () => {
  fetch('/spin').then(() => navigator.vibrate(100));   // microtask too late
});

// WORKS — vibration kicked inside gesture, network result handled separately
button.addEventListener('click', () => {
  navigator.vibrate(20);                               // press confirmation
  fetch('/spin').then(res => {
    if (res.win) queueHapticForNextGesture('win');     // deferred to next click
  });
});
```

For slot reel-stop haptics, the engine MUST emit the vibration within the spin-button click stack (use `requestAnimationFrame` callbacks scheduled before the gesture window closes) or sponsor a follow-up gesture (e.g., tap-to-collect).

### 4.4 Android `VibrationEffect` Predefined Constants

The Android platform exposes richer waveforms via `VibrationEffect` (`https://developer.android.com/reference/android/os/VibrationEffect`). Web JS cannot reach these directly, but hybrid apps can.

| Constant                                 | Approximate web equivalent                | Use                          |
| :--------------------------------------- | :---------------------------------------- | :--------------------------- |
| `EFFECT_TICK`                            | `navigator.vibrate(10)`                   | Subtle scroll tick           |
| `EFFECT_CLICK`                           | `navigator.vibrate(20)`                   | Button press                 |
| `EFFECT_DOUBLE_CLICK`                    | `navigator.vibrate([20, 50, 20])`         | Confirmation                 |
| `EFFECT_HEAVY_CLICK`                     | `navigator.vibrate(35)`                   | Significant action           |
| `createOneShot(ms, amplitude)`           | `navigator.vibrate(ms)` (amplitude fixed) | Custom single pulse          |
| `createWaveform(timings[], amplitudes[], repeat)` | `navigator.vibrate([...])` (amplitude ignored on web) | Custom pattern    |
| `createPredefined(...)` (Android 10+)    | None                                      | OS-tuned haptics             |

### 4.5 Accessibility Rate Budget

Web Vibration API has no UA-enforced rate limit, but accessibility guidance (WCAG 2.2.2, "Pause, Stop, Hide") suggests **no more than one haptic event per 1.5 seconds** for ambient animations. Discrete user-initiated haptics (spin button, big-win confirm) are exempt.

| Class of haptic                          | Budget                                | Slot example                       |
| :--------------------------------------- | :------------------------------------ | :--------------------------------- |
| User-initiated press                     | Unlimited (1 per gesture)             | Spin tap, bet +/-                  |
| Outcome announcement                     | 1 per spin result                     | Win, no-win, scatter trigger       |
| Ambient (reel travelling)                | 1 per 1.5 s minimum spacing           | Anticipation drum (rare)           |
| Celebration sequence (big-win, jackpot)  | One choreographed run < 10 s total    | Roll-up + finale                   |
| Free-spin countdown                      | 1 per 2 s                             | Last-spin warning                  |

### 4.6 Suggested Slot Haptic Patterns

| Event                            | Pattern (ms) `[on,off,...]`           | Wallclock | Intent                              |
| :------------------------------- | :------------------------------------ | :-------- | :---------------------------------- |
| Press confirm                    | `10`                                  | 10 ms     | Tactile receipt                     |
| Reel stop (one reel)             | `15`                                  | 15 ms     | Snap                                |
| Reel stop (anticipation reel)    | `[15, 30, 25]`                        | 70 ms     | Drum-roll texture                   |
| Line-win small                   | `[20]`                                | 20 ms     | Acknowledge                         |
| Line-win medium                  | `[20, 30, 30]`                        | 80 ms     | Two-beat                            |
| Big-win roll-up enter            | `[30, 20, 30, 20, 60]`                | 160 ms    | Build                               |
| Big-win roll-up finale           | `[80, 40, 80]`                        | 200 ms    | Climax                              |
| Free-spin trigger                | `[50, 30, 50, 30, 100]`               | 260 ms    | Reveal                              |
| Free-spin retrigger              | `[30, 20, 30, 20, 30, 20, 80]`        | 230 ms    | Smaller reveal                      |
| Jackpot                          | `[60, 40, 60, 40, 60, 40, 150]`       | 420 ms    | Triumph                             |
| Autoplay paused (RG)             | `200`                                 | 200 ms    | Attention                           |
| Loss-limit reached (RG)          | `[100, 80, 100]`                      | 280 ms    | Warning                             |

---

## 5. WCAG 2.2 AA Compliance Matrix

> Reference: W3C Web Content Accessibility Guidelines 2.2 Recommendation, October 2023. Below: only criteria with direct slot-game impact at Level A and AA. AAA omitted.

### 5.1 Perceivable

#### 1.4.3 Contrast (Minimum) — Level AA

**Requirement**: Text and images of text contrast ratio ≥ **4.5:1**; large text (≥ 18 pt or ≥ 14 pt bold) ≥ **3:1**.

| Slot UI surface              | Required ratio | Common failure                                | Mitigation                            |
| :--------------------------- | :------------- | :-------------------------------------------- | :------------------------------------ |
| Balance number               | 4.5:1          | Light gold-on-white at low brightness         | Use stroke or contrast pill background |
| Bet readout                  | 4.5:1          | Thin grey font                                | Bold + dark text or backdrop          |
| Spin button label            | 4.5:1 (small) or 3:1 (large bold) | White on gradient — varies across area | Force solid backplate          |
| Paytable text                | 4.5:1          | Thematic parchment with ornate background     | Provide overlay scrim                 |
| Toast notifications          | 4.5:1          | Translucent backdrop                          | Opaque card                           |

**Block coverage status (June 2026)**:

| Block                        | Status | Notes                                           |
| :--------------------------- | :----- | :---------------------------------------------- |
| `hud.mjs`                    | ⏳     | Balance contrast not asserted in tests          |
| `paytable.mjs`               | 📋     | Background varies per theme — needs scrim       |
| `spinButton.mjs`             | ✅     | Solid backplate; passes                         |
| `toast.mjs`                  | ⏳     | Translucent default — needs opaque variant      |

**Test fixture proposal**: `tests/a11y/contrast.spec.mjs` — snapshot each rendered block, run pixel sampler over text bounding boxes, assert ratio ≥ 4.5 (or 3 for large) against rendered backdrop.

#### 1.4.10 Reflow — Level AA

**Requirement**: Content reflows without horizontal scrolling at 320 CSS px width (and 256 CSS px height for vertically scrolled content) without loss of information or functionality. Exceptions: 2D content (maps, games) and data tables.

> Slot games qualify for the "essential 2D" exception only for the reel area itself. UI chrome (HUD, paytable, settings) MUST reflow.

| Component                  | Reflow strategy                              | Status |
| :------------------------- | :------------------------------------------- | :----- |
| Reel area                  | Scale-to-fit (exception)                     | ✅     |
| HUD (balance, bet, win)    | Flex column at < 360 px                      | ⏳     |
| Paytable                   | Vertical stack at < 360 px                   | ⏳     |
| Settings dialog            | Full-screen at < 360 px                      | 📋     |

**Test fixture**: viewport 320×568, render every dialog, assert no horizontal scrollbar via DOM `scrollWidth === clientWidth`.

#### 1.4.11 Non-text Contrast — Level AA

**Requirement**: UI components and graphical objects: ≥ **3:1** against adjacent colors.

| Component                | Required ratio | Common failure              | Mitigation                       |
| :----------------------- | :------------- | :-------------------------- | :------------------------------- |
| Spin button outline      | 3:1            | Same gradient blend         | Add 2 px solid outline at AA color |
| Bet +/- buttons          | 3:1            | Translucent over reels      | Solid backplate                  |
| Paytable close X         | 3:1            | Glyph against theme art     | Backplate + outline              |
| Reel separator lines     | 3:1            | Decorative — exempt         | Keep decorative                  |

#### 1.4.12 Text Spacing — Level AA

**Requirement**: User stylesheets can override text spacing without loss of content/functionality:

| Property                  | User can set up to        |
| :------------------------ | :------------------------ |
| `line-height`             | 1.5× font size            |
| Spacing after paragraphs  | 2× font size              |
| `letter-spacing`          | 0.12× font size           |
| `word-spacing`            | 0.16× font size           |

**Mitigation**: never set fixed-pixel heights on text containers; use `min-height` or rely on natural flow.

#### 1.4.13 Content on Hover or Focus — Level AA

**Requirement**: Additional content triggered by hover/focus must be:

1. **Dismissible** without moving pointer/focus (Escape key).
2. **Hoverable** — pointer can move onto the additional content without dismissing it.
3. **Persistent** — does not dismiss until trigger removed, user dismisses, or content is invalid.

Slot-game applicability: tooltips on paytable cells, hover-revealed win amount.

### 5.2 Operable

#### 2.1.1 Keyboard — Level A

**Requirement**: All functionality available via keyboard.

| Control                    | Key binding              | Status |
| :------------------------- | :----------------------- | :----- |
| Spin                       | Space, Enter             | ⏳     |
| Bet up                     | ArrowUp                  | 📋     |
| Bet down                   | ArrowDown                | 📋     |
| Autoplay toggle            | A                        | 📋     |
| Paytable                   | P or i                   | 📋     |
| Settings                   | S                        | 📋     |
| Close dialog               | Escape                   | 📋     |
| Stop spin (slam)           | Space (second press)     | 📋     |

#### 2.1.2 No Keyboard Trap — Level A

**Requirement**: User can navigate away from any focusable component using only keyboard.

Slot dialogs (paytable, settings, autoplay options) MUST trap focus only within themselves and release on Escape.

#### 2.2.1 Timing Adjustable — Level A

**Requirement**: For each time limit, user can turn off, adjust, or extend (10× minimum) — unless the limit is essential.

Slot-game application: **autoplay session limits**. Player must be able to extend / pause / cancel autoplay before it runs out.

| Mechanism                          | Required by 2.2.1 | Status      |
| :--------------------------------- | :---------------- | :---------- |
| Cancel autoplay anytime            | Yes               | ⏳          |
| Adjust autoplay count mid-session  | Optional but recommended | 📋   |
| Visual countdown of remaining spins | Recommended      | ⏳          |

#### 2.3.1 Three Flashes or Below Threshold — Level A

**Requirement**: No content flashes more than **3 times per second** in any one-second window, OR flash area is below the "general flash and red flash thresholds".

Slot-game critical risk: big-win Roll-Up sparkles, jackpot reveal strobes.

| Event                | Mitigation                                                      |
| :------------------- | :-------------------------------------------------------------- |
| Big-win finale strobe | Cap flash rate at 3 Hz; if higher needed, reduce area < 21824 sq CSS px (general threshold proxy at typical viewing distance) |
| Jackpot reveal       | Same                                                            |
| Reel anticipation flash | 2 Hz default; assert in test                                 |
| Free-spin plaque entry | Single fade-in, not strobe                                   |

**Test fixture**: render winPresentation animation at 60 fps capture, count luminance peaks per second, assert ≤ 3.

#### 2.4.7 Focus Visible — Level AA

**Requirement**: Keyboard focus indicator visible on every focusable control.

| Control                | Focus style                                | Status |
| :--------------------- | :----------------------------------------- | :----- |
| Spin button            | 3 px outline at 3:1 contrast               | ⏳     |
| Bet +/-                | Same                                       | 📋     |
| Paytable cells         | 2 px outline                               | 📋     |
| Close button           | 2 px outline                               | 📋     |

> Never use `outline: none` without replacement. Use `:focus-visible` (not `:focus`) to suppress outline for mouse users while preserving keyboard outlines.

#### 2.5.5 Target Size (Enhanced) — Level AAA (note: 2.5.5 is AAA in WCAG 2.1; the AA version in 2.2 is 2.5.8)

**Requirement (2.5.5 AAA)**: Targets ≥ 44 × 44 CSS px.

(See 2.5.8 below for the AA version.)

#### 2.5.7 Dragging Movements — Level AA (new in 2.2)

**Requirement**: Any drag operation must have a single-pointer alternative — unless dragging is essential.

| Slot interaction         | Drag-required? | Alternative                                    | Status |
| :----------------------- | :------------- | :--------------------------------------------- | :----- |
| Bet slider               | Drag           | +/- buttons stepping by minBet                 | ⏳     |
| Paytable scroll          | Drag           | Tap-and-step pagination + keyboard arrows      | 📋     |
| Autoplay count picker    | Drag           | Numeric chips                                  | ⏳     |
| Volume slider            | Drag           | (Audio out of scope — see audio rule)          | n/a    |

#### 2.5.8 Target Size (Minimum) — Level AA (new in 2.2)

**Requirement**: Pointer-input targets ≥ **24 × 24 CSS px**, unless:

- The target is in a sentence (inline link, not slot-game relevant).
- The target is determined by the user agent.
- A larger equivalent target is in the same view.
- The target is "essential" (specific position dictated by the experience).

| Slot control          | Current size (typical) | 2.5.8 pass? | Recommended size |
| :-------------------- | :--------------------- | :---------- | :--------------- |
| Spin button           | 72 × 72                | Yes         | 72+              |
| Bet +/-               | 44 × 44                | Yes         | 44+              |
| Autoplay icon         | 40 × 40                | Yes         | 44+ (HIG)        |
| Paytable close X      | 32 × 32                | Yes         | 44+              |
| Reel symbol tap (paytable hint) | 28 × 28      | Marginal    | Expand hit-slop  |
| Quick bet chip        | 24 × 24                | Borderline  | Expand to 32+    |
| Settings small icons  | 22 × 22                | **FAIL**    | Expand           |

#### 3.2.6 Consistent Help — Level A (new in 2.2)

**Requirement**: When help is available (contact info, FAQ link, chat) it appears in consistent relative order across pages.

Slot-game application: "Responsible Gaming" link, customer support icon, paytable button — must appear in same dock position across base / FS / settings views.

#### 3.3.7 Redundant Entry — Level A (new in 2.2)

**Requirement**: Information previously entered is auto-filled or available to select; not required to be re-entered in same session.

Slot application: bet amount persists across sessions (already standard); player name / age verification not asked twice.

#### 3.3.8 Accessible Authentication (Minimum) — Level AA (new in 2.2)

**Requirement**: Cognitive function test (memorize password, transcribe CAPTCHA) not required unless alternative exists.

Slot application: login flow — provide password manager autofill, biometric, or magic-link alternative.

### 5.3 WCAG 2.2 Summary Table (slot-relevant criteria)

| #       | Title                                | Level | Slot impact area                  | Block(s) responsible                | Status |
| :------ | :----------------------------------- | :---- | :-------------------------------- | :---------------------------------- | :----- |
| 1.4.3   | Contrast (Minimum)                   | AA    | All text                          | `hud`, `paytable`, `toast`, `spinButton` | ⏳ |
| 1.4.10  | Reflow                               | AA    | UI chrome                         | `layoutRoot`, `paytable`, `settings` | ⏳    |
| 1.4.11  | Non-text Contrast                    | AA    | UI outlines                       | All interactive blocks              | ⏳     |
| 1.4.12  | Text Spacing                         | AA    | Text containers                   | `paytable`, `helpDialog`            | 📋     |
| 1.4.13  | Content on Hover or Focus            | AA    | Tooltips                          | `tooltip`                           | 📋     |
| 2.1.1   | Keyboard                             | A     | All controls                      | All interactive blocks              | ⏳     |
| 2.1.2   | No Keyboard Trap                     | A     | Dialogs                           | `paytable`, `settings`, `autoplay`  | ⏳     |
| 2.2.1   | Timing Adjustable                    | A     | Autoplay                          | `autoplay`                          | ⏳     |
| 2.3.1   | Three Flashes                        | A     | Big-win, jackpot                  | `winPresentation`, `jackpot`        | ⏳     |
| 2.4.7   | Focus Visible                        | AA    | All focusable controls            | All interactive blocks              | ⏳     |
| 2.5.7   | Dragging Movements                   | AA    | Sliders                           | `betPicker`, `autoplayPicker`       | ⏳     |
| 2.5.8   | Target Size (Minimum)                | AA    | All tap targets                   | All interactive blocks              | ⏳     |
| 3.2.6   | Consistent Help                      | A     | Help link position                | `hud`, `dialogBar`                  | 📋     |
| 3.3.7   | Redundant Entry                      | A     | Session-scoped fields             | `login`, `verification`             | 📋     |
| 3.3.8   | Accessible Authentication (Min)      | AA    | Login flow                        | `login`                             | 📋     |

**Total criteria covered: 15** (Level A + AA, slot-relevant). The remaining WCAG 2.2 AA criteria (1.3.4 Orientation, 1.3.5 Identify Input Purpose, 4.1.3 Status Messages, etc.) are noted in Appendix B.

---

## 6. Touch Target Sizing

### 6.1 The Three Reference Standards

| Standard                            | Minimum size              | Recommended spacing between adjacent targets | Source URL                                |
| :---------------------------------- | :------------------------ | :------------------------------------------- | :---------------------------------------- |
| Apple Human Interface Guidelines    | 44 × 44 pt (= CSS px)     | 8 pt                                         | `https://developer.apple.com/design/human-interface-guidelines/accessibility` |
| Android Material Design 3           | 48 × 48 dp (= CSS px)     | 8 dp                                         | `https://m3.material.io/foundations/designing/structure` |
| WCAG 2.2 SC 2.5.8 (AA minimum)      | 24 × 24 CSS px            | None mandated                                | `https://www.w3.org/TR/WCAG22/#target-size-minimum` |
| WCAG 2.2 SC 2.5.5 (AAA enhanced)    | 44 × 44 CSS px            | None mandated                                | `https://www.w3.org/TR/WCAG22/#target-size-enhanced` |

**Working rule for slot-gdd-factory**: target **44 × 44 CSS px** for every interactive control. This satisfies HIG, Material, AAA, and AA simultaneously, and leaves margin for accidental shrinkage during theme overrides.

### 6.2 `touch-action` Reference

The CSS `touch-action` property controls how a region responds to touch gestures. Mistuned `touch-action` is the #1 source of "spin button feels laggy on mobile" reports.

| Value                    | Effect                                                          | Slot usage                                |
| :----------------------- | :-------------------------------------------------------------- | :---------------------------------------- |
| `auto` (default)         | UA decides; typically pan-x pan-y pinch-zoom double-tap-zoom    | Avoid on game canvas                      |
| `none`                   | All gestures disabled — JS handles everything                   | Reel canvas (when JS owns swipe)          |
| `manipulation`           | Disables double-tap zoom + delay; allows pan and pinch          | **Default for all slot buttons**          |
| `pan-x` / `pan-y`        | Only horizontal / only vertical pan; everything else suppressed | Bet slider track (`pan-x`)                |
| `pinch-zoom`             | Only pinch                                                      | Paytable image gallery                    |
| `pan-x pan-y`            | Two-axis pan, no pinch / no double-tap                          | Internal scroll region                    |

**Why `manipulation` matters**: without it, every tap on a `<button>` has a **300 ms delay** because the UA waits to see if a second tap is incoming (double-tap zoom). On a spin button, this delay reads as "broken".

### 6.3 `pointer-events: none` for Decorative Overlays

Slot scenes layer ambient particles, vignettes, glow halos, and theme overlays on top of the spin button. Without `pointer-events: none` on each decorative layer, taps land on the overlay, not the button.

```css
.theme-overlay,
.particle-canvas,
.ambient-glow {
  pointer-events: none;
}

.spin-button {
  pointer-events: auto;   /* explicit override */
}
```

### 6.4 `user-select: none` for Game UI

Long-press on numeric readouts (balance, win) triggers text selection on iOS and Android, which is undesirable on game chrome.

```css
.hud, .spin-button, .bet-readout, .balance-readout {
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;       /* iOS — suppress callout */
}
```

### 6.5 Hit-Slop Expansion Technique

When the visual button is smaller than 44 × 44 (e.g., decorative bet chips at 32 × 32 to match a theme), expand the tappable area without changing visual size via a transparent `::after` pseudo-element.

```css
.bet-chip {
  position: relative;
  width: 32px;
  height: 32px;
}
.bet-chip::after {
  content: '';
  position: absolute;
  inset: -6px;            /* extends 6 px on each side → 44 × 44 */
  /* No background, transparent, but receives pointer events */
}
```

| Visual size | `inset: -X` for 44 × 44 hit area |
| :---------- | :------------------------------- |
| 32 × 32     | `-6px`                           |
| 28 × 28     | `-8px`                           |
| 24 × 24     | `-10px`                          |
| 20 × 20     | `-12px`                          |
| 16 × 16     | `-14px`                          |

**Caveat**: overlapping hit-slop regions on adjacent small chips can steal each other's taps. Tune `inset` to avoid overlap, or accept that the visual gap must increase.

### 6.6 Drag-Avoidance via `touch-action`

For controls where a drag could accidentally fire (e.g., spin button next to a horizontally scrollable element), set `touch-action: none` on the button and capture only `click` (not `pointerdown` + drag).

---

## 7. Spin Button Affordances

### 7.1 State Matrix

| State                | Visual cue                                    | ARIA                                          | Pointer events | Haptic on entry |
| :------------------- | :-------------------------------------------- | :-------------------------------------------- | :------------- | :-------------- |
| Idle                 | Default gradient + label "Spin"               | `aria-label="Spin"`, `aria-disabled="false"`  | auto           | none            |
| Hover (pointer)      | Brighter gradient                             | unchanged                                     | auto           | none            |
| Focus (keyboard)     | 3 px outline at 3:1                           | unchanged                                     | auto           | none            |
| Pressed              | Inset shadow + scale 0.96                     | unchanged                                     | auto           | `light` impact  |
| Spinning             | Stop icon, label "Stop spin"                  | `aria-label="Stop spin, spin in progress"`    | auto (allow slam) | none         |
| Stopping             | Label "Stop spin", busy spinner               | `aria-label="Stopping"`, `aria-busy="true"`   | none           | none            |
| Disabled             | Greyed                                        | `aria-disabled="true"`                        | none           | none            |
| Long-press (turbo)   | Glow + label "Turbo"                          | `aria-label="Turbo spin"`                     | auto           | `medium` impact |
| Hold-to-stop (slam)  | Filled stop icon                              | `aria-label="Stop now"`                       | auto           | `heavy` impact  |

### 7.2 Press / Disabled / Pressed-Disabled Transitions

```
Idle → (tap) → Pressed → (release inside) → Spinning → Idle
                       → (release outside) → Idle (no spin)
Idle → (long-press 400 ms) → Turbo (visual) → (release) → Turbo Spin → Idle
Spinning → (tap) → Stopping → Idle
Spinning → (long-press) → Slam Stop → Idle
Any → (server error) → Disabled (with toast)
```

### 7.3 Long-Press for Turbo

| Property              | Value           |
| :-------------------- | :-------------- |
| Trigger duration      | 400 ms          |
| Cancellation distance | 10 CSS px       |
| Visual feedback       | Glow halo at 200 ms (build), full at 400 ms (commit) |
| Haptic feedback       | `light` at 200 ms, `medium` at 400 ms |
| ARIA update           | `aria-label="Turbo spin"` at 400 ms commit |

### 7.4 Hold-to-Stop (Slam)

Slam stop ends a spin instantly. Implementation:

```js
let pressTimer = null;
spinBtn.addEventListener('pointerdown', e => {
  pressTimer = setTimeout(() => {
    engine.slamStop();           // ends current spin animation immediately
    tryHaptic('heavy');
  }, 200);
});
spinBtn.addEventListener('pointerup', () => clearTimeout(pressTimer));
spinBtn.addEventListener('pointercancel', () => clearTimeout(pressTimer));
spinBtn.addEventListener('pointerleave', () => clearTimeout(pressTimer));
```

### 7.5 `prefers-reduced-motion` in Spin Button

```css
@media (prefers-reduced-motion: reduce) {
  .spin-button {
    transition: none;
  }
  .spin-button:active {
    transform: none;             /* no scale 0.96 dip */
    filter: brightness(0.95);    /* still indicate press */
  }
}
```

### 7.6 Anti-Double-Tap Protection

Even with `touch-action: manipulation` removing the 300 ms zoom delay, network round-trips for spin commits can race. Debounce JS-side:

```js
let busy = false;
spinBtn.addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  try {
    await engine.spin();
  } finally {
    busy = false;
  }
});
```

| Source of double-tap                     | Mitigation                                  |
| :--------------------------------------- | :------------------------------------------ |
| User taps twice quickly                  | `busy` flag                                 |
| Touch + click both fire (legacy mobile)  | `event.preventDefault()` in pointerup       |
| Pointercancel during spin                | Treat as no-op (don't fire spin)            |
| Programmatic click in tests              | Tests opt-in to skip debounce               |

### 7.7 ARIA Dynamic Update

```js
function setSpinAria(state) {
  switch (state) {
    case 'idle':     spinBtn.setAttribute('aria-label', 'Spin'); break;
    case 'spinning': spinBtn.setAttribute('aria-label', 'Stop spin, spin in progress'); break;
    case 'stopping': spinBtn.setAttribute('aria-busy', 'true'); break;
    case 'disabled': spinBtn.setAttribute('aria-disabled', 'true'); break;
  }
}
```

Screen readers only announce changed attributes — over-announcement causes fatigue. Debounce state changes that flip-flop within 250 ms.

---

## 8. Reduced Motion Support

### 8.1 The Media Query

```css
@media (prefers-reduced-motion: reduce) { ... }
@media (prefers-reduced-motion: no-preference) { ... }
```

Source: CSS Media Queries Level 5 (`https://www.w3.org/TR/mediaqueries-5/#prefers-reduced-motion`).

### 8.2 OS-Level Settings That Set This

| Platform     | Setting path                                                      |
| :----------- | :---------------------------------------------------------------- |
| iOS / iPadOS | Settings → Accessibility → Motion → Reduce Motion                 |
| macOS        | System Settings → Accessibility → Display → Reduce Motion         |
| Android      | Settings → Accessibility → Visibility enhancements → Remove animations |
| Windows      | Settings → Ease of Access → Display → Show animations in Windows  |
| GNOME        | Settings → Universal Access → Reduce Animation                    |

### 8.3 Slot-Game Reduced-Motion Strategies

| Standard animation         | Reduced-motion alternative                                  |
| :------------------------- | :---------------------------------------------------------- |
| 3-second reel spin         | 600 ms ease-in + 200 ms ease-out (or instant + bounce only) |
| Reel anticipation drum     | Static highlight, no shake                                  |
| Symbol pulse on win        | Static border outline (no pulse)                            |
| Big-win Roll-Up zoom + counter | Numeric increment only, no zoom, no sparkles            |
| Free-spin intro plaque     | Text-only banner, no slide / scale                          |
| Background ambient particles | Suppress entirely                                         |
| Win line draw              | Instant appearance, no trace animation                      |
| Confetti / dust            | Suppress                                                    |
| Scatter symbol fly-in      | Static placement                                            |

### 8.4 JS Detection

```js
const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', e => {
  reduceMotionState = e.matches;
});
```

Block-side: every block with animation MUST read `reduceMotionState` and branch. Centralize in a single hook (`src/blocks/motionPreference.mjs`) so blocks call `motion.isReduced()` rather than each one calling `matchMedia`.

### 8.5 Reduced-Motion Acceptance Tests

| Test ID                | Check                                                       |
| :--------------------- | :---------------------------------------------------------- |
| `motion-spin-duration` | With reduce-motion, reel spin duration ≤ 800 ms total       |
| `motion-bigwin-still`  | With reduce-motion, big-win Roll-Up has zero `transform` keyframes |
| `motion-ambient-off`   | With reduce-motion, ambient particle canvas not rendered    |
| `motion-confetti-off`  | With reduce-motion, confetti emitter inactive               |
| `motion-fs-intro-text` | With reduce-motion, FS intro renders as plain banner        |

---

## 9. Color Vision Deficiency

### 9.1 The Three Common Forms

| Condition       | Affected cone      | ~Prevalence (male) | ~Prevalence (female) | Perception shift                            |
| :-------------- | :----------------- | :----------------- | :------------------- | :------------------------------------------ |
| Protanopia      | L (red)            | 1 %                | 0.02 %               | Reds darken; red/green confusable           |
| Protanomaly     | L (red, weakened)  | 1 %                | 0.02 %               | Mild red/green confusion                    |
| Deuteranopia    | M (green)          | 1 %                | 0.01 %               | Reds and greens look similar                |
| Deuteranomaly   | M (green, weakened) | 5 %               | 0.4 %                | Most common; mild red/green confusion       |
| Tritanopia      | S (blue)           | 0.001 %            | 0.03 %               | Blue/yellow confusion                       |
| Tritanomaly     | S (blue, weakened) | 0.01 %             | 0.01 %               | Mild blue/yellow confusion                  |
| Achromatopsia   | No cones           | < 0.003 %          | < 0.003 %            | No color, only luminance                    |

Total ~8 % of male population, ~0.5 % of female population has some form of CVD.

### 9.2 Slot-Game Palette Risks

| Risky pairing            | What CVD users see                          | Slot-game context        | Fix                                     |
| :----------------------- | :------------------------------------------ | :----------------------- | :-------------------------------------- |
| Red / Green              | Same luminance brownish-yellow              | Win highlight (green) vs. loss (red) | Add icon ✓/✗; or use blue / orange  |
| Red / Black              | Both dark                                   | Hot symbol on dark background | Add white outline                  |
| Pink / Grey              | Same lightness                              | Disabled state vs. light gradient | Add stroke or icon              |
| Light blue / Pink        | Tritanopes confuse                          | Two adjacent themed symbols | Add silhouette difference          |
| Gold / Yellow / Khaki    | Hard to distinguish for most CVDs           | Coin denominations       | Use distinct shapes                     |

### 9.3 Pattern + Color Rule

WCAG 1.4.1 ("Use of Color", Level A): color is not the only means of conveying information.

| State                     | Color cue                | Required additional cue                 |
| :------------------------ | :----------------------- | :-------------------------------------- |
| Winning line              | Bright outline           | Numeric win readout + flashing dot      |
| Losing spin               | (No color)               | "No win" text or silent                 |
| Big-win                   | Gold glow                | Counter, label, animation               |
| Free-spin scatter         | Themed color             | Scatter icon, "FS unlocked" label       |
| Disabled spin button      | Greyed                   | `aria-disabled="true"` + cursor change  |
| Low-balance warning       | Red text                 | Warning triangle icon + text            |

### 9.4 CVD Simulation Tools

| Tool                       | Type            | URL                                         |
| :------------------------- | :-------------- | :------------------------------------------ |
| Sim Daltonism              | macOS app       | `https://michelf.ca/projects/sim-daltonism/` |
| Coblis                     | Web upload      | `https://www.color-blindness.com/coblis-color-blindness-simulator/` |
| Chrome DevTools "Emulate vision deficiencies" | Built-in | DevTools → Rendering tab           |
| Stark plugin               | Figma plugin    | `https://www.getstark.co/`                  |

### 9.5 Test Plan

| Test ID                | Method                                                | Pass criteria                                       |
| :--------------------- | :----------------------------------------------------- | :-------------------------------------------------- |
| `cvd-bigwin-distinct`  | Render big-win frame, apply protanopia + deuteranopia + tritanopia filter, assert text-readable luminance contrast still ≥ 4.5:1 | All three filters pass        |
| `cvd-paytable-symbols` | Render paytable, assert each symbol distinguishable by shape alone (greyscale snapshot) | No two symbols identical in greyscale |
| `cvd-win-line`         | With CVD filter applied, win line still detectable    | Win-line stroke contrast ≥ 3:1 in greyscale         |

---

## 10. Screen Reader Support

### 10.1 ARIA Live Regions — The Three Politeness Levels

| `aria-live` value | When announced                              | Slot usage                         |
| :---------------- | :------------------------------------------ | :--------------------------------- |
| `off`             | Never                                       | Silent ambient updates             |
| `polite`          | At next pause in user's reading             | Win amount, balance change         |
| `assertive`       | Immediately, interrupting current speech    | Autoplay paused, jackpot triggered, RG warning |

### 10.2 `role="status"` vs. `role="alert"`

| Role               | Implicit `aria-live` | Use                                                  |
| :----------------- | :------------------- | :--------------------------------------------------- |
| `role="status"`    | `polite`             | Win confirmations, bet changes, balance updates      |
| `role="alert"`     | `assertive`          | Autoplay forced stop, jackpot, session-limit hit     |
| `role="log"`       | `polite`             | Append-only history (game log)                       |
| `role="timer"`     | `off` (custom)       | Countdown displays                                   |
| `role="progressbar"` | (separate)         | Reel-stop progress (rare)                            |

### 10.3 Slot-Game Announcement Catalog

| Event                          | Region role         | Politeness | Sample announcement                                  |
| :----------------------------- | :------------------ | :--------- | :--------------------------------------------------- |
| Spin started                   | None                | n/a        | (no announce — would be noise)                       |
| Reel stopped (each)            | None                | n/a        | (no announce)                                        |
| All reels stopped, win         | `role="status"`     | polite     | "Win: 12 credits."                                   |
| All reels stopped, no win      | None                | n/a        | (silent or batched session summary)                  |
| Free-spin scatter trigger      | `role="alert"`      | assertive  | "Free spins unlocked: 10 spins awarded."             |
| Big-win Roll-Up start          | None                | n/a        | (do not announce running tally)                      |
| Big-win Roll-Up end            | `role="status"`     | polite     | "Big win: 250 credits."                              |
| Jackpot triggered              | `role="alert"`      | assertive  | "Jackpot! You won 10000 credits."                    |
| Bet changed                    | `role="status"`     | polite     | "Bet: 1.00."                                         |
| Balance change                 | `role="status"`     | polite     | "Balance: 99.00."                                    |
| Autoplay started               | `role="status"`     | polite     | "Autoplay started: 25 spins remaining."              |
| Autoplay paused (RG event)     | `role="alert"`      | assertive  | "Autoplay paused. Balance threshold reached."        |
| Autoplay completed             | `role="status"`     | polite     | "Autoplay completed."                                |
| Session limit warning          | `role="alert"`      | assertive  | "Session limit approaching. 5 minutes remaining."    |
| Session limit reached          | `role="alert"`      | assertive  | "Session limit reached. Play paused."                |
| Connection lost                | `role="alert"`      | assertive  | "Connection lost. Retrying."                         |
| Connection restored            | `role="status"`     | polite     | "Connection restored."                               |

### 10.4 Debounce Strategy

Naive implementation would announce every spin result, flooding the screen reader. Debounce by:

| Channel                     | Cooldown / aggregation                                         |
| :-------------------------- | :------------------------------------------------------------- |
| Per-spin win amount         | Aggregate over 30-second window: "5 wins totaling 47 credits"  |
| Per-spin balance update     | Aggregate: "Balance now 76 credits after 8 spins"              |
| Per-spin no-win             | Suppress entirely                                              |
| Big-win                     | Announce single end-state, never running tally                 |
| Bet change                  | Debounce 500 ms (rapid +/- presses)                            |
| Free-spin remaining count   | Announce only when count crosses milestones (every 5 spins) and at last spin |

### 10.5 Reel Spin Announcement — Do Not

A pre-2.2 audit antipattern: `<div aria-live="polite">` updated with "Reel 1 stopped on Cherry. Reel 2 stopped on Bar..." — the result is screen-reader fatigue. **Do not announce per-reel; announce the result.**

### 10.6 Visually Hidden but SR-Audible

```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

```html
<div role="status" aria-live="polite" class="sr-only" id="game-status">
  <!-- JS writes text here -->
</div>
```

### 10.7 Focus Management on Modal Open

When a dialog opens (paytable, settings, autoplay options):

1. Move focus to the dialog's first focusable element.
2. Trap focus within dialog (tab cycles within).
3. On Escape, close dialog and return focus to the trigger.
4. While dialog open, set `aria-hidden="true"` on outside content (or use `inert` attribute, supported in modern UAs).

### 10.8 Screen Reader Coverage Matrix

| Screen reader   | Platform        | `aria-live` polite | `aria-live` assertive | `role="status"` | `role="alert"` | `inert` |
| :-------------- | :-------------- | :----------------- | :-------------------- | :-------------- | :------------- | :------ |
| VoiceOver       | iOS / iPadOS    | Yes                | Yes                   | Yes             | Yes            | Yes (iOS 15+) |
| VoiceOver       | macOS           | Yes                | Yes                   | Yes             | Yes            | Yes     |
| TalkBack        | Android         | Yes                | Yes                   | Yes             | Yes            | Yes (Android 13+) |
| NVDA            | Windows         | Yes                | Yes                   | Yes             | Yes            | Yes     |
| JAWS            | Windows         | Yes                | Yes                   | Yes             | Yes            | Yes     |
| Narrator        | Windows         | Yes                | Yes                   | Yes             | Yes            | Yes     |
| Orca            | Linux           | Yes                | Yes                   | Yes             | Yes            | Yes     |

---

## 11. PWA Manifest Slot-Specific

### 11.1 `manifest.webmanifest` Canonical Slot Template

```json
{
  "name": "Slot Game",
  "short_name": "Slot",
  "id": "/slot-game",
  "start_url": "/?source=pwa",
  "scope": "/",
  "display": "standalone",
  "display_override": ["standalone", "fullscreen", "minimal-ui"],
  "orientation": "portrait-primary",
  "background_color": "#0a0a0a",
  "theme_color": "#0a0a0a",
  "icons": [
    { "src": "/icons/192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/192-maskable.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/icons/512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "screenshots": [
    { "src": "/screenshots/portrait-1.webp", "sizes": "1080x1920", "type": "image/webp", "form_factor": "narrow" }
  ],
  "categories": ["games"],
  "lang": "en-US",
  "dir": "ltr",
  "prefer_related_applications": false
}
```

### 11.2 Field Reference

| Field                  | Purpose                                                           | Slot-game value & rationale                |
| :--------------------- | :---------------------------------------------------------------- | :----------------------------------------- |
| `name`                 | Full app name in installers / launchers                           | Game title                                 |
| `short_name`           | ≤ 12 chars, used on home screen icon label                        | Brand abbreviation                         |
| `id`                   | Stable identity even if `start_url` changes                       | `/slot-game`                               |
| `start_url`            | URL opened on launch                                              | `/?source=pwa` (tracks PWA installs)       |
| `scope`                | URLs the PWA can navigate to without exiting installed mode       | `/`                                        |
| `display`              | Chrome reveal level                                               | `standalone` (no browser chrome)           |
| `display_override`     | Ordered preference list (Chromium 89+)                            | `[standalone, fullscreen, minimal-ui]`     |
| `orientation`          | Locked orientation                                                | `portrait-primary` for portrait slots; `any` for both |
| `background_color`     | Splash screen color before app paints                             | Match theme background                     |
| `theme_color`          | OS-level UI bar tint (status bar, address bar)                    | Match theme accent                         |
| `icons`                | App icons for launcher / installer                                | 192 + 512, both any and maskable           |
| `screenshots`          | Install prompt preview (Chromium 96+)                             | 1+ portrait, 1+ landscape                  |
| `categories`           | App store taxonomy                                                | `["games"]`                                |
| `lang`                 | Default language                                                  | BCP 47 tag                                 |
| `dir`                  | Text direction                                                    | `ltr` or `rtl`                             |
| `prefer_related_applications` | Suggest native app over PWA                                | `false` (we want PWA install)              |

### 11.3 `display` Mode Comparison

| Mode          | Browser UI shown    | Status bar shown | Slot suitability                                    |
| :------------ | :------------------ | :--------------- | :-------------------------------------------------- |
| `browser`     | Full                | Yes              | Not used for slots                                  |
| `minimal-ui`  | Minimal (back/forward, sometimes URL) | Yes | Fallback only                                |
| `standalone`  | None                | Yes (OS chrome)  | **Recommended for slots**                           |
| `fullscreen`  | None                | No               | Only if game truly needs all pixels; status bar can hide RG icons |

### 11.4 Orientation Lock Caveats

| Manifest value          | iOS PWA behavior                  | Android PWA behavior                 |
| :---------------------- | :-------------------------------- | :----------------------------------- |
| `portrait-primary`      | Ignored (iOS does not honor lock from manifest as of 17.5) | Honored from Android 11+ |
| `landscape-primary`     | Ignored                           | Honored from Android 11+             |
| `any`                   | Default behavior                  | Default behavior                     |
| `natural`               | Ignored                           | Honored                              |

For iOS portrait-only slots, additionally call `screen.orientation.lock('portrait')` from a user gesture — but expect a `NotSupportedError` (returns rejected promise; handle silently).

### 11.5 Service Worker Cache Strategy for Slot Asset Bundle

| Asset class             | Strategy                  | TTL / invalidation                          |
| :---------------------- | :------------------------ | :------------------------------------------ |
| HTML shell              | Network-first → cache fallback | TTL 0 (always check)                   |
| JS / CSS bundles        | Cache-first, hashed names | Forever — new hash on update                |
| Sprite atlases (WebP)   | Cache-first, hashed names | Forever                                     |
| Font files              | Cache-first               | 30 days                                     |
| Manifest                | Network-first             | TTL 0                                       |
| Icons                   | Cache-first               | 30 days                                     |
| API endpoints           | Network only              | No cache (auth-sensitive)                   |
| GDD JSON model          | Cache-first, hashed       | Forever — new hash on game build            |

```js
// sw.js — minimal example
const SHELL = ['/index.html', '/css/app.css', '/js/app.js'];
const CACHE_VERSION = 'slot-v1';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_VERSION).then(c => c.addAll(SHELL)));
});

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.pathname.startsWith('/api/')) {
    return;          // network only
  }
  if (u.pathname.match(/\.(js|css|webp|woff2)$/) && /\.[0-9a-f]{8}\./.test(u.pathname)) {
    e.respondWith(caches.match(e.request).then(c => c || fetch(e.request).then(r => {
      const clone = r.clone();
      caches.open(CACHE_VERSION).then(cache => cache.put(e.request, clone));
      return r;
    })));
    return;
  }
  // default: network with cache fallback
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
```

### 11.6 Add-to-Homescreen Prompt UX

Browsers vary in how they expose the install prompt:

| Browser            | Prompt event                | Programmatic trigger                            | Notes                              |
| :----------------- | :-------------------------- | :---------------------------------------------- | :--------------------------------- |
| Chromium (Android, desktop) | `beforeinstallprompt` | `event.prompt()` after user gesture        | Cancel on PWA install              |
| Safari iOS         | None                        | None — user must use Share → Add to Home Screen | Show custom hint banner            |
| Safari macOS       | None                        | None                                            | Show custom hint                   |
| Firefox            | None                        | None                                            | Show custom hint                   |
| Samsung Internet   | `beforeinstallprompt`       | Same as Chromium                                | Same                               |

For iOS, deploy a one-time dismissable banner: "Add to Home Screen for fullscreen play" with iOS-specific instructions and an OS-detected Share icon.

### 11.7 Slot-Specific Manifest Validations

| Validator check                         | Pass criterion                              |
| :-------------------------------------- | :------------------------------------------ |
| `display` is `standalone` or `fullscreen` | Both acceptable; never `browser`        |
| Icon at 192 and 512 px exist            | Both required                               |
| Maskable icon variant exists            | Required for Android adaptive icons         |
| `theme_color` and `background_color` defined | Required for splash screen             |
| `start_url` is in scope                 | Must be within `scope`                      |
| `start_url` does not require auth       | Splash → blank screen if redirected         |

---

## 12. iOS Safari Quirks Catalog

### 12.1 The `100vh` Scroll Bug (Pre-15.4)

| iOS Safari version | `100vh` resolves to       | Workaround required |
| :----------------- | :------------------------ | :------------------ |
| ≤ 15.3             | Largest viewport (≈ `lvh`) | Yes — use JS `window.innerHeight` or `--vh: 1%` hack |
| ≥ 15.4             | Same as `lvh` (now stable) — and `svh`/`dvh`/`lvh` available | No — use `dvh` |

**Modern fix**: use `100dvh` with `100lvh` fallback (see section 1).

### 12.2 WebGL Context Loss on Background

iOS Safari aggressively discards WebGL contexts when the tab is backgrounded or device sleeps. Slot canvases must handle:

```js
canvas.addEventListener('webglcontextlost', e => {
  e.preventDefault();          // prevents default — allows recovery
  engine.pause();
});
canvas.addEventListener('webglcontextrestored', () => {
  engine.reloadAssets();       // re-upload textures
  engine.resume();
});
```

| Scenario                            | iOS Safari behavior        | Mitigation                           |
| :---------------------------------- | :------------------------- | :----------------------------------- |
| App switch (multitask)              | Context lost after ~5 s    | Pause + listen for restore           |
| Phone locked, returned within 30 s  | Usually retained           | Same listener                        |
| Phone locked > 30 s                 | Context lost               | Same                                 |
| Low memory                          | Context lost without warning | Same                              |
| Low Power Mode toggled              | Sometimes lost             | Same                                 |

### 12.3 AudioContext Suspended on Page Load

`AudioContext` constructed before a user gesture starts in `suspended` state. (Out of slot-gdd-factory scope per `rule_audio_off_until_asked`, but noted for architects.)

### 12.4 iOS Low Power Mode → 30 fps Cap

When Low Power Mode is active:

| Subsystem                  | Effect                          |
| :------------------------- | :------------------------------ |
| `requestAnimationFrame`    | Capped at 30 fps                |
| CSS animations / transitions | Same cap                      |
| Background tab            | Throttled further (1 fps)       |
| WebGL                      | Capped at 30 fps                |
| Network polling            | Background fetch limited        |

**Detection**: no direct API. Heuristic — measure rAF delta over 1 second; if > 25 ms average, treat as low-power.

```js
let frames = 0;
let start = performance.now();
function probe() {
  frames++;
  if (frames < 60) { requestAnimationFrame(probe); return; }
  const fps = (frames * 1000) / (performance.now() - start);
  if (fps < 45) game.setLowPowerMode(true);
}
requestAnimationFrame(probe);
```

### 12.5 iOS Haptic API Behind Feature Flag

As of iOS 17.5, there is no exposed Web Haptic API. (See section 3 for full discussion.) The `WebAPIs.Haptics` flag rumored in Safari Technology Preview is not in any shipped stable Safari.

### 12.6 Other Catalog Entries

| Quirk                                                    | iOS version affected   | Mitigation                                       |
| :------------------------------------------------------- | :--------------------- | :----------------------------------------------- |
| `position: fixed` jitter when virtual keyboard appears   | All                    | Use `position: sticky` or `visualViewport` event |
| Smooth scrolling lost in PWA standalone                  | ≤ 16.x                 | Use `overflow-y: auto` + `-webkit-overflow-scrolling: touch` (deprecated, but still works) |
| `100vw` includes scrollbar (where scrollbars exist)      | All                    | Use `100svw` or compute via `document.documentElement.clientWidth` |
| `<input type="number">` shows letters keyboard sometimes | All                    | Use `inputmode="decimal"` and `pattern`          |
| Date input UI shows custom UA picker                     | All                    | Style minimally; accept native picker            |
| `fetch()` does not send `Cookie` for same-origin in installed PWA | 14.x         | Use credentials: 'include' explicitly            |
| LocalStorage cleared on app removal                      | All                    | Use IndexedDB for important data                 |
| IndexedDB quota reset by Storage Pressure (ITP)          | 13+                    | Re-fetch from server on quota error              |
| `prefers-color-scheme` ignored in PWA standalone on iOS  | ≤ 16.x                 | Manual toggle in settings                        |
| Touch events fire before pointer events                  | All                    | Use Pointer Events only; `touch-action: manipulation` |
| `:hover` sticks after tap on iOS Safari                  | All                    | Use `@media (hover: hover)` to scope hover styles |
| `transform: translate3d(0,0,0)` GPU layer kick required for some animations | ≤ 15      | Use `will-change: transform`                     |
| `transition` skipped on first paint                      | All                    | Two-rAF delay before adding transition class     |
| Service worker cache evicted aggressively                | All                    | Bound cache size; re-prime on launch             |
| Vibration API blocked                                    | All                    | See section 3                                    |
| Gamepad haptic actuators empty                           | All                    | Same                                             |
| `navigator.share` requires user gesture                  | All                    | Wire to button click only                        |
| Bluetooth, USB, HID Web APIs absent                      | All                    | No fallback — use native hybrid                  |
| WebRTC video autoplay requires `playsinline`             | All                    | Set attribute on every `<video>`                 |
| `requestFullscreen()` on `<canvas>` opens fullscreen video player, not canvas | ≤ 16  | Use CSS-based fullscreen layout instead          |
| `setTimeout` minimum delay 4 ms (not 1 ms)               | All                    | Use `MessageChannel` for sub-4ms scheduling      |
| `visibilitychange` fires on tab change but not always on lock | All              | Combine with `pageshow`/`pagehide`               |
| iOS Safari 17 caps `requestIdleCallback` at 50 ms slices  | 17+                    | Yield with `await new Promise(setTimeout)`        |

---

## 13. Citation Index

> Every numbered claim above traces to a citation here. URLs are stable as of 2026-06.

| #   | Topic                                  | Citation                                                                                       |
| --: | :------------------------------------- | :--------------------------------------------------------------------------------------------- |
| C1  | CSS viewport units (`vh`, `dvh`, `svh`, `lvh`) | CSS Values and Units Module Level 4 — `https://www.w3.org/TR/css-values-4/#viewport-relative-lengths` |
| C2  | `dvh` browser support                  | MDN: Viewport-percentage lengths — `https://developer.mozilla.org/en-US/docs/Web/CSS/length#viewport-percentage_lengths` |
| C3  | `viewport-fit=cover` semantics         | CSS Round Display Module Level 1 §6 — `https://www.w3.org/TR/css-round-display-1/#viewport-fit-descriptor` |
| C4  | `env(safe-area-inset-*)`               | CSS Environment Variables Module Level 1 — `https://www.w3.org/TR/css-env-1/`                  |
| C5  | iPhone safe-area dimensions            | Apple HIG: Layout — `https://developer.apple.com/design/human-interface-guidelines/layout` |
| C6  | Android Display Cutout API             | Android Developers: Display Cutout — `https://developer.android.com/develop/ui/views/layout/display-cutout` |
| C7  | Web Vibration API                      | W3C: Vibration API — `https://www.w3.org/TR/vibration/`                                        |
| C8  | iOS Safari `navigator.vibrate` no-op   | WebKit Bug 173 — historical bug tracker reference; MDN compatibility table on `navigator.vibrate` — `https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate` |
| C9  | `UIImpactFeedbackGenerator`            | Apple Developer: UIFeedbackGenerator — `https://developer.apple.com/documentation/uikit/uifeedbackgenerator` |
| C10 | Android `VibrationEffect`              | Android Developers: VibrationEffect — `https://developer.android.com/reference/android/os/VibrationEffect` |
| C11 | WCAG 2.2 Recommendation                | W3C: WCAG 2.2 — `https://www.w3.org/TR/WCAG22/`                                                |
| C12 | SC 1.4.3 Contrast Minimum              | `https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html`                            |
| C13 | SC 1.4.10 Reflow                       | `https://www.w3.org/WAI/WCAG22/Understanding/reflow.html`                                      |
| C14 | SC 1.4.11 Non-text Contrast            | `https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html`                           |
| C15 | SC 1.4.12 Text Spacing                 | `https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html`                                |
| C16 | SC 1.4.13 Content on Hover or Focus    | `https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html`                   |
| C17 | SC 2.1.1 Keyboard                      | `https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html`                                    |
| C18 | SC 2.1.2 No Keyboard Trap              | `https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html`                            |
| C19 | SC 2.2.1 Timing Adjustable             | `https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html`                           |
| C20 | SC 2.3.1 Three Flashes                 | `https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html`            |
| C21 | SC 2.4.7 Focus Visible                 | `https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html`                               |
| C22 | SC 2.5.5 Target Size (Enhanced)        | `https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html`                        |
| C23 | SC 2.5.7 Dragging Movements            | `https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html`                          |
| C24 | SC 2.5.8 Target Size (Minimum)         | `https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html`                         |
| C25 | SC 3.2.6 Consistent Help               | `https://www.w3.org/WAI/WCAG22/Understanding/consistent-help.html`                             |
| C26 | SC 3.3.7 Redundant Entry               | `https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html`                             |
| C27 | SC 3.3.8 Accessible Authentication (Min) | `https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html`         |
| C28 | `touch-action`                         | MDN: `touch-action` — `https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action`          |
| C29 | `pointer-events`                       | MDN: `pointer-events` — `https://developer.mozilla.org/en-US/docs/Web/CSS/pointer-events`      |
| C30 | `user-select`                          | MDN: `user-select` — `https://developer.mozilla.org/en-US/docs/Web/CSS/user-select`            |
| C31 | Apple HIG accessibility / target size  | `https://developer.apple.com/design/human-interface-guidelines/accessibility`                  |
| C32 | Material Design 3 touch target         | `https://m3.material.io/foundations/designing/structure`                                       |
| C33 | `prefers-reduced-motion`               | MDN: `prefers-reduced-motion` — `https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion` |
| C34 | CSS Media Queries Level 5              | `https://www.w3.org/TR/mediaqueries-5/`                                                        |
| C35 | ARIA live regions                      | W3C ARIA 1.2 §6.6.18 — `https://www.w3.org/TR/wai-aria-1.2/#aria-live`                         |
| C36 | `role="status"`                        | `https://www.w3.org/TR/wai-aria-1.2/#status`                                                   |
| C37 | `role="alert"`                         | `https://www.w3.org/TR/wai-aria-1.2/#alert`                                                    |
| C38 | `inert` attribute                      | HTML Living Standard §3.2.6 — `https://html.spec.whatwg.org/multipage/interaction.html#the-inert-attribute` |
| C39 | Web App Manifest                       | W3C: Web App Manifest — `https://www.w3.org/TR/appmanifest/`                                   |
| C40 | `display_override`                     | W3C Appmanifest §display modes — `https://www.w3.org/TR/manifest-app-info/#display_override-member` |
| C41 | Maskable icons                         | W3C: Maskable icon — `https://www.w3.org/TR/appmanifest/#purpose-member` and `https://web.dev/articles/maskable-icon` |
| C42 | `beforeinstallprompt`                  | MDN: BeforeInstallPromptEvent — `https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent` |
| C43 | Service Worker spec                    | W3C: Service Workers — `https://www.w3.org/TR/service-workers/`                                |
| C44 | Pointer Events Level 3                 | W3C: Pointer Events — `https://www.w3.org/TR/pointerevents3/`                                  |
| C45 | `visualViewport` API                   | `https://www.w3.org/TR/visual-viewport/`                                                       |
| C46 | iOS WebGL context loss                 | WebKit Blog: Power and Memory — `https://webkit.org/blog/` (search archive)                    |
| C47 | iOS Low Power Mode rAF cap             | Apple Developer Forums + WebKit bugzilla; behavior documented in MDN compatibility notes        |
| C48 | Web Vibration API user-gesture gate    | Chromium bug 728777 — `https://crbug.com/728777` (gated since 60)                              |
| C49 | Three Flashes harness                  | Trace Center: Photosensitive Epilepsy Analysis Tool (PEAT) — `https://trace.umd.edu/peat/`     |
| C50 | Color blindness simulation             | Coblis — `https://www.color-blindness.com/coblis-color-blindness-simulator/`                   |
| C51 | iOS PWA `orientation` lock ignored     | WebKit feature request log — historical                                                        |
| C52 | `screen.orientation.lock`              | W3C Screen Orientation — `https://www.w3.org/TR/screen-orientation/`                           |
| C53 | `inputmode` attribute                  | HTML Living Standard — `https://html.spec.whatwg.org/multipage/interaction.html#input-modalities:-the-inputmode-attribute` |
| C54 | `prefers-color-scheme`                 | MDN — `https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme`           |
| C55 | `:focus-visible`                       | MDN — `https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible`                        |

---

## 14. Appendix A — Block Coverage Mapping

> Mapping of each `src/blocks/*.mjs` block to the WCAG criteria, touch rules, and haptic hooks it must own.

| Block                       | WCAG SCs owned                              | Touch rules         | Haptic hooks fired                              |
| :-------------------------- | :------------------------------------------ | :------------------ | :---------------------------------------------- |
| `spinButton.mjs`            | 1.4.3, 1.4.11, 2.1.1, 2.5.5, 2.5.8, 2.4.7  | 44+ size, `touch-action: manipulation`, hit-slop | press, slam, turbo |
| `betPicker.mjs`             | 1.4.3, 1.4.11, 2.1.1, 2.5.7, 2.5.8, 2.4.7  | +/- buttons 44+, no drag-only                    | tick on +/-       |
| `autoplay.mjs`              | 2.1.1, 2.2.1, 2.5.7, 2.5.8                  | 44+ size                                         | start, pause, end |
| `hud.mjs` (balance, win, bet) | 1.4.3, 1.4.10, 1.4.12, 3.2.6              | reflow at 320 px                                 | none              |
| `paytable.mjs`              | 1.4.3, 1.4.10, 1.4.11, 1.4.12, 1.4.13, 2.1.1, 2.1.2, 2.4.7 | dialog focus trap, scroll alt to drag | none |
| `settings.mjs`              | 1.4.3, 1.4.10, 2.1.1, 2.1.2, 2.4.7, 2.5.8  | dialog focus trap                                | none              |
| `toast.mjs`                 | 1.4.3, 1.4.11                               | none (non-interactive)                            | optional confirm  |
| `winPresentation.mjs`       | 2.3.1                                       | n/a                                              | small/medium/big win pattern |
| `bigWin.mjs`                | 2.3.1                                       | n/a                                              | roll-up + finale  |
| `jackpot.mjs`               | 2.3.1                                       | n/a                                              | jackpot pattern   |
| `freeSpinIntro.mjs`         | 2.3.1                                       | n/a                                              | FS trigger pattern |
| `freeSpinRetrigger.mjs`     | 2.3.1                                       | n/a                                              | FS retrigger pattern |
| `motionPreference.mjs`      | (utility — provides hook)                   | n/a                                              | n/a               |
| `viewportRoot.mjs`          | 1.4.10                                      | safe-area insets, dvh/svh                        | n/a               |
| `keyboardRouter.mjs`        | 2.1.1, 2.1.2                                | key bindings                                     | n/a               |
| `srLiveRegions.mjs`         | (cross-cutting)                             | n/a                                              | n/a               |
| `focusTrap.mjs`             | 2.1.2, 2.4.7                                | n/a                                              | n/a               |
| `reducedMotionGuard.mjs`    | 2.3.1                                       | n/a                                              | suppresses all haptics if user opts out (see Appendix C) |

---

## 15. Appendix B — Test Fixture Proposals

### 15.1 Fixture File Tree

```
tests/
├── a11y/
│   ├── contrast.spec.mjs              ← 1.4.3, 1.4.11
│   ├── reflow.spec.mjs                ← 1.4.10
│   ├── text-spacing.spec.mjs          ← 1.4.12
│   ├── keyboard.spec.mjs              ← 2.1.1, 2.1.2
│   ├── timing.spec.mjs                ← 2.2.1
│   ├── flashes.spec.mjs               ← 2.3.1
│   ├── focus-visible.spec.mjs         ← 2.4.7
│   ├── dragging.spec.mjs              ← 2.5.7
│   ├── target-size.spec.mjs           ← 2.5.5, 2.5.8
│   ├── live-regions.spec.mjs          ← 4.1.3 / SR catalog
│   └── reduced-motion.spec.mjs        ← motion-* tests
├── mobile/
│   ├── viewport-units.spec.mjs        ← dvh/svh/lvh resolution
│   ├── safe-area.spec.mjs             ← inset behavior simulation
│   ├── touch-action.spec.mjs          ← no double-tap delay assert
│   └── orientation.spec.mjs           ← portrait/landscape inset swap
├── pwa/
│   ├── manifest.spec.mjs              ← schema + slot-specific rules
│   ├── service-worker.spec.mjs        ← cache strategy
│   └── install-prompt.spec.mjs        ← deferred prompt flow
└── haptic/
    ├── pattern-emitter.spec.mjs       ← assert navigator.vibrate called with expected pattern
    ├── ios-no-haptic.spec.mjs         ← assert no-op on iOS UA
    └── reduced-motion-suppress.spec.mjs ← assert no haptic when user opts out
```

### 15.2 Sample Fixture Skeleton — `target-size.spec.mjs`

```js
import { test, expect } from 'playwright/test';

test.describe('SC 2.5.8 Target Size (Minimum)', () => {
  test('every interactive control measures >= 24x24 CSS px', async ({ page }) => {
    await page.goto('/?game=fixture');
    const targets = await page.$$eval(
      'button, [role="button"], a, input, [tabindex]:not([tabindex="-1"])',
      els => els.map(el => {
        const rect = el.getBoundingClientRect();
        return { id: el.id || el.getAttribute('aria-label') || el.tagName, w: rect.width, h: rect.height };
      })
    );
    for (const t of targets) {
      expect(t.w, `width of ${t.id}`).toBeGreaterThanOrEqual(24);
      expect(t.h, `height of ${t.id}`).toBeGreaterThanOrEqual(24);
    }
  });

  test('primary spin button measures >= 44x44 (AAA enhanced)', async ({ page }) => {
    await page.goto('/?game=fixture');
    const rect = await page.locator('[data-spin-button]').boundingBox();
    expect(rect.width).toBeGreaterThanOrEqual(44);
    expect(rect.height).toBeGreaterThanOrEqual(44);
  });
});
```

### 15.3 Sample Fixture Skeleton — `flashes.spec.mjs`

```js
import { test, expect } from 'playwright/test';
import { computeLuminancePeaks } from '../helpers/peat.mjs';

test('2.3.1 Three Flashes — big-win finale stays under 3 Hz', async ({ page }) => {
  await page.goto('/?game=fixture&forceBigWin=true');
  const frames = [];
  await page.evaluate(() => window.__capture = (frame) => window.__frames.push(frame));
  // Run big-win animation
  await page.click('[data-spin-button]');
  await page.waitForFunction(() => window.__frames.length > 180);    // 3 s @ 60 fps
  const peaks = computeLuminancePeaks(await page.evaluate(() => window.__frames));
  for (let i = 0; i < peaks.length - 60; i++) {
    const window1s = peaks.slice(i, i + 60).filter(Boolean).length;
    expect(window1s, `flash count in 1s window starting frame ${i}`).toBeLessThanOrEqual(3);
  }
});
```

### 15.4 Sample Fixture Skeleton — `pattern-emitter.spec.mjs`

```js
import { test, expect } from 'playwright/test';

test('Android UA: spin button click vibrates with 10 ms pulse', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'iOS does not support vibration');
  const calls = [];
  await page.exposeFunction('__hapticTrap', (pattern) => calls.push(pattern));
  await page.addInitScript(() => { navigator.vibrate = (p) => { window.__hapticTrap(p); return true; }; });
  await page.goto('/?game=fixture');
  await page.click('[data-spin-button]');
  expect(calls[0]).toBe(10);
});

test('iOS UA: spin button click does not error even though haptic is no-op', async ({ page }) => {
  await page.goto('/?game=fixture&forceUA=ios');
  await page.click('[data-spin-button]');
  // No assertion on haptic — just that flow continues
  await expect(page.locator('[data-spin-state="spinning"]')).toBeVisible();
});
```

### 15.5 Coverage Goals

| Layer            | Target coverage                                        |
| :--------------- | :----------------------------------------------------- |
| Per-block unit   | 100 % lifecycle hook calls assertable                  |
| WCAG SC fixtures | All 15 slot-relevant criteria from section 5.3         |
| Haptic emitters  | One assertion per pattern in section 4.6               |
| Browser matrix   | At least Chromium + WebKit; Firefox optional           |
| Viewport sizes   | 320, 360, 390, 414, 430, 768, 1024, 1280 CSS px        |
| Orientation      | Portrait + landscape for every viewport                |
| Reduced motion   | Both `reduce` and `no-preference` for every motion test |
| Prefers color    | `light` and `dark` snapshot per dialog                 |

---

## 16. Appendix C — Decision Heuristics for Architects

### 16.1 "Should this block fire haptic?"

```
Is the event user-initiated (tap/key)?
├── Yes → emit haptic via tryHaptic(<kind>) inside the gesture stack frame.
│         Kind: light=press, medium=stop, heavy=slam, success=win.
└── No  → Is it a celebration (big-win, jackpot, FS trigger)?
          ├── Yes → emit choreographed pattern from section 4.6.
          │         Respect reduced-motion guard.
          └── No  → DO NOT emit. Examples: idle ambient, reel travelling, balance change.
```

### 16.2 "Should this block announce via SR?"

```
Is the event one of: win, FS trigger, jackpot, autoplay state change, RG event?
├── Yes → assertive (alert) for RG / jackpot / forced stop; polite (status) otherwise.
└── No  → DO NOT add aria-live. Examples: bet step (debounce 500 ms then polite),
           per-reel stop (never), per-spin no-win (never — aggregate to summary).
```

### 16.3 "What CSS unit do I use for height?"

```
Is the container the game stage (full-bleed background)?
├── Yes → 100lvh (stable, never shrinks).
└── No  → Is it a top/bottom fixed dock?
          ├── Yes → 100svh (never collides with chrome).
          └── No  → Is it a scaling main column that should track chrome?
                    ├── Yes → 100dvh.
                    └── No  → 100lvh.
```

### 16.4 "What touch-action do I set?"

```
Is it a button?
├── Yes → touch-action: manipulation (removes 300 ms delay).
└── No  → Is it a sliding control (bet, autoplay picker)?
          ├── Yes → touch-action: pan-x (or pan-y).
          └── No  → Is it an internal scroll container?
                    ├── Yes → touch-action: pan-y.
                    └── No  → Is it a decorative overlay?
                              ├── Yes → pointer-events: none.
                              └── No  → leave default.
```

### 16.5 "Is my contrast OK?"

```
Is the text below 18 pt (and not 14 pt bold)?
├── Yes → require >= 4.5:1.
└── No  → require >= 3:1.

Is the element a UI outline / icon / focus ring?
└── require >= 3:1 against adjacent color.

Is the element decorative (background art)?
└── No requirement (but: do not place text over it without a scrim).
```

### 16.6 "Does my animation need a reduced-motion alternative?"

```
Is the animation longer than 250 ms?
├── Yes → required alternative.
└── No  → Is it a continuous loop (idle ambient)?
          ├── Yes → required alternative (suppress).
          └── No  → Is it a transform with scale > 1.2 or translate > 32 px?
                    ├── Yes → required alternative.
                    └── No  → optional; recommend keeping anyway.
```

### 16.7 "Does this dialog need focus trap?"

```
Is the dialog modal (blocks interaction with content behind)?
├── Yes → focus trap + inert behind + Escape closes + return focus to opener.
└── No  → no trap; but still close on Escape if visible.
```

### 16.8 "Does this UI need an SR live region?"

```
Is the UI a transient toast / alert?
├── Yes → role="status" (polite) or role="alert" (assertive).
└── No  → Is it a state readout (balance, bet, win)?
          ├── Yes → aria-live="polite" on the readout itself, debounced.
          └── No  → no live region.
```

### 16.9 "Can I rely on this haptic on iOS web?"

```
Are you in a native hybrid app (WKWebView) with a JS bridge to UIImpactFeedbackGenerator?
├── Yes → emit via bridge; expect to work.
└── No  → DO NOT rely on it. iOS web has no vibration API.
          Design must work fully silent (haptic-wise) on iOS.
```

### 16.10 "Is my hit area large enough?"

```
Apply the largest applicable threshold:
- AA minimum: 24 x 24 (SC 2.5.8)
- AAA: 44 x 44 (SC 2.5.5)
- Apple HIG: 44 x 44
- Material 3: 48 x 48

If visual size is smaller, expand via ::after { inset: -N px; }.
If overlap with neighbor would occur, increase neighbor spacing instead.
```

### 16.11 "Should I lock orientation?"

```
Is the game designed only for portrait?
├── Yes → manifest orientation: portrait-primary
│         + screen.orientation.lock('portrait') in gesture (handle iOS rejection silently)
│         + CSS @media (orientation: landscape) → show "rotate to portrait" hint screen.
└── No  → manifest orientation: any
          + responsive CSS for both.
```

### 16.12 Quick Self-Audit Before Block PR

| Question                                                  | Pass criterion                                  |
| :-------------------------------------------------------- | :---------------------------------------------- |
| Does every interactive element have an `aria-label` or visible text? | Yes                                  |
| Is every target ≥ 24 × 24 CSS px (24 absolute min, 44 preferred)? | Yes                                |
| Does the block work with `prefers-reduced-motion: reduce`? | Yes                                            |
| Does the block work fully without haptic (e.g., on iOS)?   | Yes                                            |
| Does the block read insets via `env()` not hardcoded?      | Yes                                            |
| Does the block use `100dvh`/`svh`/`lvh` rather than `100vh`? | Yes                                          |
| Is keyboard navigation tested?                             | Yes                                            |
| Are SR announcements debounced / not per-frame?            | Yes                                            |
| Is `touch-action: manipulation` set on buttons?            | Yes                                            |
| Is `pointer-events: none` set on decorative overlays?      | Yes                                            |
| Is `user-select: none` set on chrome text?                 | Yes                                            |
| Is contrast ≥ 4.5:1 for text (3:1 for large)?              | Yes                                            |
| Is contrast ≥ 3:1 for UI outlines and icons?               | Yes                                            |
| Does the block respect `safe-area-inset-*` on all 4 sides? | Yes                                            |

---

## End of Encyclopedia

> Drift control: any block that fails ≥ 2 self-audit checks in section 16.12 must be flagged in the master TODO under "WCAG drift" and patched within the same wave.
> No exceptions for "decorative" blocks — if a block paints UI, the lifecycle + a11y rules apply.
> Per `rule_audio_off_until_asked`, this document deliberately does not address audio carriers for any of these events. The information channel ledger is: visual (required) + haptic (additive, platform-permitting) + audio (out of scope until Boki signals).
> Per `rule_no_vendor_mentions`, all comparisons in this document refer to "industry baseline" or "reference benchmark" — no vendor or title names appear.
