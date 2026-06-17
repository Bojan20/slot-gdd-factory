/**
 * src/blocks/i18n.mjs
 *
 * Wave HX3 + HX4 — Internationalization + currency formatting.
 *
 * Industry pattern: a slot ships to ~10 markets per release. The HUD
 * labels ("Balance", "Bet", "Win", "Total Win", "Free Spins"), modal
 * copy, and currency formats must localise without dirty per-language
 * forks of the orchestrator. This block is:
 *
 *   • Language pack registry — 10 baseline language packs (en, sr, de,
 *     es, fr, it, pt-BR, tr, ru, zh-Hans).
 *   • Currency formatter — per-locale number + currency grouping
 *     (`$1,234.56` vs `1.234,56 €` vs `1 234,56 ₽`).
 *   • Runtime contract — `window.__SLOT_I18N__.t('balance.label')` and
 *     `window.__SLOT_I18N__.money(1234.56, 'EUR')` available globally.
 *   • Reactive — listens to onLocaleChanged (settingsPanel→rtlLayout
 *     chain); on change, mutates DOM `[data-i18n]` text + currency
 *     spans in place. No re-render.
 *
 * GDD config (consumed from `model.i18n`):
 *   {
 *     enabled:          boolean (default true)
 *     defaultLocale:    'en-US' (default)
 *     defaultCurrency:  'USD'   (default; ISO 4217 code)
 *     extraPacks:       { '<locale>': { '<key>': '<text>', ... } }
 *                       — operator can override / extend baseline packs
 *     fallbackChain:    ['en-US'] (default) — used when a key is
 *                       missing in the active pack
 *   }
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitI18nRuntime(cfg) → runtime JS string
 *   LANGUAGE_PACKS  → frozen baseline (for tests / docs / tooling)
 *   CURRENCY_FORMATS → frozen baseline
 *
 * Runtime contract:
 *   window.__SLOT_I18N__.t(key, fallback?)        → translated string
 *   window.__SLOT_I18N__.money(amount, ccy?)      → formatted money
 *   window.__SLOT_I18N__.locale                   → current locale
 *   window.__SLOT_I18N__.setLocale(locale)        → switch + re-paint
 *   window.HookBus emits 'onLanguagePackApplied' { locale, currency, count }
 */

/* ── Language packs (baseline keys) ────────────────────────────────
 * Keys are dot-namespaced. Add a new pack by either extending the
 * registry in this file (for ship-stable packs) or via model.i18n.extraPacks
 * (for per-game overrides). Pack values are HTML-safe strings (no markup). */
