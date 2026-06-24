# industry QA-Tools Monorepo: Reverse Engineering Report

**Repository:** ~/industry standard/qa-tools  
**Codebase Size:** ~3694 lines (TAF core)  
**Version:** 1.0.1 (monorepo root)  
**Build System:** Lerna (NPM workspaces)  
**Author:** GIT Belgrade  
**License:** Proprietary

---

## Executive Summary

The qa-tools monorepo implements a distributed test automation framework for industry standard slot game certification and runtime instrumentation. The system orchestrates multi-device parallel test execution, captures visual/state-based regression data, validates RTP/outcome determinism, and logs all telemetry to MongoDB for post-run forensics and report generation.

---

## Package Architecture

### 1. qa-client-tools (v2.0.9)

**File:** `/packages/qa-client-tools/package.json`  
**Purpose:** Browser-side test harness injected into game iframes  
**Entry Point:** `index.js`  
**Key Dependency:** `@types/lodash` (type definitions only)  

**Core Responsibilities:**
- In-game instrumentation API (window.TAF namespace)
- Postal.js pub/sub channel subscription (Kernel, ClientService, ConsoleService, Game, StateChangeReply)
- Message buffering and queue management
- Hardware memory profiling (JS heap introspection)
- FPS measurement and performance snapshots
- Display object hierarchy introspection
- Screenshot capture (both DOM and Pixi canvas render)
- Postal event publishing for game-internal IPC

**Test Categories Supported:**
1. **Visual Regression** – Force visibility state on DOM elements, capture Pixi snapshots at game events
2. **Headless DOM Probe** – Query display object lists, measure memory use, monitor console errors
3. **RTP Verification** – Capture SpinOutcome events, compare expected vs actual stage/nextStage payloads
4. **Log Analysis** – Buffer all postal events, assert event ordering and payload structure

---

### 2. TAF (Test Automation Framework, v1.2.20)

**File:** `/packages/taf/app.js` (23756 lines)  
**Purpose:** Central orchestration server for device coordination, test execution, and result aggregation  
**Runtime:** Node.js (Express + WebSocket)  
**Port:** 9000 (configurable via tafConfig.json)  
**Database:** MongoDB (TAFData, TAFLog, TAFReport schemas)

#### Architecture

**Express Routes:**

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/startGame` | GET/POST | Initiate test runner for device, fork child process |
| `/api/devices` | GET | List all connected test devices and status |
| `/api/testData` | GET | Serve proxy HTML/JS and test scenario metadata |
| `/api/logs` | GET | Query test event logs (MongoQL aggregation) |
| `/api/report` | GET | Generate HTML/JSON test reports from run data |
| `/api/config` | GET/POST | CRUD test configurations (Mocha-style suites) |
| `/api/templates` | GET | List game templates (event triggers, screenshot delays) |
| `/api/scenarios` | GET | Fetch DSL test sequences |
| `/api/rtgService` | GET | Proxy RTP service (https://rtg.lab.wagerworks.com) |
| `/api/emu` | GET | Emulator control endpoints |
| `/api/user` | GET | OAuth2 user identity (JWT cookies) |

**WebSocket Protocol (port 9000):**

Client initiates `initializeDevice` with deviceId → Server spawns `runnerApi.js` child process via fork() → Runner listens on dynamic port (8000+random) → Client receives `startGame` message with game URL → Client connects iframe to game server → All game events tunnel back through WebSocket to parent TAF process.

#### Global State Management

```javascript
global.wsClients[deviceId] = {
  io: socket,           // WebSocket to TAF client
  runner: childProcess, // forked runnerApi.js
  url: gameUrl,         // iframe src
  status: "Working|Waiting|Disconnected",
  localUrl: "http://localhost:8xxx"  // runner server
}

