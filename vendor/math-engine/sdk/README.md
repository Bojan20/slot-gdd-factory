# @slot-math-engine/sdk

Official TypeScript SDK for `slot-math-engine`. Lets third-party developers
compute RTP, run server-authoritative spins, stream live wallet + spin events
over WebSocket, and author their own math kernels on top of the engine.

- Production-grade Fastify server it targets ships in the same monorepo
- 6352 specs PASS at the time of W207-DOCS
- 77 closed-form solver kernels covering 100% of Vendor B mehanika
- 15 jurisdiction overlay (UKGC, MGA, NV, NJ, PA, MI, ON, BC, AAMS, DGA, SGA, KSA, GBGA, SK, AGCO)

## Install

```bash
npm install @slot-math-engine/sdk
```

Requires Node 18+ (native `fetch`) or any modern browser. Node 22+ also
exposes `WebSocket` globally; for older runtimes pass `opts.webSocketImpl`.

## 5-minute quickstart

```typescript
import { SlotMathClient, IRBuilder } from '@slot-math-engine/sdk';

const client = new SlotMathClient({
  apiUrl: 'http://localhost:4000',
  apiKey: 'YOUR_KEY', // optional in dev mode
});

// 1. Build an IR document fluently.
const ir = new IRBuilder()
  .gameId('demo-game-1')
  .topology({ kind: 'rectangular', reels: 5, rows: 3 })
  .symbolPool({ HP: 3, MP: 3, LP: 3, WILD: 1 })
  .feature('free_spins', { trigger: 3, count: 10 })
  .rtpTarget(0.955)
  .jurisdictions(['UKGC', 'MGA'])
  .build();

// 2. Compute closed-form RTP.
const result = await client.computeRTP(ir);
console.log(`RTP=${result.rtp} hitFreq=${result.hitFrequency}`);

// 3. Server-authoritative spin.
const spin = await client.spin('demo-game-1', 'sess-abc', 1.0);
console.log(`totalWin=${spin.totalWin} balance=${spin.balance}`);
```

## `IRBuilder` API

Fluent. Every method returns `this`. `.build()` validates that
`gameId`, `topology`, and `symbols` are present.

| Method | Shape |
|---|---|
| `.gameId(id)` | `string` |
| `.topology(t)` | `{ kind, reels, rows, ways?, lines? }` |
| `.symbolPool(pool)` | `{ HP: number, MP: number, ... }` |
| `.paytable(p)` | `PaytableEntry[]` |
| `.feature(name, cfg)` | `(string, FeatureConfig)` |
| `.rtpTarget(rtp)` | `number` in `[0.85, 0.99]` |
| `.jurisdictions(jur)` | `Jurisdiction[]` |
| `.metadata(m)` | `Record<string, unknown>` |
| `.build()` | returns `IRDocument`, throws on missing fields |

See **IR Schema** in the docs for the full field grammar.

## `SlotMathClient` methods

| Method | Returns | Notes |
|---|---|---|
| `health()` | `{ ok, name, version }` | Liveness probe. |
| `computeRTP(ir)` | `RTPResult` | Closed-form RTP estimate. |
| `renderIR(ir)` | `RenderConfig` | Runtime config a UI driver loads. |
| `spin(gameId, sessionId, betAmount)` | `SpinResult` | Server-authoritative spin. |
| `seamlessHandshake(operatorId)` | `SeamlessHandshake` | Operator integration handshake. |
| `listGames(jurisdiction?)` | `{ games, count }` | Lobby. |

## `SlotMathLiveClient` (WebSocket)

```typescript
import { SlotMathLiveClient } from '@slot-math-engine/sdk';

const live = new SlotMathLiveClient({
  apiUrl: 'http://localhost:4000', // http(s) coerced to ws(s)
  apiKey: 'YOUR_KEY',
});

live.on('session-start', (e) => console.log('session', e.sessionId));
live.on('spin',          (e) => console.log('win', e.win, 'balance', e.balance));
live.on('wallet-update', (e) => console.log('balance', e.balance));
live.on('error',         (e) => console.error('ws error', e.error));

await live.connect();          // resolves on `session-start`
live.subscribe(['sess-abc']);  // stream spins from this session

// later
live.unsubscribe();
live.close();
```

The client auto-replies to server `ping` frames and queues `send()` calls
issued before `connect()` resolves.

## Authoring a kernel