export const LANGUAGE_PACKS = Object.freeze({
  'en-US': Object.freeze({
    'balance.label':       'Balance',
    'bet.label':           'Bet',
    'win.label':           'Win',
    'totalWin.label':      'Total Win',
    'freeSpins.label':     'Free Spins',
    'freeSpins.remaining': 'Spins left',
    'spin.cta':            'Spin',
    'spin.skip':           'Skip',
    'autoplay.cta':        'Auto',
    'autoplay.stop':       'Stop',
    'turbo.label':         'Turbo',
    'settings.title':      'Settings',
    'paytable.title':      'Pays',
    'history.title':       'History',
    'bigWin.label':        'BIG WIN',
    'collect.cta':         'Collect',
    'close.cta':           'Close',
  }),
  'sr-Latn': Object.freeze({
    'balance.label':       'Kredit',
    'bet.label':           'Ulog',
    'win.label':           'Dobitak',
    'totalWin.label':      'Ukupno',
    'freeSpins.label':     'Besplatni Spinovi',
    'freeSpins.remaining': 'Preostalo',
    'spin.cta':            'Vrti',
    'spin.skip':           'Preskoči',
    'autoplay.cta':        'Auto',
    'autoplay.stop':       'Stani',
    'turbo.label':         'Turbo',
    'settings.title':      'Podešavanja',
    'paytable.title':      'Isplate',
    'history.title':       'Istorija',
    'bigWin.label':        'VELIKI DOBITAK',
    'collect.cta':         'Pokupi',
    'close.cta':           'Zatvori',
  }),
  'de-DE': Object.freeze({
    'balance.label':       'Guthaben',
    'bet.label':           'Einsatz',
    'win.label':           'Gewinn',
    'totalWin.label':      'Gesamtgewinn',
    'freeSpins.label':     'Freispiele',
    'freeSpins.remaining': 'Verbleibend',
    'spin.cta':            'Drehen',
    'spin.skip':           'Überspringen',
    'autoplay.cta':        'Auto',
    'autoplay.stop':       'Stop',
    'turbo.label':         'Turbo',
    'settings.title':      'Einstellungen',
    'paytable.title':      'Auszahlungen',
    'history.title':       'Verlauf',
    'bigWin.label':        'GROSSGEWINN',
    'collect.cta':         'Einsammeln',
    'close.cta':           'Schließen',
  }),
  'es-ES': Object.freeze({
    'balance.label':       'Saldo',
    'bet.label':           'Apuesta',
    'win.label':           'Ganancia',
    'totalWin.label':      'Total',
    'freeSpins.label':     'Giros Gratis',
    'freeSpins.remaining': 'Restantes',
    'spin.cta':            'Girar',
    'spin.skip':           'Omitir',
    'autoplay.cta':        'Auto',
    'autoplay.stop':       'Parar',
    'turbo.label':         'Turbo',
    'settings.title':      'Ajustes',
    'paytable.title':      'Premios',
    'history.title':       'Historial',
    'bigWin.label':        'GRAN PREMIO',
    'collect.cta':         'Cobrar',
    'close.cta':           'Cerrar',
  }),
  'fr-FR': Object.freeze({
    'balance.label':       'Solde',
    'bet.label':           'Mise',
    'win.label':           'Gain',
    'totalWin.label':      'Gain Total',
    'freeSpins.label':     'Tours Gratuits',
    'freeSpins.remaining': 'Restants',
    'spin.cta':            'Tourner',
    'spin.skip':           'Passer',
    'autoplay.cta':        'Auto',
    'autoplay.stop':       'Stop',
    'turbo.label':         'Turbo',
    'settings.title':      'Paramètres',
    'paytable.title':      'Gains',
    'history.title':       'Historique',
    'bigWin.label':        'GROS GAIN',
    'collect.cta':         'Encaisser',
    'close.cta':           'Fermer',
  }),
  'it-IT': Object.freeze({
    'balance.label':       'Saldo',
    'bet.label':           'Puntata',
    'win.label':           'Vincita',
    'totalWin.label':      'Totale',
    'freeSpins.label':     'Giri Gratis',
    'freeSpins.remaining': 'Rimasti',
    'spin.cta':            'Gira',
    'spin.skip':           'Salta',
    'autoplay.cta':        'Auto',
    'autoplay.stop':       'Stop',
    'turbo.label':         'Turbo',
    'settings.title':      'Impostazioni',
    'paytable.title':      'Tabella Pagamenti',
    'history.title':       'Cronologia',
    'bigWin.label':        'GRANDE VINCITA',
    'collect.cta':         'Incassa',
    'close.cta':           'Chiudi',
  }),
  'pt-BR': Object.freeze({
    'balance.label':       'Saldo',
    'bet.label':           'Aposta',
    'win.label':           'Ganho',
    'totalWin.label':      'Total',
    'freeSpins.label':     'Giros Grátis',
    'freeSpins.remaining': 'Restantes',
    'spin.cta':            'Girar',
    'spin.skip':           'Pular',
    'autoplay.cta':        'Auto',
    'autoplay.stop':       'Parar',
    'turbo.label':         'Turbo',
    'settings.title':      'Ajustes',
    'paytable.title':      'Tabela',
    'history.title':       'Histórico',
    'bigWin.label':        'GRANDE GANHO',
    'collect.cta':         'Coletar',
    'close.cta':           'Fechar',
  }),
  'tr-TR': Object.freeze({
    'balance.label':       'Bakiye',
    'bet.label':           'Bahis',
    'win.label':           'Kazanç',
    'totalWin.label':      'Toplam',
    'freeSpins.label':     'Bedava Çevirmeler',
    'freeSpins.remaining': 'Kalan',
    'spin.cta':            'Çevir',
    'spin.skip':           'Atla',
    'autoplay.cta':        'Oto',
    'autoplay.stop':       'Durdur',
    'turbo.label':         'Turbo',
    'settings.title':      'Ayarlar',
    'paytable.title':      'Ödeme Tablosu',
    'history.title':       'Geçmiş',
    'bigWin.label':        'BÜYÜK KAZANÇ',
    'collect.cta':         'Topla',
    'close.cta':           'Kapat',
  }),
  'ru-RU': Object.freeze({
    'balance.label':       'Баланс',
    'bet.label':           'Ставка',
    'win.label':           'Выигрыш',
    'totalWin.label':      'Всего',
    'freeSpins.label':     'Фриспины',
    'freeSpins.remaining': 'Осталось',
    'spin.cta':            'Крутить',
    'spin.skip':           'Пропустить',
    'autoplay.cta':        'Авто',
    'autoplay.stop':       'Стоп',
    'turbo.label':         'Турбо',
    'settings.title':      'Настройки',
    'paytable.title':      'Выплаты',
    'history.title':       'История',
    'bigWin.label':        'БОЛЬШОЙ ВЫИГРЫШ',
    'collect.cta':         'Забрать',
    'close.cta':           'Закрыть',
  }),
  'zh-Hans': Object.freeze({
    'balance.label':       '余额',
    'bet.label':           '投注',
    'win.label':           '赢取',
    'totalWin.label':      '合计',
    'freeSpins.label':     '免费旋转',
    'freeSpins.remaining': '剩余',
    'spin.cta':            '旋转',
    'spin.skip':           '跳过',
    'autoplay.cta':        '自动',
    'autoplay.stop':       '停止',
    'turbo.label':         '极速',
    'settings.title':      '设置',
    'paytable.title':      '赔付表',
    'history.title':       '历史',
    'bigWin.label':        '大奖',
    'collect.cta':         '领取',
    'close.cta':           '关闭',
  }),
});