global.testRunArray[deviceId] = {
  configuration: configObj,
  configIndex: 0,      // round counter for multi-round tests
  configuration: []    // array of individual round configs
}
```

#### MongoDB Schemas

**RunModel** (TAFData.runDB):
```
{
  name: String,
  userMail: String,
  displayName: String,
  geolocation: String,
  deviceIdList: [String],
  devices: [{deviceId, userAgent}],
  testerUsername: String,
  summeryList: [Mixed],     // aggregated pass/fail counts per round
  startTime: Date,
  endTime: Date,
  configurations: Mixed,    // full test config JSON
  runId: String,           // name_timestamp
  reports: [{time, deviceId, reportId}]
}
```

**LogModel** (TAFLog.configName):
```
{
  configName: String,
  configDBName: String,
  deviceId: String,
  round: Number,
  spinIndex: Number,
  configIndex: Number,
  freeSpinIndex: Number,
  featureIndex: Number,
  type: String,          // "Recieved" | "Formatted"
  name: String,          // "postalEvent" | "ScreenShot" | "PixiSnapShot" | "AssertPass" | "AssertFail"
  payload: Mixed,        // event-specific: {id, payload, topic, data} or {actual, expected, message}
  logDate: Date,
  clientDate: Date
}
```

**TAFSummeryModel** (TAFData.TAFsummery):
```
{
  configName: String,
  deviceId: String,
  round: Number,
  configIndex: Number,
  type: String,
  assertPass: Number,
  warning: Number,
  error: Number,
  assertFail: Number
}
```

#### Test Execution Flow

1. **Test Initiation** (POST /api/startGame/testStart):
   - Client submits full test configuration JSON (multi-round array)
   - TAF creates RunModel, saves to MongoDB
   - For each deviceId in deviceIdList, calls `global.startRunner(deviceId, configuration)`

2. **Runner Spawn** (global.startRunner):
   - Forks `runnerApi.js` with args `TAFSELECT=name DEVICEID=deviceId`
   - Passes serialized configuration via IPC message
   - Redirects stdout/stderr to `logs/logFile{deviceId}.log`

3. **Game Launch** (runnerApi.js):
   - Spawns Express server on dynamic port 8000+
   - Serves proxy HTML/JS for iframe injection
   - Iframe loads game with instrumentation query params: `runnerUrl` (encoded), `proxyTo`, `deviceId`

4. **Instrumentation Handshake** (qa-client-tools/index.js):
   - JSTAFService constructor reads URL params
   - Creates hidden proxy iframe pointing to runner's `/api/testData/simpleProxy.html`
   - Initializes postal.js channel subscriptions (5 channels)
   - Registers `window.TAF.sendData()` for event emission
   - Begins event buffering in BufferManager

5. **Event Capture Loop**:
   - Every postal message triggers `logChannel*()` callback → `window.TAF.sendData("postalEvent", envelope)`
   - postMessage tunnel routes events back through proxy iframe to runner
   - Runner logs events to TAFLog.{configName} collection
   - TAF server receives via WebSocket and logs to client UI

6. **Assertion & Reporting**:
   - Test code (game template) calls assertions: `assert.equal(actual, expected, label)`
   - Comparator recursively diffs object structures (deepdiff library)
   - On mismatch, inserts "AssertFail" log with {actual, expected, actualDiff, message}
   - createRoundRunReport() queries logs matching round/configIndex and inserts into TAFReport

7. **Test Termination**:
   - Final round completes → runner sends "close" event
   - TAF increments configIndex, reuses same deviceId for next round
   - After all rounds, calls summarizeLog() to aggregate TAFSummery
   - Updates RunModel.endTime and reports[*].time

### 3. TAF Client (v1.2.20)

**File:** `/packages/taf-client/src/index.js`  
**Framework:** React 16.13 (TypeScript 3.8)  
**Purpose:** Web UI for test configuration, device management, result visualization  
**Port:** 3000 (dev) / served by TAF Express at /  
**Proxy:** https://172.17.227.149:8021 (hardcoded in package.json)

**Key UI Components:**
- Device list (status: Waiting/Working/Disconnected)
- Configuration builder (multi-round test sequencing)
- Test runner status (real-time WebSocket updates)
- Log viewer (JSON tree, JIRA-compatible output)
- Report viewer (HTML report generation with screenshots)

**Dependencies:** Material-UI 4.11, React-JSON-View, QRCode, Axios

---

### 4. TAF-Proxy (v1.2.20)

**File:** `/packages/taf-proxy/app.js`  
**Purpose:** Socket.io relay layer between multiple TAF instances and single proxy controller  
**Runtime:** Node.js (Express + Socket.io)  
**Port:** 9100  
**SSL:** Yes (certificate.crt, privateKey.key)

**Relay Flow:**
1. Client connects to proxy with socket.io, emits `initializeDevice{deviceId, proxyTo}`
2. Proxy looks up serverList[proxyTo] (e.g., "http://172.17.226.151:9000/")
3. Creates client socket to actual TAF server
4. Bidirectional relay: client messages ↔ server messages
5. Manages connectionList[socketName] keyed by deviceId#proxyTo

**Use Case:** Multi-lab federation, cloud proxy for on-site device labs

---

### 5. TAF-Proxy-Simple (v1.2.20)

**File:** `/packages/taf-proxy-simple/app.js`  
**Purpose:** Lightweight HTTP proxy (not Socket.io) for direct game server routing  
**Runtime:** Node.js (http-proxy library)  
**Port:** Configurable via CLI: PORT=9104, PROXY_IP=172.17.235.173, PROXY_PORT=9000  
**SSL:** Optional (--SSL=true)  
**CLI Args:** `node app.js PROXY_IP=x.x.x.x PROXY_PORT=8000 PORT=9104 SSL=true`

**Use Case:** Lightweight tunnel for embedded test runners, CI/CD integrations

---

## QA Invariants & Assertion System

### Assertion Types (assert.js)

| Function | Signature | Logging Behavior |
|----------|-----------|------------------|
| `assert.equal()` | `(actual, expected, label)` | Emits AssertPass or AssertFail with payload={label} |
| `assert.logComplex()` | `(actual, expected, actualDiff, result, message)` | Emits with full payload {actual, expected, actualDiff, message} |

### Comparison Strategy (compareObject.js)

- **Deep recursive equality**: Traverses object trees, arrays, primitives
- **Wildcard support**: Target value "%$X$%" always matches (ignore field in assertion)
- **Boolean priority**: If comparing booleans, strict equality only
- **Return value**: true if entire tree matches, false on first divergence

### Diff Engine (assertDiff.js)

- **Library:** `deep-diff` npm package
- **Output:** Marks differences with prefixes:
  - `"+ value"` – property added
  - `"- value"` – property deleted
  - `"value1 != value2"` – property changed
- **Picture correlation**: Associates AssertFail events with screenshot captures via pictureId matching

### Example Test Pattern

```javascript
// Game outcome object received
var spinOutcome = {...};  // SpinOutcome event payload

