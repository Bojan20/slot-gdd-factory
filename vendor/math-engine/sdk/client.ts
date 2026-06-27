/**
 * @slot-math-engine/sdk — REST client.
 *
 * Wraps the Studio/Server APIs so a third-party developer can write
 * code like:
 *
 *   const client = new SlotMathClient({ apiUrl: 'http://localhost:4000' });
 *   const result = await client.computeRTP(ir);
 */

import type {
  ClientOptions,
  IRDocument,
  RTPResult,
  SpinResult,
  RenderConfig,
  SeamlessHandshake,
  ApiError,
} from './types.js';

export class SlotMathClient {
  private readonly apiUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ClientOptions) {
    if (!opts.apiUrl) throw new Error('SlotMathClient: apiUrl is required');
    this.apiUrl = opts.apiUrl.replace(/\/$/, '');
    if (opts.apiKey !== undefined) this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new Error('SlotMathClient: no fetch implementation (Node <18? pass opts.fetch)');
    }
  }

  /** Health check. */
  async health(): Promise<{ ok: boolean; name: string; version: string }> {
    return this.request<{ ok: boolean; name: string; version: string }>('GET', '/api/health');
  }

  /** Compute RTP for an IR document. */
  async computeRTP(ir: IRDocument): Promise<RTPResult> {
    return this.request<RTPResult>('POST', '/api/gaas/compute-rtp', ir);
  }

  /** Render a runtime config for an IR. */
  async renderIR(ir: IRDocument): Promise<RenderConfig> {
    return this.request<RenderConfig>('POST', '/api/gaas/render-ir', ir);
  }

  /** Server-authoritative spin. */
  async spin(gameId: string, sessionId: string, betAmount: number): Promise<SpinResult> {
    return this.request<SpinResult>('POST', '/api/gaas/spin', {
      gameId,
      sessionId,
      betAmount,
    });
  }

  /** Operator handshake. */
  async seamlessHandshake(operatorId: string): Promise<SeamlessHandshake> {
    return this.request<SeamlessHandshake>(
      'GET',
      `/api/gaas/seamless?operatorId=${encodeURIComponent(operatorId)}`
    );
  }

  /** Lobby — list registered games. */
  async listGames(jurisdiction?: string): Promise<{ games: Array<{ id: string; title: string; rtp: number }>; count: number }> {
    const q = jurisdiction ? `?jurisdiction=${encodeURIComponent(jurisdiction)}` : '';
    return this.request('GET', `/api/lobby/games${q}`);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (this.apiKey) headers['x-api-key'] = this.apiKey;
      const res = await this.fetchImpl(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed: unknown = null;
      if (text) {
        try { parsed = JSON.parse(text); } catch { parsed = text; }
      }
      if (!res.ok) {
        const err = new Error(`SlotMathClient: ${method} ${path} → ${res.status}`) as ApiError;
        err.statusCode = res.status;
        err.body = parsed;
        throw err;
      }
      return parsed as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Fluent builder for IR documents.
 *
 *  Example:
 *    const ir = new IRBuilder()
 *      .gameId('my-game')
 *      .topology({ kind: 'rectangular', reels: 5, rows: 3 })
 *      .symbolPool({ HP: 3, MP: 3, LP: 3 })
 *      .feature('free_spins', { trigger: 3, count: 10 })
 *      .build();
 */
export class IRBuilder {
  private doc: Partial<IRDocument> = {
    schemaVersion: '2.0',
    symbols: {},
    features: {},
    jurisdictions: ['GENERIC'],
  };

  gameId(id: string): this { this.doc.gameId = id; return this; }
  topology(t: IRDocument['topology']): this { this.doc.topology = t; return this; }
  symbolPool(pool: IRDocument['symbols']): this { this.doc.symbols = { ...pool }; return this; }
  paytable(p: IRDocument['paytable']): this { this.doc.paytable = p; return this; }

  feature(name: string, cfg: NonNullable<IRDocument['features']>[string]): this {
    if (!this.doc.features) this.doc.features = {};
    this.doc.features[name] = cfg;
    return this;
  }

  rtpTarget(rtp: number): this { this.doc.rtpTarget = rtp; return this; }
  jurisdictions(jur: IRDocument['jurisdictions']): this { this.doc.jurisdictions = jur; return this; }
  metadata(m: IRDocument['metadata']): this { this.doc.metadata = m; return this; }

  build(): IRDocument {
    if (!this.doc.gameId) throw new Error('IRBuilder: gameId is required');
    if (!this.doc.topology) throw new Error('IRBuilder: topology is required');
    if (!this.doc.symbols || Object.keys(this.doc.symbols).length === 0) {
      throw new Error('IRBuilder: symbolPool is required');
    }
    return this.doc as IRDocument;
  }
}

// ───────────────────────────────────────────────────────────────────────
// SlotMathLiveClient — real WebSocket client for /api/gaas/live
// ───────────────────────────────────────────────────────────────────────

export interface LiveClientOptions {
  /** Base URL (http(s) or ws(s)). The path /api/gaas/live is appended. */
  apiUrl: string;
  apiKey?: string;
  /**
   * WebSocket constructor to use. Browsers have it globally; Node 22+
   * also exposes `WebSocket` globally. If undefined the global is used.
   */
  webSocketImpl?: typeof WebSocket;
}

export type LiveEvent =
  | { type: 'session-start'; sessionId: string; timestamp: string }
  | { type: 'spin'; spinId: string; gameId: string; sessionId: string; result: unknown; balance: number; win: number; merkleCommit: string; timestamp: string }
  | { type: 'wallet-update'; playerId: string; balance: number; transactionId: string; timestamp: string }
  | { type: 'session-end'; sessionId: string; summary: unknown; timestamp: string }
  | { type: 'ping'; ts: number }
  | { type: 'pong'; ts: number }
  | { type: 'subscribed'; sessionIds: string[]; timestamp: string }
  | { type: 'unsubscribed'; timestamp: string }
  | { type: 'spin-ack'; data: unknown; timestamp: string }
  | { type: 'error'; error: string; code?: number };

export type LiveCommand =
  | { type: 'subscribe'; sessionIds: string[] }
  | { type: 'unsubscribe' }
  | { type: 'spin'; bet: number; gameId: string; sessionId: string }
  | { type: 'ping'; ts?: number };

type Handler = (e: LiveEvent) => void;

export class SlotMathLiveClient {
  private readonly url: string;
  private readonly WebSocketImpl: typeof WebSocket;
  private ws: WebSocket | null = null;
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly anyHandlers = new Set<Handler>();
  private readonly pending: string[] = [];
  private opened = false;
  private closing = false;

  constructor(opts: LiveClientOptions) {
    if (!opts.apiUrl) throw new Error('SlotMathLiveClient: apiUrl is required');
    const base = opts.apiUrl.replace(/\/$/, '');
    // Coerce http(s) → ws(s).
    const wsBase = base
      .replace(/^http:\/\//, 'ws://')
      .replace(/^https:\/\//, 'wss://');
    const q = opts.apiKey ? `?apiKey=${encodeURIComponent(opts.apiKey)}` : '';
    this.url = `${wsBase}/api/gaas/live${q}`;
    const wsImpl = opts.webSocketImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!wsImpl) {
      throw new Error(
        'SlotMathLiveClient: no WebSocket implementation. Pass opts.webSocketImpl or run on Node 22+ / browsers.'
      );
    }
    this.WebSocketImpl = wsImpl;
  }

  /** Open the WebSocket and resolve once the session-start frame arrives. */
  connect(): Promise<void> {
    if (this.ws) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const ws = new this.WebSocketImpl(this.url);
      this.ws = ws;
      ws.onopen = () => {
        this.opened = true;
        for (const msg of this.pending) ws.send(msg);
        this.pending.length = 0;
      };
      ws.onmessage = (ev: MessageEvent) => {
        let parsed: LiveEvent;
        try { parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()) as LiveEvent; }
        catch { return; }
        // Auto-respond to keepalive pings.
        if (parsed.type === 'ping') {
          this.send({ type: 'ping', ts: parsed.ts });
        }
        if (parsed.type === 'session-start') resolve();
        this.dispatch(parsed);
      };
      ws.onerror = (ev) => {
        if (!this.opened) reject(new Error(`SlotMathLiveClient: websocket error before open: ${String(ev)}`));
        this.dispatch({ type: 'error', error: 'transport_error' });
      };
      ws.onclose = () => {
        this.opened = false;
        this.ws = null;
        if (!this.closing) this.dispatch({ type: 'error', error: 'closed' });
      };
    });
  }

  /** Register a handler for a specific event type. */
  on<T extends LiveEvent['type']>(type: T, h: (e: Extract<LiveEvent, { type: T }>) => void): this {
    let set = this.handlers.get(type);
    if (!set) { set = new Set(); this.handlers.set(type, set); }
    set.add(h as Handler);
    return this;
  }

  /** Register a handler for every event. */
  onAny(h: Handler): this { this.anyHandlers.add(h); return this; }

  /** Subscribe to one or more sessionIds for streaming. */
  subscribe(sessionIds: string[]): void {
    this.send({ type: 'subscribe', sessionIds });
  }

  /** Unsubscribe from all session streams. */
  unsubscribe(): void {
    this.send({ type: 'unsubscribe' });
  }

  /** Send an arbitrary command frame. */
  send(cmd: LiveCommand): void {
    const json = JSON.stringify(cmd);
    if (this.ws && this.opened) this.ws.send(json);
    else this.pending.push(json);
  }

  /** Close the underlying socket. */
  close(): void {
    this.closing = true;
    if (this.ws) try { this.ws.close(); } catch { /* ignore */ }
    this.ws = null;
    this.opened = false;
  }

  private dispatch(e: LiveEvent): void {
    for (const h of this.anyHandlers) try { h(e); } catch { /* ignore */ }
    const set = this.handlers.get(e.type);
    if (set) for (const h of set) try { h(e); } catch { /* ignore */ }
  }
}