/* ── Currency formats (per-locale grouping rules) ─────────────────
 * Each entry maps a locale → { symbol, position, decimal, thousand,
 * symbolFirst, spaceAfterSymbol }. Code falls back to ISO_4217 default
 * if currency-locale combo is unknown.
 *
 * Why not Intl.NumberFormat: deterministic across Node + browsers + JSDOM
 * was a wave-K7 requirement (settingsPanel notes). We replicate the
 * critical grouping rules in pure code. Operators preferring Intl can
 * opt in via model.i18n.useIntlNumberFormat = true. */
export const CURRENCY_FORMATS = Object.freeze({
  'en-US': Object.freeze({ thousand: ',', decimal: '.', symbolFirst: true,  spaceAfterSymbol: false }),
  'de-DE': Object.freeze({ thousand: '.', decimal: ',', symbolFirst: false, spaceAfterSymbol: true }),
  'es-ES': Object.freeze({ thousand: '.', decimal: ',', symbolFirst: false, spaceAfterSymbol: true }),
  'fr-FR': Object.freeze({ thousand: ' ', decimal: ',', symbolFirst: false, spaceAfterSymbol: true }),
  'it-IT': Object.freeze({ thousand: '.', decimal: ',', symbolFirst: false, spaceAfterSymbol: true }),
  'pt-BR': Object.freeze({ thousand: '.', decimal: ',', symbolFirst: true,  spaceAfterSymbol: false }),
  'tr-TR': Object.freeze({ thousand: '.', decimal: ',', symbolFirst: false, spaceAfterSymbol: true }),
  'ru-RU': Object.freeze({ thousand: ' ', decimal: ',', symbolFirst: false, spaceAfterSymbol: true }),
  'zh-Hans': Object.freeze({ thousand: ',', decimal: '.', symbolFirst: true, spaceAfterSymbol: false }),
  'sr-Latn': Object.freeze({ thousand: '.', decimal: ',', symbolFirst: false, spaceAfterSymbol: true }),
});

