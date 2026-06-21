# Domain Agent · UX_ARCHITECT

Wave Z2 — UX expertise injected when archetype's agent owner = UX_ARCHITECT.

## Mission

Ensure synthesized block matches reference-grade industry presentation —
accessibility (WCAG 2.1 AA), motion safety (prefers-reduced-motion),
touch target ≥ 44 px, color-blind safety, screen reader compatibility,
and ARIA semantics.

## Hard rules

1. **Touch targets ≥ 44 × 44 px.** Mobile-first; baselined u themeCSS.
2. **`prefers-reduced-motion: reduce` mora disable-ovati sve animacije.**
   Block emits CSS:
   ```css
   @media (prefers-reduced-motion: reduce) {
     .my-block-element { transition: none !important; animation: none !important; }
   }
   ```
3. **Modal triggers (reveal, jackpot tier) MORAJU imati `role="dialog"` + `aria-modal="true"`.**
4. **Focus trap** — kad modal otvori, focus mora ostati unutar; ESC ili COLLECT zatvara.
5. **Live region za announcements** — `<div aria-live="polite" aria-atomic="true">` za sticky update,
   meter charge, ladder climb.
6. **Color-blind safe** — nikad samo na color rely (red/green). Uvek + ikona/shape.
7. **No emoji u block source** unless `rule_emojis_only_if_user_asks` proverenom kontekstu.
8. **High-contrast mode** — block mora respektovati `@media (forced-colors: active)`.

## Scaffolder injection patterns

Generated CSS block:

```css
/* prefers-reduced-motion safety */
@media (prefers-reduced-motion: reduce) {
  .{prefix}-{name} { transition: none !important; animation: none !important; }
}
/* High-contrast */
@media (forced-colors: active) {
  .{prefix}-{name} { border: 2px solid CanvasText; }
}
/* Touch target sizing */
.{prefix}-{name}-cta { min-width: 44px; min-height: 44px; }
```

Generated markup template:

```js
/* role + aria-modal for any reveal/jackpot/picker UI */
markup += `<div role="dialog" aria-modal="true" aria-labelledby="{name}-title">`;
markup += `  <h2 id="{name}-title">{title}</h2>`;
markup += `  <div aria-live="polite" aria-atomic="true">{description}</div>`;
markup += `</div>`;
```

Generated runtime — focus trap:

```js
const focusables = root.querySelectorAll('button, [tabindex="0"]');
const first = focusables[0], last = focusables[focusables.length - 1];
root.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Tab') {
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }
});
```

## Testing

Required asserts in synthesized test:

```js
block('UX contract', () => {
  const css = emit{Name}CSS(cfg);
  t('1. prefers-reduced-motion clause present',
    css.includes('prefers-reduced-motion: reduce'));
  t('2. forced-colors clause present',
    css.includes('forced-colors: active'));
  t('3. touch targets ≥ 44px', /min-(?:width|height):\s*4[4-9]px/.test(css));
  const markup = emit{Name}Markup(cfg);
  if (markup) {
    t('4. role=dialog declared', /role="dialog"/.test(markup));
    t('5. aria-modal declared', /aria-modal="true"/.test(markup));
  }
});
```
