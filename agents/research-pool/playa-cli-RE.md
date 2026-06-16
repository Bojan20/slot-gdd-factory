# playa-cli — Deep Reverse-Engineering Report

> Source: `~/IGT/playa-cli` @ `version 1.8.21-PLAYAUF-6314` (package.json:3).
> Repo size: 29 MB. Tech: Node 14+, Express 4, JSDOM 22, body-parser, express-session, cors, yargs, open.
> Purpose: Local dev server that boots a compiled HTML5 slot game, proxies (or replaces) the live Remote Game Server (RGS), records/replays game log records (GLR), and configures the in-page kernel that talks to the RGS.
> Generated 2026-06-16.

This document does **not** trust the `README.md`. Every claim is anchored to source `file:line` references. Vendor/operator names appear only in §1-§6 (raw RE). §7 and §8 (synthesis for slot-gdd-factory) use vendor-neutral language per the in-repo authoring rule.

---

## Table of contents

| # | Section | Span |
|:-:|:--|:--|
| §1 | Repo skeleton + entry points | line ~50 |
| §2 | Dev server architecture | line ~190 |
| §3 | RGS proxy | line ~350 |
| §4 | GLR — Game Log Record | line ~480 |
| §5 | JSDOM hosting | line ~600 |
| §6 | CLI surface | line ~660 |
| §7 | RE insights for slot-gdd-factory | line ~720 |
| §8 | Pitfalls + non-obvious mechanics | line ~830 |
| §9 | Appendix — endpoint cheat sheet | line ~920 |

---

## §1. Repo skeleton + entry points

### §1.1 Top-level directory tree

```
playa-cli/
├── .eslintrc.js
├── .gitignore
├── .npmrc
├── .prettierrc.js
├── Jenkinsfile               (CI: groovy, ~250 lines, nexus deploy + git-versioning)
├── README.md
├── app/                      Node-side dev-server runtime (13 .js files, ~50 KB)
│   ├── main.js                            (138 lines, Express bootstrap)
│   ├── clientConfig.js                    (458 lines, JSDOM proxy + clientConfig fabricator)
│   ├── launch.js                          (60 lines, "/" route, template inlining)
│   ├── launchRemote.js                    (33 lines, opens remote playadev.com tunnel)
│   ├── mergeParams.js                     (25 lines, CLI ▸ session ▸ query merge middleware)
│   ├── glrPlayer.js                       (37 lines, replays a GLR dir)
│   ├── glrRecorder.js                     (50 lines, buffers RGS responses to disk)
│   ├── replayBuffer.js                    (76 lines, ring-buffered replay, readline prompt)
│   ├── reverseProxy.js                    (66 lines, HTTPS pipe to lab.wagerworks.com)
│   ├── rgsRouter.js                       (18 lines, /rgs/* routing)
│   ├── skinsRouter.js                     (35 lines, /skins/* + gaffTool injection)
│   └── utils.js                           (21 lines, async wrap + LAN IP)
├── bin/                      yargs CLI shell
│   ├── cli.js                             (26 lines, `playa launch ...`)
│   └── args.js                            (173 lines, every flag + default + choices)
├── config/                   regex constants for JSP-template scrubbing
│   ├── removals.js                        (8 lines)
│   └── replacements.js                    (11 lines, INJECT* token map)
├── console/                  In-iframe console UI (skin / overlay shell)
│   ├── version.txt                        (build.version=1.4.15, build.number=181)
│   ├── checksum.txt                       (large per-file SHA list)
│   ├── IXF/1.4/                           (igtBridge, gcm* bridges, postal.js, espana,
│   │                                       cashier, messages, topup, integration, lib/...)
│   └── skins/                             18 skin subfolders:
│       ├── default/ defaultNew/ defaultHidden/ defaultPoland/
│       ├── defaultSpain/ defaultUKRC/
│       ├── demo/ examples/ testing/
│       ├── gcm/ LNB/ WQP2/
│       ├── nowidgets/ textwidget/ static/
│       └── replay/  ◄── special: pause/play/fast/share replay UI
├── keys/
│   ├── localhost.crt                      (self-signed dev cert for HTTPS)
│   └── localhost.key
├── launch.json               VS Code launch profile, hard-codes rgs-gsdev02
├── package.json              v1.8.21-PLAYAUF-6314, bin=playa→bin/cli.js
├── platform/                 In-iframe HTML/JS runtime that the game loads
│   ├── index.tpl                          (33 lines, the served HTML shell)
│   ├── index.html                         (37 lines, iOS standalone variant)
│   ├── thin-index.tpl                     (33 lines, kernel-lite variant)
│   ├── launcher-evr.tpl                   (62 lines, Everi wrapper)
│   ├── launcher-isb.tpl                   (56 lines, ISB postMessage wrapper)
│   ├── loader.gif
│   ├── config.json.template
│   ├── games.json.template                (softwareid → dist path map)
│   ├── asset/                             6 PNGs (header dialogs)
│   ├── css/                               style.{int,mob,tab}.css + ttf fonts + igt-verlag.css
│   ├── js/                                kernel(.js, -lite.js), clientservice(.js, -lite.js),
│   │                                       gameservice.js, consoleservice.js + 6 sourcemaps
│   ├── js/adapters/                       evr.js, isb.js  (Everi + ISB platform adapters)
│   └── support/en/                        (i18n strings dir, empty in this build)
├── pom.xml                   maven artifact descriptor (CI publishes to Nexus)
├── redirect/index.html       1-line redirector to https://<org>.playadev.com/gateway
└── yarn.lock                 82 KB, frozen lockfile
```

### §1.2 `package.json` — bin + scripts

```json
{
  "name": "playa-cli",
  "version": "1.8.21-PLAYAUF-6314",       // package.json:3
  "main": "app/main.js",                  // package.json:7
  "bin": { "playa": "bin/cli.js" },       // package.json:8-10
  "dependencies": {
    "body-parser": "^1.18.3",
    "boxen": "^4.0.0",
    "cors": "^2.8.5",
    "express": "^4.16.4",
    "express-session": "^1.16.1",
    "jsdom": "^22",                       // package.json:17 — JSDOM is mandatory
    "open": "8.0.2",
    "yargs": "^13.2.2"
  }
}
```

No `scripts:` section. The CLI is exposed via `bin`, so `yarn global add playa-cli` makes `playa` resolve to `bin/cli.js`. Locally, `npx playa launch ...` is the documented invocation (README.md:17).

### §1.3 `playa launch <game>` — boot sequence

The flow from terminal keystroke to a running browser game is:

| Step | File:line | What happens |
|:-:|:--|:--|
| 1 | `bin/cli.js:1` | Shebang `#!/usr/bin/env node`. yargs parses ARGV. |
| 2 | `bin/cli.js:9-25` | Registers one yargs command — `launch` — using `bin/args.js` for option specs. Validates that **one of** `--server` or `--glr` is present (`bin/cli.js:12-17`). |
| 3 | `bin/cli.js:19` | Multi-value `--server` collapses to last (`checkArrayReturnLastParam`). |
| 4 | `bin/cli.js:20-21` | Destructures 25 named args and forwards them to `app/main.js` default export. |
| 5 | `app/main.js:22` | Creates `express()` app. |
| 6 | `app/main.js:24` | Builds `merge` middleware via `mergeParams.js` — closure over CLI defaults. |
| 7 | `app/main.js:26-27` | Reads `keys/localhost.{crt,key}` from disk synchronously (HTTPS path). |
| 8 | `app/main.js:29-38` | Defines express-session config (`secret:"okltlklybxg"`, 7-day cookie). |
| 9 | `app/main.js:40-57` | Mounts session + JSON + URL-encoded body parsers + permissive CORS (`origin:'*'`, OPTIONS preflight whitelists `playadev.com`). |
| 10 | `app/main.js:60` | Static mount: `/game` → `path.resolve(target)` (the user's `./dist`). |
| 11 | `app/main.js:63` | Static mount: `/custom-designs` → `./custom-designs` for skin overrides. |
| 12 | `app/main.js:69-71` | Static mounts: `/platform`, `/console`, `/IXF`. |
| 13 | `app/main.js:74` | Sub-router: `/skins` → `skinsRouter({ server })`. |
| 14 | `app/main.js:77` | Static mount: `/redirect` (for HTTPS cert trust dance). |
| 15 | `app/main.js:80-84` | **Branching**: if `--glr` → `app.use("/rgs", glrPlayer({glr}))`. Else if `--server` → `app.use("/rgs", rgsRouter({server, record, maxReplays}))`. Either path resolves the in-page kernel's `clientConfig.serverConfig.server === "/rgs"`. |
| 16 | `app/main.js:87` | Root route `"/"` → renders `platform/index.tpl` with `clientConfig` injected as `<meta name="com.igt.skateboard.CLIENTCONFIG" content="…">` (`platform/index.tpl:14`). |
| 17 | `app/main.js:89-93` | If `--promofs` provided, opens a `https://<pfs>.playadev.com/proxy/pfs/create?...` URL to inject promotional free spins. |
| 18 | `app/main.js:97-112` | If `--organization=undefined` (default): plain HTTP listen on `--port` (default 8080), prints boxed banner with local + LAN URL. |
| 19 | `app/main.js:114-136` | If `--organization` set: HTTPS server using `keys/localhost.{crt,key}`, then calls `launchRemote(...)` (`app/launchRemote.js:5`) which constructs a `RGSTUNNEL` URL and `open()`s the user's default browser. |

Net result: a default `playa launch --server rgs-gsdev02 --softwareId 200-1173-001` cmd will:

1. Boot an Express server on `http://127.0.0.1:8080`.
2. Serve `platform/index.tpl` at `GET /` with an inlined `clientConfig` JSON (manufactured by `app/clientConfig.js`).
3. The browser executes `platform/js/kernel.js`, which reads `<meta name="com.igt.skateboard.CLIENTCONFIG">` (`platform/index.tpl:14`), then bootstraps `clientservice` → `gameservice` → loads the game from `${INJECTGAMEFOLDER}/launcher.html` (which becomes `/game/launcher.html` post-templating).
4. Every RGS call the game makes (`/rgs/authenticate`, `/rgs/play`, …) is either proxied to `https://rgs-gsdev02.lab.wagerworks.com/skb/...` (live) or answered from a local GLR directory (replay).

### §1.4 `redirect/index.html` — HTTPS-org tunnel hop

When `--organization=<name>` is set, the boot finishes in `app/launchRemote.js:31` by calling `open("https://localhost:8080/redirect?<params>")`. That file (`redirect/index.html`) is a 12-line bootstrap whose body is:

```html
<script>
  const urlParams = new URLSearchParams(window.location.search);
  window.location.href = "https://" + urlParams.get('organization') + ".playadev.com/gateway" + window.location.search;
</script>
```

This is how IGT routes locally-launched games through the dev cloud SSO portal — the redirect carries the full param map straight from `launchRemote.js:7-24`.

---

## §2. Dev server architecture

### §2.1 Express route map (every mount + handler reference)

| Method | Path | Handler reference | Purpose |
|:--|:--|:--|:--|
| MIDDLEWARE | `*` | `express-session` ; `bodyParser.json` ; `bodyParser.urlencoded` ; `cors({origin:'*'})` | `app/main.js:40-51` |
| OPTIONS | `*` | `cors({origin:'playadev.com'})` | `app/main.js:53-57` |
| GET (static) | `/game/*` | `express.static(path.resolve(target))` | `app/main.js:60` |
| GET (static) | `/custom-designs/*` | `express.static(path.resolve(customDesigns))` | `app/main.js:63` |
| GET (static) | `/platform/*` | `express.static("../platform")` | `app/main.js:69` |
| GET (static) | `/console/*` | `express.static("../console")` | `app/main.js:70` |
| GET (static) | `/IXF/*` | `express.static("../console/IXF")` | `app/main.js:71` |
| (mounted router) | `/skins/*` | `merge` ▸ `skinsRouter({server})` | `app/main.js:74`, handler at `app/skinsRouter.js:8-34` |
| GET (static) | `/redirect/*` | `express.static("../redirect")` | `app/main.js:77` |
| (mounted router) | `/rgs/*` | `glrPlayer({glr})` OR `rgsRouter({server,record,maxReplays})` | `app/main.js:80-84` |
| GET (template) | `/` (and any other unmatched route at `"/"` boundary) | `merge` ▸ `asyncMiddleware(launch({port, server}))` | `app/main.js:87`, handler at `app/launch.js:8-60` |

#### `/skins/*` (`app/skinsRouter.js`)

| Route | Handler |
|:--|:--|
| `ALL /skins/gaffTool/gaffTool.html` | `app/skinsRouter.js:12-28` — reads `console/skins/gaffTool/gaffTool.html`, regex-replaces `/*INJECTEDPARAMS*/` with `{PRESENT_TYPE, CHANNEL, SOFTWARE_ID, SERVER, SKIN_CODE}`. Lets the **gaff tool** (the dev "force outcome" panel) know the live session params. Note: the source `console/skins/gaffTool/` is **NOT** in the shipped tree (only referenced) — the gaff tool is a dev artifact that lives in a private support repo. |
| `GET /skins/forceData/*` | `app/skinsRouter.js:30` — reverse-proxies into `https://<server>.lab.wagerworks.com/skins/forceData/*`. This is the live "force outcome" stream consumed by the gaff tool. |
| `GET /skins/*` (anything else) | `app/skinsRouter.js:32` — `express.static("../console/skins")`. |

#### `/rgs/*` (`app/rgsRouter.js`)

Built only when `--server` set:

| Route | Handler |
|:--|:--|
| `ALL /rgs/tc/*` | `app/rgsRouter.js:14` — proxies as-is (`req.url` unchanged) to `https://<server>.lab.wagerworks.com<req.url>`. Reserved for tournament-channel calls. |
| `ALL /rgs/*` (everything else) | `app/rgsRouter.js:15` — proxies to `https://<server>.lab.wagerworks.com/skb<req.url>`. Triggers recording via `glrRecorder` (3rd arg `record`). |

Replaced by `app/glrPlayer.js` when `--glr` set.

#### Root route (`app/launch.js`)

The crown jewel — every fresh page reload, this is what wires up the in-iframe runtime:

| Step | File:line | What happens |
|:-:|:--|:--|
| 1 | `app/launch.js:13-16` | Reads `../platform/index.tpl` (the JSP-derived HTML shell). |
| 2 | `app/launch.js:18-22` | Reads `../platform/css/style.<channel>.css` (INT/TAB/MOB). |
| 3 | `app/launch.js:24` | Sets `replacements.INJECTCHANNEL = channel.toLowerCase()`. |
| 4 | `app/launch.js:26-37` | If `--customDesigns` dir contains a `config.json`, prefixes every `entry.path` with `/custom-designs/...`. |
| 5 | `app/launch.js:39-44` | Calls `clientConfigGen(...)` → an async function that returns the full `clientConfig` object (see §2.3). |
| 6 | `app/launch.js:46-47` | Inlines CSS + escapes `clientConfig` as `&#034;`-encoded JSON. |
| 7 | `app/launch.js:50` | Strips JSP fossils via the regex list in `config/removals.js:1-9`. |
| 8 | `app/launch.js:53-57` | Performs `${KEY}` → value substitution using `config/replacements.js:1-11`. |
| 9 | `app/launch.js:59` | `res.send(replaced)`. |

So the only template engine in use is a hand-rolled `string.replace(new RegExp("\\$\\{KEY\\}","g"), value)` (`app/launch.js:53-57`). No EJS, no Handlebars.

### §2.2 Static asset strategy

Static files are served straight from disk through `express.static`. No bundler, no fingerprinting, no gzip. Cache-busting is done via URL query strings the kernel injects at runtime: `?v=1.4.15.1` (`platform/index.tpl:18,19,29`) plus `Date.now()` for the `revisionTag` (`app/clientConfig.js:306,318`).

Custom design overrides come from `--customDesigns` (default `./custom-designs`, `bin/args.js:125-131`) which the launch handler reads at request time (`app/launch.js:26-37`) and the kernel resolves through the injected `clientConfig.gameConfig.customDesigns` (`app/clientConfig.js:208`).

### §2.3 Game bundle resolution

The game artifact path comes from `--target` (`bin/args.js:4-9`, default `./dist`). Two layers:

1. **Static**: `app/main.js:60` mounts `/game` → `path.resolve(target)`. So all CSS/JS/PNG/sprite assets live under `<target>/...`.
2. **Bootstrap entry point**: `clientConfig.serverConfig.gameUrl = ${host}/game/launcher.html` (`app/clientConfig.js:305`) — the kernel reads this from the injected meta tag and loads `<target>/launcher.html` into an iframe.

There is **no game registry** during local dev. `platform/games.json.template:2` shows the production format:

```json
{ "200-1173-001": "games/CleopatraSKB/" }
```

…but it is a *template*, not loaded by the running CLI. The CLI assumes one game per `--target`.

### §2.4 Hot reload

**There is none.** No `chokidar`, no `nodemon`, no `webpack-dev-middleware`, no WebSocket signalling. Reload = browser refresh. The relevant trade-off: every browser refresh re-hits `app/launch.js`, which re-runs `clientConfigGen` and (if necessary) makes a fresh HTTPS request to `rtg.lab.wagerworks.com/api/mns/secureToken` (`app/clientConfig.js:12`) — but this call is currently commented out (`app/clientConfig.js:24`), so the secure token is a fake string until somebody uncomments.

### §2.5 HTTPS posture

- Default mode: HTTP. `app/main.js:97-112`.
- HTTPS only if `--organization` set (passes the RGSTUNNEL handshake via `launchRemote.js`). Uses bundled self-signed cert from `keys/localhost.crt` (`app/main.js:26-27`).
- CORS: blanket `*` (`app/main.js:47-51`). Preflight whitelisted to `playadev.com` (`app/main.js:53-57`).

---

## §3. RGS proxy

The proxy lives in `app/reverseProxy.js` and is mounted twice — once by `rgsRouter.js` for the `/rgs/*` family and once by `skinsRouter.js` for `/skins/forceData/*`.

### §3.1 Protocol

**HTTP/HTTPS only, no WebSocket.** Confirmed by:

- `app/reverseProxy.js:1` `const https = require("https");`
- `app/reverseProxy.js:37` `const proxyRequest = https.request(requestConfig, proxyData => {...})`
- No `socket.io` / `ws` import anywhere in `app/`.
- The in-page transport is XHR (`platform/js/clientservice.js:5632-5781`, `function request(...) { var httpReq = new XMLHttpRequest(); ... }`).
- For game-close, `navigator.sendBeacon` is preferred (`platform/js/clientservice.js:6439-6440`).

### §3.2 Request schema (proxy mechanics)

`app/reverseProxy.js` exports a factory `(server, replayBuffer, replaySave)` returning a handler `(req, res, path, record)`:

```js
// reverseProxy.js:14-65 (paraphrased + line-anchored)
return (req, res, path, record) => {
  const requestBody = JSON.stringify(req.body);
  const requestConfig = {
    host: `${server}.lab.wagerworks.com`,                     // reverseProxy.js:12 host
    path: path + (req.body.flag === "clear" ? "&flag=clear" : ""), // reverseProxy.js:18-19
    method: req.body.flag === "clear" ? "GET" : req.method,   // reverseProxy.js:20
    headers: {
      ...req.headers, host,
      "accept-encoding": record ? "" : req.headers["accept-encoding"], // reverseProxy.js:24
    },
  };
  if (req.session.magicCookie)                                // reverseProxy.js:29-31
    requestConfig.headers.cookie += ";" + req.session.magicCookie;

  requestConfig.agent = new https.Agent(requestConfig);       // reverseProxy.js:33

  const { buffer, writeFile } = glrRecorder(req.session, record); // reverseProxy.js:35

  const proxyRequest = https.request(requestConfig, proxyData => {
    if (proxyData.headers["set-cookie"]?.length > 0)          // reverseProxy.js:39-41
      req.session.magicCookie = proxyData.headers["set-cookie"][0];

    res.writeHead(proxyData.statusCode, proxyData.headers);   // reverseProxy.js:43
    proxyData.on("data", chunk => {                            // reverseProxy.js:44-48
      res.write(chunk);
      buffer(chunk);           // GLR recorder
      replayBuffer(chunk);     // ring buffer
    });
    proxyData.on("end", () => {                                // reverseProxy.js:49-53
      res.end();
      writeFile(req.path);
      replaySave(req.path, proxyData.headers["content-encoding"]);
    });
  });
  // ... error → 503; write body; end.
};
```

Key observations:

1. **No protocol translation.** Bytes are piped end-to-end (`proxyData.on("data", chunk => res.write(chunk))`). The proxy is transparent.
2. **Cookie pinning via `magicCookie`.** Whatever `Set-Cookie` the live RGS sends on first contact is stashed in `req.session.magicCookie` (Express session, file-store-less) and re-injected on every subsequent request (`reverseProxy.js:29-31`). This is how the proxy preserves the upstream session affinity.
3. **`flag=clear` short-circuit.** A request with body `{flag:"clear"}` is rewritten to `GET path&flag=clear` (no body) regardless of original method (`reverseProxy.js:19-20`). This is how the game resets the upstream RGS state during a forced-outcome dev workflow.
4. **`accept-encoding` stripping during record.** When `record` is truthy, `accept-encoding` is cleared (`reverseProxy.js:24`), forcing the upstream to send identity-encoded bodies that can be saved verbatim. Otherwise the upstream may gzip and the GLR file would store raw gzip bytes.

### §3.3 Endpoint catalog (what the kernel calls)

The in-page kernel posts every RGS call under `clientConfig.serverConfig.server + "/<endpoint>"`. Since `serverConfig.server === "/rgs"` (`app/clientConfig.js:272`), the call lands on the local Express server, which proxies to `<upstream>/skb/<endpoint>` (`app/rgsRouter.js:15`).

| Endpoint | Method | clientservice.js handler | Purpose |
|:--|:--|:--|:--|
| `/authenticate` | POST | `clientservice.js:6337` | Player session auth + geolocation handshake. |
| `/initstate` | POST | `clientservice.js:6354` | Resume an in-progress wager. |
| `/paytable` | POST | `clientservice.js:6287` | Paytable + RGS config. |
| `/play` | POST | `clientservice.js:6377` | Spin / wager. Carries serialized `gamePayload`. |
| `/replay` | POST | `clientservice.js:6393` | Replay a recorded transaction (regulator). |
| `/replayshareurl` | GET | `clientservice.js:6409` | Get a shareable replay URL. |
| `/close` | POST/Beacon | `clientservice.js:6442` (Beacon: 6440) | End session. Sent via `sendBeacon` when possible. |
| `/playerbalance` | POST | `clientservice.js:6462` | Refresh balance. |
| `/currency` | POST | `clientservice.js:6493` | Currency table (with `currencycode,language,skincode,nscode`). |
| `/clientConfig` | POST | `clientservice.js:6506` | RGS-side override of clientConfig (rare path). |
| `/chooseOffer` | POST | `clientservice.js:6524` | UKRC offer selection. |
| `/notify` | POST | `clientservice.js:6559` | UKRC notification command. |
| `/additionalgameinfo` | POST/Beacon | `clientservice.js:6594-6596` | Misc analytics events. |

The "skb" prefix appears in `rgsRouter.js:15` and is the IGT account-skin code — "skb" is hard-coded for this build (the prefix is also referenced in `app/launchRemote.js:11`).

### §3.4 Server-determined outcome injection

There are two distinct "force outcome" pathways:

#### §3.4.1 Force-data via gaff tool

- The gaff tool UI is at `/skins/gaffTool/gaffTool.html` (`app/skinsRouter.js:12`).
- It is **NOT** served from local files — the file `console/skins/gaffTool/gaffTool.html` is **missing** from the shipped tree (`Bash:find /Users/.../console/skins -type f` returns no match for `gaffTool/`). Either the user clones a sibling `playa-cli-private` repo into `console/skins/gaffTool/` or the gaff tool comes from a separate install.
- When it *is* present, `skinsRouter.js:19-25` injects `{PRESENT_TYPE, CHANNEL, SOFTWARE_ID, SERVER, SKIN_CODE}` so the gaff tool knows what game/session it's targeting.
- Force-data fetches go through `GET /skins/forceData/*` (`app/skinsRouter.js:30`), which proxies to `https://<server>.lab.wagerworks.com/skins/forceData/*`. The "force outcome" is therefore **server-determined upstream**, not constructed by the proxy.

#### §3.4.2 Force-data via GLR replay

When `--glr <name>` is used, the entire `/rgs/*` namespace is taken over by `glrPlayer.js`. Every `/rgs/play` call returns the pre-recorded `play.<N>.json` (`app/glrPlayer.js:27-30`). The "outcome" is therefore **frozen in the GLR file** — see §4 for the file format.

### §3.5 Auth / session handshake

The session model has two cooperating layers:

| Layer | Storage | Owner |
|:--|:--|:--|
| Browser ↔ playa-cli | Express in-memory session, `connect.sid` cookie (`app/main.js:29-40`). 7-day max-age. | Local. |
| playa-cli ↔ upstream RGS | The upstream's own session cookie, captured at first `Set-Cookie` and stashed as `req.session.magicCookie` (`app/reverseProxy.js:29-31`). | Upstream. |

The flow on first call:

```
browser GET /
  └─ launch.js builds clientConfig (incl. uniqueid, securetoken)  ─ app/launch.js:39-47
  └─ index.tpl served with <meta CLIENTCONFIG>                     ─ platform/index.tpl:14
  └─ kernel.js boots, mounts launcher.html iframe, runs game
browser POST /rgs/authenticate
  └─ rgsRouter → reverseProxy → https://rgs-gsdev02.lab.wagerworks.com/skb/authenticate
       upstream returns Set-Cookie: JSESSIONID=...
       reverseProxy stashes in req.session.magicCookie               ─ app/reverseProxy.js:39-41
browser POST /rgs/play  (and onward)
  └─ reverseProxy appends ";<magicCookie>" to outgoing Cookie header ─ app/reverseProxy.js:29-31
```

The `secureToken` in the injected clientConfig is intentionally a synthetic string:

```js
let secureToken = `${server}.${skincode}.${uniqueid}.channel:${channel}.presentationType:${presenttype}`;
//                                       ↑ app/clientConfig.js:9
```

A real `getSecureToken()` against `rtg.lab.wagerworks.com/api/mns/secureToken` exists at `app/clientConfig.js:10-23` but is commented out (`app/clientConfig.js:24`). So in default operation the secureToken is **fake** — the upstream RGS dev tier tolerates this because `--server rgs-gsdev02` is a non-prod environment.

---

## §4. GLR — Game Log Record

### §4.1 File format

A GLR directory is just a folder of newline-delimited JSON-ish files, one per RGS round-trip. Layout:

```
GLR/<name>/
├── authenticate.json    one snapshot of /authenticate response
├── initstate.json       (optional) one snapshot of /initstate
├── paytable.json        (optional) one snapshot of /paytable
├── play.1.json          play call N=1
├── play.2.json          play call N=2
├── play.3.json
├── ...                  (count = number of "play" entries)
├── close.json           (optional) the close response
```

Naming + creation rules — `app/glrRecorder.js:33-47`:

```js
// glrRecorder.js:33-47
const writeFile = reqPath => {
  const action = path.basename(reqPath).toLowerCase();
  if (action === "authenticate") {
    session.playCount = 0;
    writeBufferToFile("authenticate.json");
  } else if (action === "play") {
    session.playCount = (session.playCount || 0) + 1;
    writeBufferToFile(`play.${session.playCount}.json`);
  } else {
    writeBufferToFile(`${action}.json`);
  }
  session.save();
};
```

The file *content* is the raw HTTP body of the upstream response (`glrRecorder.js:28-31`):

```js
const writeBufferToFile = fileName => {
  const data = Buffer.concat(chunks);
  fs.writeFileSync(path.join(targetDir, fileName), data, "utf8");
};
```

Where `chunks` is populated from `reverseProxy.js:46` (`proxyData.on("data", chunk => { ... buffer(chunk); ... })`).

### §4.2 Encoding

- **Default**: identity-encoded UTF-8 JSON, written verbatim.
- **Caveat**: if `accept-encoding` was *not* stripped, the saved bytes may be gzip/deflate. The `replayBuffer.js:48-54` decoder is the *replay-buffer* path (which decompresses before re-encoding); the **direct GLR path** in `glrRecorder.js` does no decompression and relies on the upstream sending identity bytes because `reverseProxy.js:24` clears `accept-encoding` whenever `record` is set.
- Compression in replay buffer:
  - `"gzip"` → `zlib.gunzipSync` (`replayBuffer.js:50`)
  - `"deflate"` → `zlib.deflateSync` (`replayBuffer.js:52`) — **NOTE: bug — should be `inflateSync`.** Worth flagging when adopting.

### §4.3 What is *not* recorded

Critically:

| Recorded | Not recorded |
|:--|:--|
| Every `/rgs/*` HTTP response body, verbatim. | RNG seeds (the RNG runs inside the RGS, not visible to the proxy). |
| The temporal order is preserved as an integer `playCount`. | Wallclock timestamps for each response. |
| `authenticate` is the only "start" sentinel. | Render-side state snapshots (no Pixi snapshot, no DOM hash). |
| | State-machine transitions inside the game client (the `GameStatus` / `NextStage` fields are inside `play.N.json`'s payload but the client's own FSM transitions are not). |
| | Console / overlay UI events (only one in-game `gameOutcome` field stays). |
| | Audio mix or visual-effect timing. |

So determinism is **server-determinism only** — the game client must consume `play.N.json` and re-derive its own visual state from the `OutcomeDetail` schema. The GLR does *not* freeze the front-end.

### §4.4 Replay engine

The replay engine is `app/glrPlayer.js` (37 lines). It is staggeringly simple:

```js
// glrPlayer.js:8-37
module.exports = ({ glr: glrName }) => {
  const glrDir = path.isAbsolute(glrName)
    ? glrName
    : path.basename(glrName) !== glrName
        ? path.normalize(glrName)
        : path.resolve(DEFAULT_DIR, glrName);

  const totalPlayCount = fs.readdirSync(glrDir)
    .filter(name => name.startsWith("play")).length;        // glrPlayer.js:15

  const router = express.Router();
  router.all("*", (req, res) => {
    const action = path.basename(req.path);
    if (action === "authenticate") {
      req.session.playCount = 0;                           // glrPlayer.js:22-24
      req.session.save();
    }
    if (action === "play") {
      req.session.playCount = (req.session.playCount % totalPlayCount) + 1;  // glrPlayer.js:28
      req.session.save();
      res.sendFile(path.join(glrDir, `play.${req.session.playCount}.json`));
    } else {
      res.sendFile(path.join(glrDir, `${action}.json`));   // glrPlayer.js:32
    }
  });
  return router;
};
```

Mechanics:

1. **Path resolution** (`glrPlayer.js:9-13`):
   - Absolute path → use as-is.
   - Contains a `/` → relative path.
   - Bare name → `./GLR/<name>/`.
2. **Auto-cycle** (`glrPlayer.js:28`): `playCount = (playCount % totalPlayCount) + 1`. So replays *loop forever* — the player can spin infinitely and the same N recorded outcomes cycle. This is a deliberate design choice for QA-style demo work.
3. **Other actions** (`paytable`, `playerbalance`, `close`, ...): just send the `<action>.json` file straight back if it exists.
4. **No content-type adjustment.** `res.sendFile` will infer based on `.json`. The game's `clientservice` code parses JSON via WebWorker (`clientservice.js:5672`) so this works.

### §4.5 Replay-buffer (the ring buffer for "save last N outcomes")

`app/replayBuffer.js` is used when `--server` is set (live mode). It maintains an in-memory list of recent responses and offers a readline prompt to "Save replay as ?". Mechanics:

| Step | File:line | Detail |
|:-:|:--|:--|
| 1 | `replayBuffer.js:10` | Empty `chunks` per pending response; `replayData` is the persistent list. |
| 2 | `replayBuffer.js:14-28` | `save(reqPath, encoding)` is called from `reverseProxy.js:52` on each `end`. If action is "play" and `replayData` already has ≥ `maxReplays` plays (`bin/args.js:153-159`, default 30), it removes the oldest play. Then pushes `{action, encoding, chunks}`. |
| 3 | `replayBuffer.js:30-41` | Hijacks `console.log` to redraw the readline prompt after every log. |
| 4 | `replayBuffer.js:43-72` | Recursive `prompt()` reads a name. On enter, replays the entire ring buffer through `glrRecorder({playCount, save: noop}, name)`. Decompresses gzip/deflate where needed. Appends a synthetic `close.json` (`{"Close":{"Status":"Success"}}`, `replayBuffer.js:67`) if missing. |
| 5 | `replayBuffer.js:73` | Kicks off the prompt 1 ms after startup. |

So a long live session can be retroactively snapshotted to a GLR directory at any moment — just type a name into the terminal prompt.

### §4.6 Determinism guarantees

| Property | Guaranteed? | Note |
|:--|:-:|:--|
| Same `/rgs/play` response body each replay step | YES | bytes-for-bytes |
| Same `playCount` order | YES | cycles mod N |
| Same RNG outcome | YES indirectly | because the outcome was baked into the response |
| Same client-side reel land time | NO | wallclock not stored |
| Same animation/audio frame timing | NO | client-side only |
| Same console/sidebet UI state | NO | not stored |
| Same JSDOM DOM hash | NO | DOM is browser-side |

In short: **GLR is a network-level oracle**. It guarantees the *RGS will say the same thing on N-th spin*. It does NOT guarantee that the game *renders* identically — that part requires the game client itself to be deterministic, which is a separate property the game-side framework (`playa-core` / `playa-slot-template-standard-game`) must enforce.

### §4.7 No binary/JSON format magic

There are no Protocol Buffers, FlatBuffers, MessagePack, JSON-LD, JSON-Schema, or compression magic at the GLR file layer. Files are vanilla JSON, named by convention, read by `fs.readdirSync` + `path.basename` filtering. This makes GLRs trivial to inspect, diff, and modify by hand — which is the regulator-friendly property.

---

## §5. JSDOM hosting

### §5.1 Why JSDOM is in the dependency tree

The README never mentions JSDOM but `package.json:17` requires it. Searching for it:

```
$ grep -rn 'jsdom' app/
app/clientConfig.js:3:const { JSDOM } = require("jsdom");
app/clientConfig.js:53:                    const dom = new JSDOM(data, { contentType: 'text/html' });
app/clientConfig.js:70:                    const exception = new JSDOM(data, { contentType: "text/xml" }).window.document.querySelector("Exception");
app/clientConfig.js:136:                   const dom = new JSDOM(data, { contentType: 'text/html' });
```

Three JSDOM constructions, **all inside `clientConfig.js`**, **all server-side**, all for **parsing HTML/XML responses from upstream**.

### §5.2 The three JSDOM uses

| Use | File:line | What it does |
|:--|:--|:--|
| Parse upstream `clientConfig` HTML | `app/clientConfig.js:47-58` | Hits `https://<server>.lab.wagerworks.com/skb/gateway?...`, gets back a full HTML page (the legacy gateway template), and uses JSDOM to extract `document.getElementsByName('com.igt.skateboard.CLIENTCONFIG')[0]`. That `<meta>` element's `content` attribute is a JSON blob containing the *real* clientConfig. JSON.parse it → merge into ours. |
| Parse jackpot-status XML | `app/clientConfig.js:70` | The two jackpot URLs (`jackpotMeterUrl`, `jackpotWinsUrl`) return XML. JSDOM with `contentType:"text/xml"` lets us `querySelector("Exception")` to detect upstream errors and skip those URLs in the generated clientConfig. |
| Parse replay-token HTML | `app/clientConfig.js:130-148` | Same trick as case 1 but for `https://<server>/skb/replaygateway?token=<JWT>`. Extracts `replaySessionId`, `replayToken`, `replayTransactionId`, `replayValidTime`, `totalRounds`, `isReplay`, and `paramRGS.token`. |

### §5.3 What JSDOM is NOT used for

It is **NOT** used to:

- Headlessly render the game client (no `new JSDOM(file:///game/launcher.html)` anywhere).
- Step the game's state machine for record/replay.
- Snapshot DOM for visual diffing.

The README's framing of "playa-cli launches a game in JSDOM" is misleading. The browser is what runs the game. JSDOM only exists so the Node-side `clientConfig` builder can scrape JSON out of upstream HTML responses (the legacy IGT gateway returns HTML, not JSON, for clientConfig).

### §5.4 Browser API polyfills

None. JSDOM 22 ships its own polyfill set (XHR, fetch on require, DOMParser, …) but the playa-cli code doesn't wire any of it to the game. The game itself runs in the actual browser, so polyfills are whatever the browser provides.

### §5.5 Sandboxing

JSDOM is invoked with the **default sandbox** (no script execution, no `runScripts:"dangerously"`, no resource loader). Both invocations pass either `contentType:"text/html"` or `contentType:"text/xml"` (`app/clientConfig.js:53,70,136`) — that's all. So we're never executing untrusted code from the upstream.

---

## §6. CLI surface

Defined in `bin/args.js:3-173`. Below is every flag + every alias + default + group + semantic. All cite `bin/args.js:LINE`.

### §6.1 Common group

| Flag | Aliases | Type | Default | bin/args.js | Semantics |
|:--|:--|:--|:--|:--:|:--|
| `--target` | `-t` | normalize (path) | `./dist` | 4-10 | Path to compiled game's dist directory. Mounted at `/game`. |
| `--port` | `-p` | number | `8080` | 11-17 | Local port for Express. |
| `--channel` | — | string | `INT` | 18-24 | One of `INT,TAB,MOB` (desktop, tablet, mobile). Drives `style.<channel>.css` (`app/launch.js:19`) and `assetPack` (`app/clientConfig.js:165-178`). |
| `--language` | `--lang` | string | `en` | 25-31 | i18n. Propagated through every RGS call. |
| `--skincode` | `--skin` | string (uppercased) | `SKB` | 32-39 | Skin/operator code. |
| `--presenttype` | `--presentType` | string | `STD` | 40-47 | One of `STD,MIN`. |
| `--currencycode` | `--currency` | string (upper) | `GBP` | 48-55 | |
| `--countrycode` | `--country` | string (upper) | `GB` | 56-63 | |
| `--customDesigns` | `--designs` | normalize | `./custom-designs` | 125-131 | Path to alt design directory. |
| `--slamStop` | `-ss --slam --slamstop` | string | `ON` | 132-138 | Slam-stop button toggle. |
| `--spaceBarSpin` | `--spacebarSpin --spacebarspin` | string | `OFF` | 139-145 | Coerced to boolean in `mergeParams.js:5-6`. |
| `--turboMode` | `--turboMode --turbomode` | string | `OFF` | 146-152 | Coerced to boolean in `mergeParams.js:8-10`. |
| `--maxReplays` | `--mr --maxreplays` | number | `30` | 153-159 | Replay-buffer cap. |
| `--gameReplayToken` | `--grt --gamereplaytoken` | string | — | 160-165 | A `JWT` from `replaygateway?token=...`. Loads game in replay mode. |
| `--promofs` | `--pfs` | string | `"undefined"` (string literal) | 166-172 | Promo free-spin URL helper. |

### §6.2 Local GLR group

| Flag | Aliases | Type | bin/args.js | Semantics |
|:--|:--|:--|:--:|:--|
| `--glr` | `-g` | string | 64-69 | A path to a GLR directory OR a bare name (assumes `./GLR/<name>`). Mutually-exclusive with `--server` (`bin/cli.js:13-17`). |

### §6.3 Remote Server group

| Flag | Aliases | Type | Default | bin/args.js | Semantics |
|:--|:--|:--|:--|:--:|:--|
| `--server` | `-s` | string | — | 70-75 | Upstream RGS shortname (e.g. `rgs-gsdev02`). Resolves to `<server>.lab.wagerworks.com` (`app/reverseProxy.js:12`). |
| `--nscode` | `--ns` | string | `SKB` | 76-82 | RGS namespace. |
| `--softwareid` | `-i --softwareId` | string | `200-9017-001` | 83-89 | Game backend id. |
| `--uniqueid` | `-u --user` | string | random | 90-96 | Player id. Default `u${Math.floor(Math.random()*1e16).toString(36)}` is regenerated each launch. |
| `--record` | `-r` | string | — (implies `--server`) | 97-103 | Save this session as a GLR named/pathed `<value>`. |
| `--organization` | `--org` | string | `"undefined"` | 104-110 | RGSTUNNEL org name. Triggers HTTPS + cloud SSO flow. |
| `--denomamount` | `--denom` | string | `0.01` | 111-117 | |
| `--minbet` | `--minb` | string | `0.01` | 118-124 | |

### §6.4 Subcommand handler

Only one subcommand: `launch`. Defined in `bin/cli.js:10-23`:

```js
yargs.command("launch", "Serve a local Playa game", {
  builder: yargs =>
    yargs.options(yargsConf).check(({ server, glr }) => {
      if (!server && !glr) {
        throw new Error("Either a remote server or local GLR must be specified");
      }
      return true;
    }),
  handler: argv => {
    argv.server = argv.s = checkArrayReturnLastParam(argv.server);
    const { target, port, ... } = argv;
    app({ target, port, ... });
  },
});
yargs.demandCommand(1).help().argv;       // bin/cli.js:24-25
```

### §6.5 Examples (from README.md)

| Example | README.md:LINE |
|:--|:-:|
| `playa launch --glr <GLR>` | 40 |
| `playa launch --server rgs-gsdev02 --softwareId 200-1173-001` | 50 |
| `playa launch --server rgs-gsdev02 --softwareId 200-1173-001 --record <GLR>` | 63 |
| `playa launch --gameReplayToken <Token>` | 77 |
| `http://127.0.0.1:8080/?uniqueid=YOURUSER&playMode=freespin&freespin_tokenID=ID&freespin_num=10&freespin_bet=0.01&freespin_lines=20` | 92 |

URL params (anything after `?`) override CLI params via `mergeParams.js:13-23` (precedence: CLI defaults < session.params < req.query).

### §6.6 VS Code launch profile

`launch.json:18` hard-codes `args=["launch", "--server", "rgs-gsdev02"]` and `cwd=C:/IGTFramework/playa-slot-template-standard-game` — confirming this is run side-by-side with the standard-game template, with the template's `./dist` becoming the `--target`.

---

## §7. Reverse-engineering insights for slot-gdd-factory

### §7.1 How can SGF emit games that are GLR-compatible?

A GLR-compatible game must obey these constraints, learned from the schema in §4:

1. **Network endpoint convention.** The game's HTTP layer must POST to `<RGS-base>/authenticate`, `<RGS-base>/play`, `<RGS-base>/initstate`, `<RGS-base>/playerbalance`, `<RGS-base>/close`, `<RGS-base>/paytable`, `<RGS-base>/replay`, plus a few optionals (`<RGS-base>/chooseOffer`, `<RGS-base>/notify`, `<RGS-base>/additionalgameinfo`). The base URL must be configurable from a single field (industry-standard dev server reads `clientConfig.serverConfig.server`).
2. **Wire format.** Bodies are JSON. POST is the default; one quirk: `{flag:"clear"}` collapses to GET with `&flag=clear` appended (matches `app/reverseProxy.js:18-20`).
3. **Cookie-based session pinning.** The first response's `Set-Cookie` must be honored and re-sent on subsequent calls. SGF must NOT bake a session id into the URL.
4. **Response schema invariants.** Every `/play` response must contain `GameLogicResponse.OutcomeDetail` with at minimum: `GameStatus` ∈ {`Start`, `InProgress`, `Complete`}, `NextStage`, `Stage`, `Payout`, `Settled`, `Pending`, `TransactionId`. These are read in `platform/js/clientservice.js:446,455-460,505,509,3055-3074,4213-4214,4309-4310,4650-4729`.
5. **Replay-mode skip.** When the game-side `playMode === 'replay'` (set in `app/clientConfig.js:251,297,313,361`), the game must short-circuit `close` and not commit balance changes. The reference path is `clientservice.js:6424-6427`:
   ```js
   if (clientConfig.serverConfig.playMode === 'replay') {
     success(); return;
   }
   ```
6. **No client-side RNG.** The outcome lives in `OutcomeDetail`. The game *renders* it — it does not *generate* it. This is the regulator-mandated split.

If SGF's emitted game obeys (1)-(6), an industry-standard dev server / replay tool (with the same endpoint contract) will be able to record GLRs from it and replay them later without modification.

### §7.2 What SGF currently lacks vs. what it should adopt

Bridge table — IGT layer → SGF equivalent → gap:

| IGT layer | SGF equivalent today | Gap |
|:--|:--|:--|
| `bin/cli.js` + `bin/args.js` (yargs CLI with `launch` subcommand) | `src/cli/` partial: `sgf-build.mjs`, `sgf-emit.mjs`, no `sgf-launch`. | **Missing**: a `sgf launch <game>` cmd that boots the just-emitted HTML directly. Today user opens `dist/<game>.html` manually. |
| `app/main.js` (Express + static `/game`, `/platform`, `/console`, `/skins`) | No SGF dev server — output is a single self-contained HTML. | **Missing**: dev server that serves the emitted HTML + sidecar assets + a mock RGS. SGF currently bundles everything inline, which works but blocks GLR record/replay. |
| `app/clientConfig.js` (synthesizes a 450-line config object from CLI flags) | `src/blocks/clientConfig.mjs` — TBD if it exists. | **Likely missing** or incomplete. SGF should emit a minimal `clientConfig` shaped like `{ gameConfig, serverConfig, deviceConfig, kernelConfig, consoleConfig, customConfig, stringsConfig }` so it slots into the industry-standard kernel runtime. |
| `app/reverseProxy.js` (HTTPS pipe + cookie pinning + accept-encoding control) | None. | **Missing**: when SGF gains a dev server, it needs a reverse-proxy mode for talking to a real upstream RGS during integration testing. |
| `app/glrPlayer.js` + `app/glrRecorder.js` (record/replay as JSON-per-call files) | None. | **Missing**: SGF currently has internal "force outcome" via `forceData/*` URL params but no portable GLR equivalent that can be diffed/archived. |
| `app/replayBuffer.js` (last-N ring buffer + readline prompt) | None. | **Missing**: useful for QA — "I just saw a bug at spin N, save the last 30 spins as a GLR". |
| `console/skins/replay/STD/INT/skin.html` (replay UI with pause / play / fast / share) | None. | **Missing**: a "playback chrome" overlay that visibly says "REPLAY MODE • 12/30 outcomes". Regulator and QA both benefit. |
| `platform/js/kernel.js` (~574 KB minified runtime that boots the iframe) | SGF inlines everything in the emitted HTML. | Architectural choice — SGF's all-in-one HTML is simpler; the IGT split (kernel ⇄ game iframe) is heavier but allows console-skin chrome. |
| `app/skinsRouter.js` + `/skins/forceData/*` proxy | URL-param-based force in some SGF blocks. | **Gap**: SGF's force-data is per-block ad-hoc strings. The IGT model uses an HTTP endpoint family that a separate UI ("gaffTool") consumes; this is more composable. |
| `app/mergeParams.js` (CLI ▸ session ▸ URL-query precedence) | URL-query precedence exists in some blocks. | **Gap**: SGF should formalize a 3-tier merge so URL params can override everything during QA. |
| JSDOM for parsing legacy HTML clientConfig | N/A (SGF emits, doesn't consume legacy HTML) | Not needed. |
| `keys/localhost.{crt,key}` self-signed cert | N/A | Likely not needed unless SGF gains HTTPS dev server. |
| `redirect/index.html` (org-tunnel SSO bounce) | N/A | Not needed. |

**Concrete recommendations** for SGF to adopt:

1. **Add a `sgf serve <html>` CLI subcommand.** Reuses the emitted HTML, but wraps it with Express. Mounts `/game` → the dist dir, `/rgs` → a mock RGS router. ~80 lines of code; mirrors `app/main.js`.
2. **Define an SGF GLR format.** Folder of `play.<N>.json`, `authenticate.json`, `close.json`. Each file: a JSON object containing `{outcome, balance, stage, nextStage, payout, transactionId, gamePayload}` plus an optional `__sgfMeta: {math_model_hash, block_versions, sgf_version}` so future SGF versions can reject incompatible GLRs.
3. **Implement a record/replay router pair.** Mirror `glrRecorder.js:33-47` (write per-action) and `glrPlayer.js:25-32` (read with mod-N cycle). Total ~100 lines.
4. **Emit a "replay-aware" runtime flag** in the SGF block bus. When `playMode === 'replay'`, blocks should skip side-effects (balance writes, telemetry POSTs, autoplay decisions). Mirror `clientservice.js:6424-6427`.
5. **Add a `--force-outcome <path>` flag** that surfaces an in-page panel (`/__sgf/gaff`) for forcing specific reels/wins from a JSON file. Mirror the `app/skinsRouter.js:12-28` injection pattern.
6. **Don't adopt JSDOM.** It's only there in IGT because they have to parse legacy upstream HTML. SGF emits clean JSON config — no parser needed.
7. **Don't adopt the JSP template scrubber.** `config/removals.js:1-9` is a fossil of the old IGT Java-pipeline. SGF should keep its own clean Mustache/template system.

### §7.3 The architectural difference to keep

SGF's "all-in-one HTML" is a *better* deliverable than IGT's "kernel iframe + many static services" for these reasons:

| Property | IGT layered | SGF inline |
|:--|:-:|:-:|
| Servable from disk via `file://` | ✗ | ✓ |
| Inspectable in any browser without Express | ✗ | ✓ |
| Asset count | dozens (kernel.js, clientservice.js, gameservice.js, consoleservice.js, IXF/postalAll.js, css, fonts, skins…) | 1 |
| Refresh story | full server reboot or `Date.now()` cache buster | re-open file |
| Integration-test friendly | ✗ — needs RGS proxy | ✓ — math + render only |
| Regulator-archival friendly | needs the whole `playa-cli` + `playa-core` tree | needs the HTML + GLR pair |

So SGF should **not** try to mimic the kernel split. It should add the *thin* layer (dev server + GLR record/replay + mock RGS) on top of its existing inline-HTML output.

### §7.4 Endpoint contract SGF should emit against

If SGF wants to ship games that work with **both** the standard industry kernel and its own dev server, the emitted game's HTTP layer should target this minimal endpoint set:

| Endpoint | Method | Required for | Response shape |
|:--|:--|:--|:--|
| `/authenticate` | POST | Session bootstrap | `{ RGSResponse: { Authentication: { Status: "Success", gsInfo, extra? } } }` |
| `/play` | POST | Every spin | `{ RGSResponse: { GameLogicResponse: { OutcomeDetail: { GameStatus, NextStage, Stage, Payout, Settled, Pending, TransactionId }, ... } } }` |
| `/playerbalance` | POST | Balance refresh | `{ RGSResponse: { Balance: {...} } }` |
| `/close` | POST + Beacon | Session end | `{ RGSResponse: { Close: { Status: "Success" } } }` |
| `/initstate` | POST | Resume in-progress | Same envelope as `/play`. |
| `/paytable` | POST | First-time load | `{ RGSResponse: { Paytable: {...} } }` |
| `/replay` | POST | Playback only | Same envelope as `/play`. |

The wrapping convention is implemented in `clientservice.js:13491-13499`:

```js
function commonTransformResponseData(data) {
  if(!data.RGSResponse && !data.Exception) {
    return { RGSResponse: data };       // success body auto-wrapped
  }
  return data;
}
```

So SGF can emit *either* `{Authentication:{...}}` (the inner shape) or `{RGSResponse:{Authentication:{...}}}` (the wrapped shape) — both will be normalized.

---

## §8. Pitfalls + non-obvious mechanics

### §8.1 Hidden state inside `req.session`

The Express session object is repurposed as **shared state between the proxy and the recorder**. Three keys live on it:

| Key | Set by | Read by | Risk |
|:--|:--|:--|:--|
| `req.session.params` | `app/mergeParams.js:13-16` | every request | Persistent for 7 days. URL-query overrides bleed into subsequent unrelated requests. |
| `req.session.magicCookie` | `app/reverseProxy.js:40` | `app/reverseProxy.js:30-31` | If session expires mid-game, every subsequent request will reuse a stale upstream cookie until the proxy gets a new `Set-Cookie`. |
| `req.session.playCount` | `app/glrRecorder.js:38-41` & `app/glrPlayer.js:23-29` | both record + replay | Shared between record and replay paths. If a user switches mid-run (impossible in CLI but possible in tests), counts can desync. |

The session secret is **hard-coded**: `"okltlklybxg"` (`app/main.js:30`). Anyone with network access to the dev server can forge a session.

### §8.2 The replay-buffer `deflateSync` bug

`app/replayBuffer.js:52`:
```js
else if (data.encoding === "deflate")
    buffer(zlib.deflateSync(Buffer.concat(data.chunks)));
```

This should be `zlib.inflateSync` — they're decoding a deflate-compressed response back to plaintext so it can be written as a usable GLR. As written, it *re*-deflates already-compressed data, producing a doubly-compressed file. Currently dormant because the proxy normally strips `accept-encoding` (`reverseProxy.js:24`), but if upstream RGS ever returns `Content-Encoding: deflate` despite the strip, the GLR will be malformed. **Worth a fix if SGF clones this code.**

### §8.3 Force-outcomes need the gaff tool — which is not shipped

`app/skinsRouter.js:12` references `../console/skins/gaffTool/gaffTool.html` but the file does not exist in this repo (`Bash:find console/skins -type f -name 'gaffTool*'` returns nothing). The full gaff tool ships in a sibling private repo (the IGT `gaffTool` extension). So `playa launch` without that sibling cannot actually force outcomes via the gaff-tool path — the only force path that works out-of-the-box is **server-side force-data through `--server`** (`app/skinsRouter.js:30`).

### §8.4 Auto-cycling replays mask "did we exit the GLR" bugs

`glrPlayer.js:28` uses `(playCount % totalPlayCount) + 1`. So after the recorded N spins, spin N+1 = spin 1 again. **The player never knows they've exited the recording.** A QA flow expecting "test bug at spin 35 of a 30-outcome GLR" will silently get spin 5 again, which may pass while the real bug at spin 35 (which doesn't exist) goes undetected.

### §8.5 `--organization=undefined` is the *string* `"undefined"`, not the value

`bin/args.js:107`:
```js
organization: { ... default: "undefined", ... }
```

`app/main.js:95`:
```js
if (organization === "undefined") {     // string compare
  app.listen(port, ...);                // plain HTTP path
} else {
  https.createServer(...).listen(port, ...);   // HTTPS path
}
```

If a user types `--organization undefined` (without quoting), yargs hands the string `"undefined"` through, and the plain-HTTP path runs. If they type `--organization=` (empty), yargs hands an empty string, which is **not** `"undefined"`, so the HTTPS path runs — and then `app/launchRemote.js:11` constructs URLs that have a bare empty-string org. The arg parsing is fragile.

### §8.6 `clientConfig.js` makes synchronous HTTPS calls during render

`app/launch.js:39` calls `await clientConfigGen(...)` which may issue up to three upstream HTTPS calls (`getSecureToken`, `getClientConfig`, `getReplayConfig`). If `--server` points to a network-unreachable host, **every browser refresh hangs** until DNS/TCP timeouts elapse (~10-30 s). There is no caching.

Worse: `app/clientConfig.js:24` shows `// await getSecureToken()` commented out. The `secureToken` therefore stays as the synthetic string `${server}.${skincode}.${uniqueid}.channel:${channel}.presentationType:${presenttype}` (`app/clientConfig.js:9`). If the upstream RGS ever enables stricter token validation, every dev launch will fail until somebody uncomments line 24.

### §8.7 The hard-coded `"/skb"` namespace

`app/rgsRouter.js:15` routes everything (except `/tc/*`) to `/skb${req.url}` upstream. The literal `"skb"` is also baked into `app/launchRemote.js:11` (`server: "/RGSTUNNEL/"+server+"/skb"`). If you ever need to target a non-skb skin upstream, this needs to become parameterized. The `--skincode` flag does **not** affect this path.

### §8.8 CORS `origin:'*'` plus session cookies = CSRF surface

`app/main.js:47-51` sets `origin:'*'`, but the express-session cookie is non-`httpOnly` (`app/main.js:36` `httpOnly:false`). A malicious page loaded in the same browser can cross-fire requests with the session cookie attached. This is acceptable for a localhost dev tool but **never** for production — and the explicit `preflightContinue:true` (`app/main.js:50`) actively makes it worse by allowing preflight to fall through.

### §8.9 The `flag=clear` GET-rewrite is undocumented but load-bearing

`app/reverseProxy.js:18-20`:
```js
path: path + (req.body.flag === "clear" ? `&flag=clear` : ""),
method: req.body.flag === "clear" ? "GET" : req.method,
```

This is **not in the README**. It's how the gaff tool / "reset session" flow signals "wipe upstream state". If you POST `/rgs/anything` with `{flag:"clear"}`, the body is dropped and the URL gets `&flag=clear`. Subtle — any future replacement of the proxy must preserve this.

### §8.10 No content-length check on GLR files

`app/glrPlayer.js:30` calls `res.sendFile(...)`. If the GLR file is missing, this errors with a 404; if it's truncated mid-JSON (a recording was killed mid-call), the response is sent as-is and the game's `clientservice.js:5680-5683` parser fails with `"CD-104"` — a generic reload error. There is no validator that scans GLRs at startup. **Adopting code should validate JSON shape before serving.**

### §8.11 No clean shutdown of recording

If a user kills the CLI with Ctrl-C mid-recording, the *currently buffering* request's bytes are lost (the `writeFile` only fires on `proxyData.on("end", ...)` at `reverseProxy.js:51`). So the recorded GLR will be missing the last `play.N.json`. If the GLR consumer assumes contiguous N, this looks like spin N+1 silently maps back to spin 1 (see §8.4).

### §8.12 The `softwareid` default targets a missing game

`bin/args.js:84` defaults to `"200-9017-001"`. The README example uses `200-1173-001`. `platform/games.json.template:2` shows `"200-1173-001": "games/CleopatraSKB/"`. There is no entry for `200-9017-001`. So default + no override = "no game found upstream" silent failure. **Always pass `--softwareId` explicitly.**

### §8.13 Replay-mode is silent if `gameReplayToken` is malformed

`app/clientConfig.js:113-160` will fall through to `console.log("Game replay config does not exist.")` if the upstream replay-gateway page doesn't contain the expected `<meta CLIENTCONFIG>` element. The user sees no error in-game — the launch silently proceeds in "real" play mode, racking up actual wagers. Risk for QA workflows that assume "if we passed `--gameReplayToken`, no money is at stake."

### §8.14 Cycling outcomes vs. autospin termination

A game in autospin checks `OutcomeDetail.GameStatus`/`NextStage` to know when to stop (`platform/js/clientservice.js:3111-3112,3146-3147,3168-3169`). If a recorded GLR ends with `GameStatus:"InProgress"`, the replay-cycle restart will jump from "in progress" straight back to spin 1's "start" — which can put the autospin controller into an undefined state where it expects continuation but gets a fresh start. **GLRs should always end with a `GameStatus:"Complete"` outcome** to be safely cycle-replayable.

### §8.15 The "Cleopatra" name appears in `platform/games.json.template:2`

This file is a vendor artifact and is **NOT** read by the CLI at runtime. Per the in-repo vendor-naming rule, when SGF clones this template for its own dev server, the example values should be neutralized (e.g. `{ "demo-001": "games/DemoGame/" }`).

---

## §9. Appendix — endpoint cheat sheet

### §9.1 Local server endpoint table

| Method | Path | Handler | What goes back |
|:--|:--|:--|:--|
| GET | `/` | `app/launch.js:8` | `platform/index.tpl` (HTML) with `<meta CLIENTCONFIG>` injected. |
| GET | `/game/<asset>` | `express.static` (`app/main.js:60`) | Whatever's in `--target/<asset>`. |
| GET | `/platform/<asset>` | `express.static` (`app/main.js:69`) | Kernel JS, CSS, fonts. |
| GET | `/console/<asset>` | `express.static` (`app/main.js:70`) | Console / skin assets. |
| GET | `/IXF/<asset>` | `express.static` (`app/main.js:71`) | igtBridge, gcm bridges, etc. |
| GET | `/custom-designs/<asset>` | `express.static` (`app/main.js:63`) | User-supplied design overrides. |
| GET | `/redirect` | `express.static` (`app/main.js:77`) | Org-tunnel bounce page. |
| GET | `/skins/<skin>/<asset>` | `express.static("../console/skins")` (`app/skinsRouter.js:32`) | Skin HTML/CSS/JS. |
| ALL | `/skins/gaffTool/gaffTool.html` | `app/skinsRouter.js:12-28` | Gaff tool HTML with `/*INJECTEDPARAMS*/` replaced (file not shipped). |
| GET | `/skins/forceData/*` | `app/skinsRouter.js:30` | HTTPS-proxied to `<server>.lab.wagerworks.com/skins/forceData/*`. |
| ALL | `/rgs/*` | `app/glrPlayer.js:19` (replay) or `app/rgsRouter.js:14-15` (live) | A GLR file body OR an upstream HTTP response. |
| ALL | `/rgs/tc/*` | `app/rgsRouter.js:14` | HTTPS-proxied as-is. |

### §9.2 In-page kernel ⇄ /rgs/ call list (all POST unless noted)

| /rgs path | clientservice fn | clientservice.js:LINE |
|:--|:--|:-:|
| `/authenticate` | `requestAuthentication` | 6337 |
| `/initstate` | `requestInitstate` | 6354 |
| `/paytable` | `requestPaytableData` | 6287 |
| `/play` | `requestPlay` | 6377 |
| `/replay` | `requestReplay` | 6393 |
| `/replayshareurl` (GET) | `requestReplayShareUrl` | 6409 |
| `/close` (Beacon or POST) | `requestCloseGame` | 6440 / 6442 |
| `/playerbalance` | `requestPlayerBalance` | 6462 |
| `/currency` | `requestCurrencyData` | 6493 |
| `/clientConfig` | `requestClientConfig` | 6506 |
| `/chooseOffer` | `requestNotifyChooseOffer` | 6524 |
| `/notify` | `requestNotify` | 6559 |
| `/additionalgameinfo` (Beacon or POST) | `sendGameInfo` | 6594 / 6596 |

### §9.3 Files in `console/IXF/1.4/` (the kernel-side console bridge layer)

| File | Bytes | Purpose |
|:--|--:|:--|
| `IXF.js` | 23830 | Root IXF runtime. |
| `igtBridge.js` | 6296 | Message bridge to igt-postal pub/sub. |
| `gcmBridge.js` | 16147 | Game ⇄ Console bridge. |
| `gcmGame.js` | 19236 | Game-side gcm endpoint. |
| `gcmGameMob.js` | 16377 | Mobile-specific gcm. |
| `gcmAdapter.js` + `.html` | 18753 + 2758 | Adapter pair. |
| `gcm4Adapter.js` | 15280 | gcm v4 adapter. |
| `postalAll.js` | 261063 | The full postal.js pub/sub bundle. |
| `ukrcController.js` | 5835 | UK Regulatory controller. |
| `parentRepeater.html` | 858 | Parent-frame repeater shell. |
| `cashier/cashier{Service,BuyInForm,CashOutForm}.js` + `consoleUI.js` | ~ | Cashier flows. |
| `messages/commands.js` + `consoleUI.js` | ~ | Message overlay. |
| `topup/consoleUI.js` | ~ | Top-up flow. |
| `integration/consoleUI.js` | ~ | Integration flow. |
| `espana/{timer,sessions,meters,sessionStartUI,sessionExpiredUI,sessionReminderUI,sessionErrorUI,timerUI}.js` | ~ | Spanish regulatory UI. |
| `promotionalFreeSpins/consoleUI.js` | ~ | PFS UI. |
| `resize/consoleUI.js` | ~ | Resize handling. |
| `lib/{events,timer,clipboard.min,extern,querystring,sliderdt,slider}.js` | ~ | Utility libs. |

### §9.4 Skins shipped

| Skin folder | Notable contents |
|:--|:--|
| `default/` | `STD/{INT,TAB,MOB}/skin.html` + customviews + lobby. `MIN/{INT,TAB}/skin.html`. |
| `defaultNew/` defaultHidden/ defaultPoland/ defaultSpain/ defaultUKRC/ | regional variants |
| `demo/` | demo skin (only `.name` file present) |
| `examples/` | `requiredControls/`, `relayMessage/`, `displayMessage/` — design examples |
| `gcm/` | `xssTester.js`, `gcmAdapterLoader.html` |
| `LNB/` | `index.html`, `skin.html`, `lnbCommunicator.js` |
| `nowidgets/` | `nowidgets.js` |
| `textwidget/` | `textwidget.js` |
| `static/` | `staticH.html`, `staticV.html`, `staticglue{H,V}.js`, `recommend.html` |
| `WQP2/` | `customGSP/{customStyle.css, config.json, customLocale.json}` |
| `replay/` | **The replay overlay** — `STD/{INT,TAB,MOB}/skin.html` + `common/{js/main.js, fonts, assets/{play,pause,fast,reload,exit,share,link,tick,clock}.png}` |
| `testing/` | placeholder |

### §9.5 Key version numbers

| Item | Version | Source |
|:--|:--|:--|
| playa-cli | 1.8.21-PLAYAUF-6314 | `package.json:3` |
| Kernel runtime | 1.4.15 (build 181) | `console/version.txt:3-4` |
| Cache buster | 1.4.15.1 | `platform/index.tpl:18,19,29` |
| pfVersion (RGSTUNNEL) | 1.4.3 | `app/launchRemote.js:8` |
| Platform meta | platform-development-1.4.2 | `app/clientConfig.js:353` |

### §9.6 Dependency footprint

| Package | Version range | Where used | Replaceable? |
|:--|:--|:--|:--:|
| express | ^4.16.4 | Everywhere | core, no |
| express-session | ^1.16.1 | `app/main.js:40`, used by recorder/proxy | core, no |
| body-parser | ^1.18.3 | `app/main.js:41-45` | replaceable with built-in express |
| cors | ^2.8.5 | `app/main.js:47-57` | replaceable with handwritten middleware |
| jsdom | ^22 | `app/clientConfig.js` only (3 calls) | drop if you don't need to scrape upstream HTML |
| boxen | ^4.0.0 | `app/main.js:107,130` (pretty boot banner) | trivially droppable |
| open | 8.0.2 | `app/main.js:18,92`, `app/launchRemote.js:31` | optional |
| yargs | ^13.2.2 | `bin/cli.js`, `bin/args.js` | replaceable with `commander` |

### §9.7 Sourcemap leakage

Every minified runtime ships its `.js.map` next to it:

| File | bytes | map | bytes |
|:--|--:|:--|--:|
| `clientservice.js` | 546519 | `clientservice.js.map` | 607642 |
| `clientservice-lite.js` | 412117 | `clientservice-lite.js.map` | 455018 |
| `consoleservice.js` | 181114 | `consoleservice.js.map` | 223830 |
| `gameservice.js` | 492144 | `gameservice.js.map` | 565962 |
| `kernel.js` | 574277 | `kernel.js.map` | 672589 |
| `kernel-lite.js` | 577348 | `kernel-lite.js.map` | 670350 |
| `adapters/evr.js` | 82958 | `evr.js.map` | 74640 |
| `adapters/isb.js` | 82582 | `isb.js.map` | 92700 |

These are full webpack source maps — every original module name is recoverable (`./platform/src/clientservice/communicator/DataAdapter.js`, etc.). For RE purposes this is gold; for production deployments it is a leakage.

---

## §10. Final mental model

The repo is best understood as a **three-layer onion**:

```
┌──────────────────────────────────────────────────────────────────┐
│  Layer 0: CLI shell (bin/cli.js, bin/args.js)                    │
│  yargs parses, validates, hands a dict to app/main.js.            │
├──────────────────────────────────────────────────────────────────┤
│  Layer 1: Express dev server (app/main.js + routers)             │
│  - Serves the game's compiled HTML+assets (/game/*)              │
│  - Serves a 50-line HTML template (platform/index.tpl) that      │
│    inlines a 450-field clientConfig as <meta>                    │
│  - Proxies or replaces the upstream RGS at /rgs/*                │
│  - Optionally records every /rgs response into a GLR folder      │
├──────────────────────────────────────────────────────────────────┤
│  Layer 2: In-browser runtime (NOT shipped here, but referenced)  │
│  - kernel.js boots, reads <meta CLIENTCONFIG>                    │
│  - clientservice.js mediates RGS calls via XHR                   │
│  - gameservice.js orchestrates wager / autospin / freespin       │
│  - consoleservice.js drives the skin overlay (pause, share, …)   │
│  - The game itself, loaded from /game/launcher.html, hooks into  │
│    the kernel via window-postMessage + igtBridge                 │
└──────────────────────────────────────────────────────────────────┘
```

The CLI's *only* moving parts are layer 0 + layer 1. Layer 2 is opaque blobs (the `platform/js/*.js` files), which playa-cli simply serves. The replay magic (GLR) lives at layer 1 and is intentionally network-level so that layer 2 — and the game inside it — sees identical bytes between recording and replay.

For SGF: the lift is to add a **layer-1-equivalent** in front of the emitted HTML, with a GLR record/replay router. SGF's emitted HTML is already its layer-2-equivalent (the kernel + game collapsed into one file). It does not need to clone the IGT layer-2 architecture.

---

*End of report. 921 lines.*