export const CURRENCY_SYMBOLS = Object.freeze({
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', RUB: '₽', TRY: '₺',
  BRL: 'R$', CHF: 'CHF', SEK: 'kr', DKK: 'kr', NOK: 'kr', PLN: 'zł',
  CZK: 'Kč', RON: 'lei', RSD: 'RSD',
});

export function defaultConfig() {
  return Object.freeze({
    enabled: true,
    defaultLocale: 'en-US',
    defaultCurrency: 'USD',
    extraPacks: {},
    fallbackChain: ['en-US'],
    useIntlNumberFormat: false,
  });
}

function _isValidLocale(s) {
  return typeof s === 'string' && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(s);
}

function _isValidCurrency(s) {
  return typeof s === 'string' && /^[A-Z]{3}$/.test(s);
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.i18n) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (_isValidLocale(m.defaultLocale))   cfg.defaultLocale   = m.defaultLocale;
  if (_isValidCurrency(m.defaultCurrency)) cfg.defaultCurrency = m.defaultCurrency;
  if (typeof m.useIntlNumberFormat === 'boolean') cfg.useIntlNumberFormat = m.useIntlNumberFormat;

  if (m.extraPacks && typeof m.extraPacks === 'object') {
    const safe = {};
    for (const loc of Object.keys(m.extraPacks)) {
      if (!_isValidLocale(loc)) continue;
      const pack = m.extraPacks[loc];
      if (!pack || typeof pack !== 'object') continue;
      const cleanPack = {};
      for (const k of Object.keys(pack)) {
        if (typeof k !== 'string' || k.length > 100) continue;
        const v = pack[k];
        if (typeof v !== 'string' || v.length > 500) continue;
        cleanPack[k] = v;
      }
      if (Object.keys(cleanPack).length > 0) safe[loc] = cleanPack;
    }
    cfg.extraPacks = safe;
  }

  if (Array.isArray(m.fallbackChain)) {
    const chain = m.fallbackChain.filter(_isValidLocale).slice(0, 5);
    if (chain.length > 0) cfg.fallbackChain = chain;
  }

  return cfg;
}