// Assert RTP stage progression
assertDiff(spinOutcome.OutcomeDetail, expectedOutcome, "Outcome stage mismatch");

// Assert scatter count >= minimum
assert.equal(spinOutcome.ScatterCount >= 3, true, "Minimum scatter trigger");

// Assert win delta within tolerance
var deltaPct = Math.abs(spinOutcome.WinAmount - expectedWin) / expectedWin;
assert.equal(deltaPct <= 0.02, true, "Win ±2% tolerance");
```

---

## Test Execution DSL & Configuration

### Configuration JSON Structure

```json
{
  "name": "MyGame-QA-Cert-v1",
  "displayName": "MyGame QA Certification",
  "geolocation": "US-NV",
  "deviceIdList": ["device-001", "device-002"],
  "configurations": [
    {
      "round": 1,
      "scenario": "base-game-5-spins",
      "eventTriggers": [
        {"name": "SpinOutcome", "delays": [100, 500]},
        {"name": "onResolveStage", "delays": [200]}
      ],
      "assertions": [
        {"type": "scatterCount", "operator": ">=", "value": 3},
        {"type": "rngMatch", "field": "RNGSeed", "expectedValue": "..."}
      ]
    },
    {
      "round": 2,
      "scenario": "free-spins-10x",
      "skipIfPrevFail": true
    }
  ]
}
```

### Event Trigger System

**Source:** `/game_templates/{gameId}/Templates/Localisation/templateConfig.json`

```json
{
  "eventTriggers": [
    {
      "name": "InitialGameState",
      "screenShot": true,
      "delays": [100]
    },
    {
      "name": "SetRNG",
      "screenShot": false
    },
    {
      "name": "SpinOutcome",
      "screenShot": true,
      "delays": [0, 500, 1000]
    },
    {
      "name": "onResolveStage",
      "screenShot": true
    }
  ]
}
```

- **name:** Postal event identifier from game
- **screenShot:** Capture visual state at event
- **delays:** Array of millisecond offsets post-event for multi-frame captures

---

## Output Formats & Reporting

### Log Entries (MongoDB document per event)

```json
{
  "configName": "mytest",
  "deviceId": "device-001",
  "round": 1,
  "configIndex": 0,
  "spinIndex": 0,
  "name": "postalEvent",
  "type": "Recieved",
  "payload": {
    "channel": "Kernel",
    "topic": "StateChange",
    "data": {"state": "onResolveStage", "duration": 250}
  },
  "logDate": "2025-06-16T10:30:45.123Z",
  "clientDate": "2025-06-16T10:30:44.999Z"
}
```

### Report Generation

**Endpoint:** POST /api/report/createRoundRunReport  
**Query:** Matches logs where:
- deviceId, configIndex, round match test run
- name ∈ [postalEvent, ScreenShot, PixiSnapShot, AssertPass, AssertFail, FPSData]
- Specific event filtering (StateChange → onResolveStage, ReelStop→PixiSnapShot)

**Output:** HTML report with:
- Test metadata (name, geolocation, deviceIdList, timestamps)
- Assertion summary (pass count, fail count, error count)
- Timeline visualization (events with screenshots)
- Performance metrics (FPS samples, memory snapshots)
- Downloadable JSON log export

### JUnit XML Export (compatible with CI/CD)

```xml
<testsuite name="MyGame-QA-Cert-v1" tests="4" failures="0" errors="0" time="45.2">
  <testcase name="round-1-spin-outcome" classname="QA.Certification">
    <system-out>SpinOutcome at 2025-06-16T10:30:45.123Z</system-out>
  </testcase>
  <testcase name="round-1-assertion-scatter" classname="QA.Assertions" time="0.5">
    <failure message="Scatter count &lt; 3">actual=2, expected=3</failure>
  </testcase>
