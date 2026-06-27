/**
 * W152 P2-11 — RGS pluggable surface, barrel export.
 *
 * Per KIMI 13 the engine targets the LCD across CasinoWebScripts,
 * Hub88, Stake Engine, BetConstruct, Pragmatic Enhance, Yggdrasil
 * BOOST, OneTouch, Hacksaw RGS. The four pillars exported here:
 *
 *   * `WalletBackend` — debit / credit / rollback / balance.
 *   * `AuthSigner` — HMAC / JWT / RSA primitives.
 *   * `RgsProtocol` — orchestrates wallet + auth + round events +
 *     promo tokens behind a single API.
 *   * Shared types: `BetRequest`, `WinRequest`, `RoundEvent`, …
 */

export type {
  BalanceResponse,
  BetRequest,
  RoundEvent,
  WalletError,
  WalletResult,
  WinRequest,
} from './types.js';

export type { WalletBackend } from './wallet.js';
export { InMemoryMockWallet } from './wallet.js';

export type { AuthSigner } from './auth/index.js';
export {
  HmacSha256Signer,
  JwtHs256Signer,
  RsaSha256Signer,
  canonicalJson,
} from './auth/index.js';

export {
  RgsProtocol,
  type PromoValidator,
  type RgsProtocolConfig,
  type RoundEventSink,
} from './protocol.js';