```typescript
import { defineKernel, validateParams } from '@slot-math-engine/sdk';

const cascadePyramid = defineKernel({
  name: 'cascade-multiplier-pyramid',
  version: '1.0.0',
  family: 'cascade',
  paramSpec: [
    { key: 'pTrigger', type: 'number', min: 0, max: 1 },
    { key: 'multiplier', type: 'integer', min: 1, max: 100 },
  ],
  closedForm: (ctx, params) => {
    validateParams(cascadePyramid.paramSpec, params as Record<string, unknown>);
    const p = params.pTrigger as number;
    const m = params.multiplier as number;
    return { rtp: p * m * 0.5, hitFrequency: p };
  },
});
```

`defineKernel` is intentionally minimal - it gives you a typed authoring
contract that you can register with the engine's kernel registry. The real
kernel implementations live in `src/kernels/` of this monorepo.

## Marketplace submission (W209)

Submit a finished kernel to the marketplace. The platform runs your kernel through a 6-gate test battery and auto-grants the **Verified** badge on all-pass.

```typescript
import { submitKernel, validateManifest } from '@slot-math-engine/sdk';
import type { KernelManifest } from '@slot-math-engine/sdk';

const manifest: KernelManifest = {
  name: 'cascade-pyramid',
  version: '1.0.0',
  author: 'bojan-studio',
  license: 'MIT',
  p_id_target: 'P-CASCADE-MULT-PYRAMID-001',
  category: 'cascade',
  description: 'Cascade multiplier pyramid with geometric falloff.',
  math_summary: 'RTP = p_trigger * sum(m_i * (1-p_break)^i)',
  certification_level: 'verified',
};
validateManifest(manifest);

const code = await fs.readFile('./my-kernel.ts', 'utf-8');
const r = await submitKernel(manifest, code, process.env.AUTHOR_TOKEN!, {
  apiUrl: 'https://marketplace.slot-math-engine.com',
});
console.log(r.submissionId, r.verdict?.all_pass, r.autoBadges);
```

Without `apiUrl` the SDK returns a synthetic mock verdict — useful for local prototyping.

Revenue split: **70/30** Tier 1, **75/25** Tier 2 (5+ certified kernels), **80/20** Tier 3 (partner). See `docs/MARKETPLACE_AUTHOR_GUIDE.md` for the full spec, payout schedule, and taxation basics.

## Error handling

REST errors throw `ApiError`:

```typescript
import type { ApiError } from '@slot-math-engine/sdk';

try {
  await client.spin('bad-game', 'sess-x', 1.0);
} catch (err) {
  const e = err as ApiError;
  console.error(e.statusCode, e.body);
}
```

WebSocket errors arrive as `{ type: 'error', error: '...' }` frames; register
a handler:

```typescript
live.on('error', (e) => console.error(e.error));
```

## TypeScript definitions

Every export is fully typed. No `.d.ts` shim needed. `npx tsc --noEmit`
against your code catches any contract drift with the SDK.

Public types (from `sdk/types.ts`):

- `Jurisdiction`, `Topology`, `TopologyConfig`, `SymbolPool`
- `PaytableEntry`, `FeatureConfig`, `IRDocument`
- `RTPResult`, `SpinResult`, `ClientOptions`, `ApiError`
- `RenderConfig`, `SeamlessHandshake`
- `KernelParamSpec`, `KernelContext`, `KernelResult`, `KernelDefinition`
- `LiveClientOptions`, `LiveEvent`, `LiveCommand`

## Public surface (cheat sheet)

| Symbol | Purpose |
|---|---|
| `SlotMathClient` | REST client wrapping the engine HTTP API |
| `SlotMathLiveClient` | WebSocket client for `/api/gaas/live` |
| `IRBuilder` | Fluent IR document builder |
| `defineKernel` | Author a new math kernel |
| `validateParams` | Runtime param-spec validation |
| `defaultMC` | Drop-in Monte-Carlo helper |
| `submitKernel` | Submit a kernel to the marketplace |
| `validateManifest` | Validate kernel manifest shape |
| `validateKernelCode` | Lightweight source-blob check |
| `manifestSkeleton` | Manifest starter for the wizard UI |
| `SDK_VERSION` | Pinned SDK semver string |

## License

MIT.

## Contributing

This SDK is published from the `slot-math-engine-template` monorepo. To
develop locally:

```bash
git clone https://github.com/slot-math-engine/template.git
cd slot-math-engine-template
npm install
cd sdk
npm run build
npm test
```

PR conventions:

- Every change needs a vitest spec
- `npm run sdk:typecheck` must pass on the SDK package
- `npm test` at the repo root must keep 6352+ specs PASS
- Don't break the published surface (`sdk/index.ts`) without a major bump