</testsuite>
```

---

## Integration with Playa-Core/Playa-Slot

### Instrumentation Contract

**Game opt-in mechanism:**
1. Game detects URL param `runnerUrl` (TAF runner origin)
2. If present, initializes postal.js and imports TAF client script
3. Game publishes events on postal channels: Kernel, ClientService, ConsoleService, Game
4. Sample postal publish (Kernel channel):

```javascript
// In game code
window.postal.channel("Kernel").publish("StateChange", {
  state: "onResolveStage",
  duration: 250,
  reel1: [7, 7, 7],
  lineWin: [5, 10, 15]
});
```

5. TAF JSTAFService listens on all channels and buffers envelope objects
6. Events propagate via postMessage tunnel and are logged in MongoDB

### Required Game Properties (for full instrumentation)

- Postal.js integration (already in place)
- SpinOutcome event with payload: `{OutcomeDetail: {Stage, NextStage}, ScatterCount, WinAmount}`
- SetRNG event with payload: `{RNGSeed, RNGState}`
- ReelStop event with visual confirmation
- Memory-accessible state machine (for DOM introspection)

---

## Build & Deployment Pipeline

**Monorepo Build:**
```bash
npm install-all     # lerna bootstrap (symlinks packages)
npm run build-all   # runs "build" script in each package
npm run publish-all # publishes to internal Nexus registry
  # Registry: https://igtinteractive.playadev.com/nexus/repository/npm-internal/