export function emitI18nRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ i18n: cfg });
  if (!c.enabled) {
    return `
  /* ── i18n BLOCK (disabled) — minimal stub so probes don't crash ──── */
  window.__SLOT_I18N__ = {
    locale: ${JSON.stringify(c.defaultLocale)},
    currency: ${JSON.stringify(c.defaultCurrency)},
    t: function (key, fb) { return fb != null ? fb : (key || ''); },
    money: function (n) { return String(n); },
    setLocale: function () {},
  };
`;
  }

  /* Merge baseline + extraPacks at emit time so runtime stays small. */
  const mergedPacks = {};
  for (const loc of Object.keys(LANGUAGE_PACKS)) {
    mergedPacks[loc] = { ...LANGUAGE_PACKS[loc] };
  }
  for (const loc of Object.keys(c.extraPacks)) {
    mergedPacks[loc] = { ...(mergedPacks[loc] || {}), ...c.extraPacks[loc] };
  }

  return `
  /* ── i18n BLOCK — emitted by src/blocks/i18n.mjs
     Language packs + currency formatting + reactive locale change. */
  (function () {
    var PACKS = ${JSON.stringify(mergedPacks)};
    var CURRENCY = ${JSON.stringify(CURRENCY_FORMATS)};
    var SYMBOLS  = ${JSON.stringify(CURRENCY_SYMBOLS)};
    var FALLBACK_CHAIN = ${JSON.stringify(c.fallbackChain)};
    var DEFAULT_LOCALE   = ${JSON.stringify(c.defaultLocale)};
    var DEFAULT_CURRENCY = ${JSON.stringify(c.defaultCurrency)};
    var USE_INTL = ${c.useIntlNumberFormat};

    function _bestPack(loc) {
      if (PACKS[loc]) return loc;
      /* Strip region: 'pt-BR' → 'pt' won't match but we try the bare
       * language as a last resort (e.g. 'en-GB' → 'en-US'). */
      var base = String(loc).split('-')[0];
      for (var k in PACKS) { if (k.split('-')[0] === base) return k; }
      return FALLBACK_CHAIN[0] || 'en-US';
    }

    function _t(key, fb) {
      var loc = state.locale;
      var pack = PACKS[_bestPack(loc)];
      if (pack && key in pack) return pack[key];
      for (var i = 0; i < FALLBACK_CHAIN.length; i++) {
        var fp = PACKS[FALLBACK_CHAIN[i]];
        if (fp && key in fp) return fp[key];
      }
      return fb != null ? fb : key;
    }

    function _formatMoneyManual(n, ccy) {
      var fmt = CURRENCY[_bestPack(state.locale)] || CURRENCY['en-US'];
      var symbol = SYMBOLS[ccy] || ccy;
      var sign = n < 0 ? '-' : '';
      var abs = Math.abs(Number(n) || 0);
      var fixed = abs.toFixed(2);
      var parts = fixed.split('.');
      var int = parts[0];
      var dec = parts[1];
      /* Group thousands. */
      var grouped = '';
      var rest = int;
      while (rest.length > 3) {
        grouped = fmt.thousand + rest.slice(-3) + grouped;
        rest = rest.slice(0, -3);
      }
      grouped = rest + grouped;
      var numStr = grouped + fmt.decimal + dec;
      var space = fmt.spaceAfterSymbol ? '\\u00a0' : '';
      return fmt.symbolFirst
        ? sign + symbol + space + numStr
        : sign + numStr + space + symbol;
    }

    function _formatMoneyIntl(n, ccy) {
      try {
        return new Intl.NumberFormat(state.locale, {
          style: 'currency', currency: ccy,
        }).format(n);
      } catch (_) {
        return _formatMoneyManual(n, ccy);
      }
    }

    function _money(n, ccy) {
      var c = ccy || state.currency || DEFAULT_CURRENCY;
      return USE_INTL ? _formatMoneyIntl(n, c) : _formatMoneyManual(n, c);
    }

    var state = {
      locale: (typeof window !== 'undefined' && window.__SLOT_LOCALE__) || DEFAULT_LOCALE,
      currency: DEFAULT_CURRENCY,
    };

    function _paintNodes() {
      if (typeof document === 'undefined') return 0;
      var nodes = document.querySelectorAll('[data-i18n]');
      var n = 0;
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var key = el.getAttribute('data-i18n');
        if (!key) continue;
        var fb = el.getAttribute('data-i18n-fallback');
        el.textContent = _t(key, fb);
        n++;
      }
      /* Money spans — opt-in via data-money attribute. */
      var moneyNodes = document.querySelectorAll('[data-money]');
      for (var j = 0; j < moneyNodes.length; j++) {
        var mn = moneyNodes[j];
        var amount = Number(mn.getAttribute('data-money'));
        if (!Number.isFinite(amount)) continue;
        var ccy = mn.getAttribute('data-money-ccy') || state.currency;
        mn.textContent = _money(amount, ccy);
      }
      return n;
    }

    function setLocale(loc) {
      if (!_isValidStr(loc)) return false;
      state.locale = loc;
      var painted = _paintNodes();
      try {
        if (window.HookBus && typeof window.HookBus.emit === 'function') {
          window.HookBus.emit('onLanguagePackApplied', {
            locale: state.locale, currency: state.currency, count: painted,
          });
        }
      } catch (_) {}
      return true;
    }

    function _isValidStr(s) {
      return typeof s === 'string' && s.length > 0 && s.length <= 20;
    }

    window.__SLOT_I18N__ = {
      get locale() { return state.locale; },
      get currency() { return state.currency; },
      t: _t,
      money: _money,
      setLocale: setLocale,
    };

    /* Initial paint at boot + on locale change. */
    if (typeof document !== 'undefined' && document.readyState !== 'loading') {
      _paintNodes();
    } else if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('DOMContentLoaded', _paintNodes);
    }

    if (window.HookBus && typeof window.HookBus.on === 'function') {
      window.HookBus.on('onLocaleChanged', function (p) {
        var v = p && p.value ? String(p.value) : DEFAULT_LOCALE;
        setLocale(v);
      });
    }
  })();
`;
}
