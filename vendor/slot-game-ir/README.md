# Vendored: @boki/slot-game-ir v0.1.0

Built from https://github.com/Bojan20/slot-game-ir (commit `2ffc7b2`) on 2026-06-02.

## How to use from `app.js`

```js
import { parseGameIR } from './vendor/slot-game-ir/index.js';

// ... after pulling a JSON candidate out of the dropped GDD:
const r = parseGameIR(candidate);
if (!r.ok) {
  console.warn('GDD not yet IR-compliant', r.issues);
} else {
  // r.ir is fully validated SlotGameIR — pass to engine / studio / RGS
}
```

## Refresh

```bash
cd ~/Projects/slot-game-ir && npm run build
cp -r dist/* ~/Projects/slot-gdd-factory/vendor/slot-game-ir/
```