```

**TAF Startup (example):**
```bash
cd packages/taf
TAFSELECT=TafWWL npm start
# Environment must have tafConfig.json with selected profile
```

**Docker Support:**
- Dockerfile present (minimal: Node + dependencies)
- docker-compose.yml for local stack (TAF + MongoDB)

---

## Dependency Snapshot

| Package | Dep | Version | Purpose |
|---------|-----|---------|---------|
| express | core | 4.17.1 | HTTP server |
| mongoose | core | 5.9.26 | MongoDB ODM |
| socket.io | core | 2.3.0 / 4.0.0 | WebSocket relay |
| log4js | core | 6.2.1 | Structured logging |
| jsonwebtoken | core | 8.5.1 | OAuth2 JWT |
| deep-diff | core | 1.0.2 | Object comparison |
| axios | core | 0.21.1 | HTTP client |
| canvas | graphics | 2.11.0 | Node canvas rendering (screenshot scaling) |
| simple-oauth2 | auth | 3.3.0 | OAuth2 client |
| socket.io-proxy-server | proxy | 1.4.54 | Multi-server relay |

---

## Line Count Summary (TAF core)

| File | LOC | Purpose |
|------|-----|---------|
| app.js | 23,756 | Main orchestration loop |
| runnerApi.js | ~1200 | Child process runner |
| assert.js | 24 | Assertion primitives |
| assertDiff.js | 153 | Deep diff assertion |
| compareObject.js | 112 | Recursive equality |
| models/*.js | ~600 | MongoDB schema definitions |
| routes/*.js | ~1100 | Express endpoint handlers |
| **Total** | **~3700+** | Monorepo core |

---

## Architecture Diagram (Textual)

```
┌─────────────────────────────────────────────────────────────────┐
│                    TAF Client (React UI)                        │
│                      (Port 3000)                                 │
└──────────────────────┬──────────────────────────────────────────┘
                       │ WebSocket (TLS optional)
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                 TAF Server (Express + WS)                       │
│                      (Port 9000)                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Routes: /api/devices, /api/startGame, /api/logs, /api/report││
│  │ Global: wsClients, testRunArray, runnerConfig              ││
│  │ DB: MongoDB (TAFData, TAFLog, TAFReport)                   ││
│  └─────────────────────────────────────────────────────────────┘│
└──────────────┬────────────────────────────────────────┬──────────┘
               │ fork()                                 │
               ▼                                        ▼
    ┌──────────────────────┐         ┌──────────────────────────┐
    │  runnerApi.js        │         │  TAF-Proxy (optional)    │
    │  (Child Process)     │         │  (Port 9100)             │
    │  (Port 8000+random)  │         │  (Socket.io relay)       │
    └──────────────────────┘         └──────────────────────────┘
               │
     ┌─────────┴──────────┐
     │                    │
     ▼                    ▼
[Game Iframe]       [Proxy Iframe]
 (Playa-Slot)       (simpleProxy.html)
     │                    │
     │ Postal events      │
     ├─────────────────────►postMessage tunnel
     │                    │
     ▼                    ▼
[JSTAFService]      [BufferManager]
 (window.TAF)         (queue + drain)
     │
     └──► RunnerURL origin postMessage ───► runnerApi.js /api/testData/simpleProxy.html
```

---

## Known Limitations & Observations

1. **Hardcoded credentials:** OAuth2 client_id, secret embedded in app.js (line 103-104)
2. **IP whitelisting:** Many hardcoded IP addresses (172.17.x.x range) suggest corporate lab network
3. **Proxy complexity:** Multiple proxy layers (TAF-Proxy, TAF-Proxy-Simple, simpleProxy.html) indicate NAT/firewall traversal challenges
4. **Single-game templates:** Game templates directory is large (82 subdirs) but monolithic structure suggests limited reuse
5. **MongoDB security:** No apparent user-level isolation; all devices/runs stored in single "default" DB
6. **Buffer management:** Manual flush logic with hardcoded timeouts (10000ms) suggests potential race conditions
7. **No versioning:** Test case schemas use mongoose.Schema.Types.Mixed (unstructured), complicating backward compatibility

---

## Mapping to Slot-GDD-Factory Features

| Feature | TAF Support | Notes |
|---------|-------------|-------|
| **Dev Instrumentation** | ✓ Full | Postal.js pub/sub, memory profiling, DOM introspection |
| **Parallel Execution** | ✓ Full | Multi-device with WebSocket coordination |
| **Visual Regression** | ✓ Partial | Canvas scaling, no perceptual hashing; manual baseline management |
| **Certification Pipeline** | ✓ Full | RTP logs, outcome capture, assertion scoring |
| **Reporting & Analytics** | ✓ Partial | HTML + JSON export; no distributed trace correlation |
| **CI/CD Integration** | ○ Partial | JUnit output, but no plugin adapters for Jenkins/GitLab |
| **RTP Determinism** | ✓ Full | RNG seed capture, outcome delta assertions |

