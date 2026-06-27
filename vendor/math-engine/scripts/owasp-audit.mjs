#!/usr/bin/env node
/**
 * CORTI W205-SECURITY — OWASP Top 10 (2021) static audit.
 *
 * Scans the backend, mini-apps, and SDK for control coverage against the
 * OWASP Top 10 categories. Emits a per-category findings list (Critical /
 * High / Medium / Low / Info), a JSON dump under reports/security/, and a
 * human-readable Markdown summary.
 *
 * Usage:
 *   node scripts/owasp-audit.mjs           # run full audit
 *   node scripts/owasp-audit.mjs --json    # JSON-only output to stdout
 *
 * Exit code:
 *   0 = no Critical findings
 *   1 = at least one Critical finding (CI gate fails)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

export const SEVERITY = ['Critical', 'High', 'Medium', 'Low', 'Info'];

export const OWASP_CATEGORIES = [
  { id: 'A01', name: 'Broken Access Control' },
  { id: 'A02', name: 'Cryptographic Failures' },
  { id: 'A03', name: 'Injection' },
  { id: 'A04', name: 'Insecure Design' },
  { id: 'A05', name: 'Security Misconfiguration' },
  { id: 'A06', name: 'Vulnerable & Outdated Components' },
  { id: 'A07', name: 'Identification & Authentication Failures' },
  { id: 'A08', name: 'Software & Data Integrity Failures' },
  { id: 'A09', name: 'Security Logging & Monitoring Failures' },
  { id: 'A10', name: 'Server-Side Request Forgery' },
];

export function emptyCategoryFindings() {
  const obj = {};
  for (const c of OWASP_CATEGORIES) {
    obj[c.id] = { name: c.name, findings: [] };
  }
  return obj;
}

/** List source files under a root, skipping node_modules / dist / target. */
export function listSourceFiles(root, exts = ['.ts', '.mjs', '.js', '.tsx']) {
  const out = [];
  const SKIP = new Set([
    'node_modules', 'dist', 'target', 'out', '.git', 'coverage',
    'reports', 'rust-sim', '{tests}', '.cache', '.tmp',
  ]);
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (SKIP.has(name) || name.startsWith('.')) continue;
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else if (st.isFile() && exts.includes(extname(name))) out.push(full);
    }
  };
  walk(root);
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// A01 — Broken Access Control
// ─────────────────────────────────────────────────────────────────────
export function auditA01BrokenAccessControl(routesDir) {
  const findings = [];
  if (!existsSync(routesDir)) {
    findings.push({
      severity: 'Info', id: 'a01-no-routes-dir',
      message: `routes directory not found: ${routesDir}`,
    });
    return findings;
  }
  const files = readdirSync(routesDir).filter((f) => f.endsWith('.ts'));
  for (const f of files) {
    const path = join(routesDir, f);
    const src = readFileSync(path, 'utf8');
    // GaaS API-key gate
    if (f === 'gaas.ts') {
      if (!/checkApiKey/.test(src)) {
        findings.push({
          severity: 'Critical', id: 'a01-gaas-no-apikey-check',
          file: relative(ROOT, path),
          message: 'GaaS routes missing checkApiKey enforcement.',
        });
      }
    }
    // Admin tenant-CRUD intentionally open per code comments; flag as Medium
    // for production deploys to install operator auth in front of it.
    if (f === 'admin.ts') {
      if (!/preHandler/.test(src) || !/X-Tenant-Id|x-tenant-id/i.test(src + readFileSync(join(routesDir, '..', 'state', 'tenants.ts'), 'utf8'))) {
        findings.push({
          severity: 'High', id: 'a01-admin-no-tenant-resolve',
          file: relative(ROOT, path),
          message: 'Admin routes do not enforce tenant-resolution preHandler.',
        });
      } else {
        findings.push({
          severity: 'Medium', id: 'a01-admin-routes-open',
          file: relative(ROOT, path),
          message: 'Admin tenant CRUD is intentionally open (no operator JWT). Wrap behind operator auth in production.',
          remediation: 'Add JWT/OIDC admin scope check; deny if missing.',
        });
      }
    }
    // Session+wallet routes: rely on X-Tenant-Id; flag if any session route
    // explicitly bypasses preHandler hooks via custom config.
    if (/onRequest:\s*false/.test(src) || /preHandler:\s*\[\]/.test(src)) {
      findings.push({
        severity: 'High', id: 'a01-explicit-auth-bypass',
        file: relative(ROOT, path),
        message: 'Route explicitly disables preHandler/onRequest hooks.',
      });
    }
  }
  // Cross-check: per-tenant resolution covers data plane
  const adminSrc = existsSync(join(routesDir, 'admin.ts'))
    ? readFileSync(join(routesDir, 'admin.ts'), 'utf8') : '';
  if (!/req\.url\.startsWith\('\/api\/admin\/'\)/.test(adminSrc)) {
    findings.push({
      severity: 'Medium', id: 'a01-tenant-scope-fragile',
      file: 'server/routes/admin.ts',
      message: 'Tenant-resolution preHandler path-prefix check is fragile; consider per-route hook.',
    });
  }
  // Role-based access (admin vs operator vs regulator). W206 introduces
  // server/state/rbac.ts + per-route requireRole/requirePermission
  // guards. If those are missing, surface High; if present, surface Info.
  const rbacFile = join(routesDir, '..', 'state', 'rbac.ts');
  const hasRbacModule = existsSync(rbacFile);
  let rbacRoleEnumPresent = false;
  let rbacGuardCalls = 0;
  if (hasRbacModule) {
    const src = readFileSync(rbacFile, 'utf8');
    rbacRoleEnumPresent = /export type Role\b/.test(src) && /requireRole|requirePermission/.test(src);
    for (const f of readdirSync(routesDir)) {
      if (!f.endsWith('.ts')) continue;
      const s = readFileSync(join(routesDir, f), 'utf8');
      const m = s.match(/requireRole\s*\(|requirePermission\s*\(/g);
      if (m) rbacGuardCalls += m.length;
    }
  }
  if (!hasRbacModule || !rbacRoleEnumPresent || rbacGuardCalls < 3) {
    findings.push({
      severity: 'High', id: 'a01-no-rbac',
      message: 'No role-based access control (RBAC) implemented for admin/operator/regulator separation.',
      remediation: 'Introduce roles in TenantStore + per-route scope check.',
    });
  } else {
    findings.push({
      severity: 'Info', id: 'a01-rbac-enforced',
      file: 'server/state/rbac.ts',
      message: `RBAC enforced — Role enum + ${rbacGuardCalls} requireRole/requirePermission guard sites across routes.`,
    });
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────
// A02 — Cryptographic Failures
// ─────────────────────────────────────────────────────────────────────
export function auditA02CryptographicFailures(opts) {
  const findings = [];
  const hsmPath = opts.hsmFile ?? join(ROOT, 'server/state/hsm.ts');
  if (existsSync(hsmPath)) {
    const src = readFileSync(hsmPath, 'utf8');
    if (!/@noble\/ed25519/.test(src)) {
      findings.push({
        severity: 'Critical', id: 'a02-hsm-no-noble-ed25519',
        file: relative(ROOT, hsmPath),
        message: 'HSM module does not use @noble/ed25519 — possible custom crypto.',
      });
    }
    if (!/sha512/.test(src) && !/sha256/.test(src)) {
      findings.push({
        severity: 'Medium', id: 'a02-hsm-no-hashing',
        file: relative(ROOT, hsmPath),
        message: 'HSM module does not import a vetted hash primitive.',
      });
    }
    if (!/mode: 0o600/.test(src)) {
      findings.push({
        severity: 'High', id: 'a02-hsm-key-perms',
        file: relative(ROOT, hsmPath),
        message: 'HSM persisted key file not chmodded to 0o600.',
      });
    }
  } else {
    findings.push({
      severity: 'Info', id: 'a02-hsm-missing',
      message: 'No HSM module found.',
    });
  }
  // TLS enforcement
  const nginxConf = join(ROOT, 'docker/nginx-spa.conf');
  if (existsSync(nginxConf)) {
    const src = readFileSync(nginxConf, 'utf8');
    if (!/listen\s+443|ssl_certificate/.test(src)) {
      findings.push({
        severity: 'High', id: 'a02-nginx-no-tls',
        file: relative(ROOT, nginxConf),
        message: 'Nginx config does not enforce TLS (listen 443 / ssl_certificate). Terminate TLS at load balancer or add cert config.',
        remediation: 'Use cloud LB with managed TLS or add ssl_certificate directives.',
      });
    }
  }
  // Hardcoded secrets
  const tracked = [
    ...listSourceFiles(join(ROOT, 'server')),
    ...listSourceFiles(join(ROOT, 'sdk')),
    ...listSourceFiles(join(ROOT, 'src')),
  ];
  const SECRET_RE = [
    { re: /AKIA[0-9A-Z]{16}/, name: 'aws-access-key' },
    { re: /ghp_[A-Za-z0-9]{36}/, name: 'github-token' },
    { re: /github_pat_[A-Za-z0-9_]{50,}/, name: 'github-pat' },
    { re: /sk-[A-Za-z0-9]{32,}/, name: 'openai-key' },
    { re: /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/, name: 'pem-private-key' },
  ];
  for (const f of tracked) {
    let src; try { src = readFileSync(f, 'utf8'); } catch { continue; }
    for (const { re, name } of SECRET_RE) {
      if (re.test(src)) {
        findings.push({
          severity: 'Critical', id: `a02-hardcoded-${name}`,
          file: relative(ROOT, f),
          message: `Possible hardcoded ${name} detected.`,
        });
      }
    }
  }
  if (findings.length === 0) {
    findings.push({
      severity: 'Info', id: 'a02-clean',
      message: 'No A02 findings — HSM uses noble/ed25519, TLS enforced in nginx, no hardcoded secrets.',
    });
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────
// A03 — Injection
// ─────────────────────────────────────────────────────────────────────
export function auditA03Injection(opts) {
  const findings = [];
  const sourceFiles = [
    ...listSourceFiles(join(ROOT, 'server')),
    ...listSourceFiles(join(ROOT, 'sdk')),
    ...listSourceFiles(join(ROOT, 'web/studio/src'), ['.ts', '.tsx', '.js']),
  ];
  for (const f of sourceFiles) {
    let src; try { src = readFileSync(f, 'utf8'); } catch { continue; }
    // Strip comment lines and block comments to avoid false positives in
    // doc strings (e.g. "Safe evaluator with NO use of `eval()`").
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*|#)/.test(l))
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');
    if (/\beval\s*\(/.test(stripped) && !/eslint-disable.*no-eval/.test(stripped)) {
      findings.push({
        severity: 'Critical', id: 'a03-eval-call',
        file: relative(ROOT, f),
        message: 'Direct eval() call.',
      });
    }
    if (/new\s+Function\s*\(/.test(stripped)) {
      findings.push({
        severity: 'High', id: 'a03-new-function',
        file: relative(ROOT, f),
        message: 'Dynamic Function() constructor invocation.',
      });
    }
    // Shell exec
    if (/child_process[\s\S]*?\.exec\s*\([^)]*\$\{|exec\s*\(\s*`[^`]*\$\{/.test(stripped)) {
      findings.push({
        severity: 'High', id: 'a03-shell-injection',
        file: relative(ROOT, f),
        message: 'child_process.exec called with template-string interpolation.',
      });
    }
    // SQL string concat (forward-looking — engine is in-memory but future Postgres ready)
    if (/db\.query\s*\(\s*[`'"][^`'"]*\$\{|knex\.raw\s*\(\s*[`'"][^`'"]*\$\{/.test(stripped)) {
      findings.push({
        severity: 'Critical', id: 'a03-sql-string-concat',
        file: relative(ROOT, f),
        message: 'Possible SQL injection via string interpolation.',
      });
    }
    // XSS: innerHTML with untrusted input
    if (/\.innerHTML\s*=\s*[^'"`;]+\b(req|input|body|searchParams|params)\.(?!nodeName)/.test(stripped)) {
      findings.push({
        severity: 'High', id: 'a03-innerhtml-untrusted',
        file: relative(ROOT, f),
        message: 'innerHTML assigned from request-derived value.',
      });
    }
  }
  if (findings.length === 0) {
    findings.push({
      severity: 'Info', id: 'a03-clean',
      message: 'No injection sinks detected (eval/Function/innerHTML/exec).',
    });
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────
// A04 — Insecure Design
// ─────────────────────────────────────────────────────────────────────
export function auditA04InsecureDesign(opts) {
  const findings = [];
  const wallet = join(ROOT, 'server/state/wallet.ts');
  if (existsSync(wallet)) {
    const src = readFileSync(wallet, 'utf8');
    if (!/amountMinor\s*<=\s*0/.test(src)) {
      findings.push({
        severity: 'Critical', id: 'a04-wallet-no-negative-guard',
        file: relative(ROOT, wallet),
        message: 'Wallet does not guard against negative/zero amounts.',
      });
    }
    if (!/Number\.isFinite/.test(src)) {
      findings.push({
        severity: 'High', id: 'a04-wallet-no-finite-guard',
        file: relative(ROOT, wallet),
        message: 'Wallet does not validate Number.isFinite on amounts (NaN/Infinity bypass).',
      });
    }
    if (!/MAX_DEPOSIT_MINOR|amountMinor\s*>\s*[\d_]+/.test(src)) {
      findings.push({
        severity: 'Medium', id: 'a04-wallet-no-ceiling',
        file: relative(ROOT, wallet),
        message: 'No deposit ceiling — overflow / AML risk.',
      });
    }
  }
  // Session fixation: session IDs derived from Date.now+counter — predictable
  const sessions = join(ROOT, 'server/state/sessions.ts');
  if (existsSync(sessions)) {
    const src = readFileSync(sessions, 'utf8');
    if (/Date\.now\(\)\.toString\(36\)/.test(src) && !/crypto\.randomBytes|getRandomValues/.test(src)) {
      findings.push({
        severity: 'High', id: 'a04-session-id-predictable',
        file: relative(ROOT, sessions),
        message: 'Session IDs derived from Date.now() + counter; predictable. Use crypto.randomBytes(16).',
        remediation: 'Replace newSessionId() with crypto.randomBytes(16).toString("hex").',
      });
    }
  }
  // Race conditions in wager/credit — single-threaded Node so flagged Low/Info
  findings.push({
    severity: 'Low', id: 'a04-wallet-race-single-threaded',
    file: 'server/state/wallet.ts',
    message: 'Wallet operations rely on Node single-threaded execution. Add row-level lock when moving to Postgres.',
  });
  return findings;
}

// ─────────────────────────────────────────────────────────────────────
// A05 — Security Misconfiguration
// ─────────────────────────────────────────────────────────────────────
export function auditA05Misconfiguration(opts) {
  const findings = [];
  const indexTs = join(ROOT, 'server/index.ts');
  if (existsSync(indexTs)) {
    const raw = readFileSync(indexTs, 'utf8');
    // Strip comments to avoid matching documentation strings.
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*|#)/.test(l))
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');
    if (/origin:\s*true\b(?!\s*\?)/.test(src) && !/CORS_ALLOWED_ORIGINS/.test(src)) {
      findings.push({
        severity: 'High', id: 'a05-cors-wildcard',
        file: relative(ROOT, indexTs),
        message: 'CORS configured with origin:true — accepts any Origin.',
        remediation: 'Set explicit allow-list, e.g. origin: process.env.CORS_ALLOW.split(",").',
      });
    }
    // The unsafe combination is `origin:true` AND unconditional `credentials:true`.
    // After W205 hardening this is gated on a non-empty CORS_ALLOWED_ORIGINS list.
    if (/credentials:\s*true\b/.test(src) && /origin:\s*true\b(?!\s*\?)/.test(src)
        && !/CORS_ALLOWED_ORIGINS/.test(src)) {
      findings.push({
        severity: 'Critical', id: 'a05-cors-credentials-wildcard',
        file: relative(ROOT, indexTs),
        message: 'CORS credentials:true combined with origin:true — credential leak risk.',
      });
    }
  }
  // Security headers (CSP, X-Frame-Options, HSTS) — look for helmet or manual headers
  const allRoutes = listSourceFiles(join(ROOT, 'server'));
  let helmetSeen = false;
  let cspSeen = false;
  for (const f of allRoutes) {
    const src = readFileSync(f, 'utf8');
    if (/@fastify\/helmet|require\('helmet'\)/.test(src)) helmetSeen = true;
    if (/Content-Security-Policy/i.test(src)) cspSeen = true;
  }
  if (!helmetSeen && !cspSeen) {
    findings.push({
      severity: 'High', id: 'a05-no-security-headers',
      message: 'No @fastify/helmet or manual CSP/X-Frame-Options/HSTS headers detected.',
      remediation: 'Install @fastify/helmet and register before routes.',
    });
  }
  // Verbose error messages
  for (const f of allRoutes) {
    const src = readFileSync(f, 'utf8');
    if (/err\.stack/.test(src) && !/process\.env\.NODE_ENV/.test(src)) {
      findings.push({
        severity: 'Medium', id: 'a05-stack-traces-leak',
        file: relative(ROOT, f),
        message: 'Stack trace returned to clients without NODE_ENV guard.',
      });
    }
  }
  // Cookie security — look for setCookie calls
  for (const f of allRoutes) {
    const src = readFileSync(f, 'utf8');
    if (/setCookie\(|set-cookie/i.test(src) && !/httpOnly:\s*true/.test(src)) {
      findings.push({
        severity: 'High', id: 'a05-cookie-no-httponly',
        file: relative(ROOT, f),
        message: 'Cookie set without httpOnly flag.',
      });
    }
  }
  // Default credentials — check for hardcoded admin/password
  const tracked = [
    ...listSourceFiles(join(ROOT, 'server')),
    ...listSourceFiles(join(ROOT, 'docker'), ['.conf', '.yml']),
  ];
  for (const f of tracked) {
    let src; try { src = readFileSync(f, 'utf8'); } catch { continue; }
    if (/(password|passwd)\s*=\s*['"](admin|password|123|root)['"]/.test(src)) {
      findings.push({
        severity: 'Critical', id: 'a05-default-credentials',
        file: relative(ROOT, f),
        message: 'Hardcoded default credentials found.',
      });
    }
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────
// A06 — Vulnerable Components (delegated to scripts/dependency-scan.mjs)
// ─────────────────────────────────────────────────────────────────────
export function auditA06VulnerableComponents() {
  const findings = [];
  const lock = join(ROOT, 'package-lock.json');
  if (!existsSync(lock)) {
    findings.push({
      severity: 'High', id: 'a06-no-lockfile',
      message: 'No package-lock.json — reproducible builds at risk.',
    });
  } else {
    findings.push({
      severity: 'Info', id: 'a06-lockfile-present',
      file: 'package-lock.json',
      message: 'Lockfile present.',
    });
  }
  findings.push({
    severity: 'Info', id: 'a06-delegated',
    message: 'Detailed CVE list owned by scripts/dependency-scan.mjs — see reports/security/DEPENDENCIES_*.json.',
  });
  return findings;
}

// ─────────────────────────────────────────────────────────────────────
// A07 — Authentication Failures
// ─────────────────────────────────────────────────────────────────────
export function auditA07AuthenticationFailures() {
  const findings = [];
  const tenants = join(ROOT, 'server/state/tenants.ts');
  if (existsSync(tenants)) {
    const src = readFileSync(tenants, 'utf8');
    if (/consumeRateBudget|rateLimits/.test(src)) {
      findings.push({
        severity: 'Info', id: 'a07-rate-limit-present',
        file: relative(ROOT, tenants),
        message: 'Per-tenant rate limit implemented.',
      });
    } else {
      findings.push({
        severity: 'High', id: 'a07-no-rate-limit',
        file: relative(ROOT, tenants),
        message: 'No rate limiting against brute-force on auth endpoints.',
      });
    }
  }
  // API key entropy — surface GAAS_API_KEYS guidance
  findings.push({
    severity: 'Medium', id: 'a07-apikey-entropy-policy',
    message: 'GAAS_API_KEYS comes from env-var split on comma; no length/entropy validation. Document policy: ≥ 32 random bytes, base64.',
  });
  findings.push({
    severity: 'Medium', id: 'a07-no-mfa',
    message: 'No MFA implemented for admin/operator portals (placeholder).',
  });
  return findings;
}

// ─────────────────────────────────────────────────────────────────────
// A08 — Software & Data Integrity
// ─────────────────────────────────────────────────────────────────────
export function auditA08IntegrityFailures() {
  const findings = [];
  if (existsSync(join(ROOT, 'package-lock.json'))) {
    findings.push({
      severity: 'Info', id: 'a08-lockfile',
      message: 'package-lock.json present (deterministic installs).',
    });
  }
  const auditTs = join(ROOT, 'server/state/audit.ts');
  if (existsSync(auditTs)) {
    const src = readFileSync(auditTs, 'utf8');
    if (/verifyChain|sealEntry/.test(src)) {
      findings.push({
        severity: 'Info', id: 'a08-hash-chain',
        file: relative(ROOT, auditTs),
        message: 'Audit log uses hash-chain (sealEntry + verifyChain).',
      });
    } else {
      findings.push({
        severity: 'High', id: 'a08-no-hash-chain',
        file: relative(ROOT, auditTs),
        message: 'Audit log missing hash-chain integrity.',
      });
    }
  }
  // Signed releases placeholder
  findings.push({
    severity: 'Medium', id: 'a08-no-signed-releases',
    message: 'GitHub Release artifacts not signed (cosign/Sigstore). Add to release workflow.',
  });
  // SRI for CDN
  findings.push({
    severity: 'Low', id: 'a08-no-sri',
    message: 'No third-party CDN scripts in use; if added, require Subresource Integrity (integrity=).',
  });
  return findings;
}

// ─────────────────────────────────────────────────────────────────────
// A09 — Logging & Monitoring Failures
// ─────────────────────────────────────────────────────────────────────
export function auditA09LoggingMonitoring() {
  const findings = [];
  const indexTs = join(ROOT, 'server/index.ts');
  if (existsSync(indexTs)) {
    const src = readFileSync(indexTs, 'utf8');
    if (/logger:\s*true/.test(src) || /logger:\s*\{/.test(src)) {
      findings.push({
        severity: 'Info', id: 'a09-logger-enabled',
        message: 'Fastify logger enabled in main bootstrap.',
      });
    }
  }
  const auditTs = join(ROOT, 'server/state/audit.ts');
  if (existsSync(auditTs)) {
    findings.push({
      severity: 'Info', id: 'a09-audit-store',
      message: 'AuditStore append-only with hash chain.',
    });
  }
  findings.push({
    severity: 'Medium', id: 'a09-no-centralized-logging',
    message: 'No centralized log shipping (ELK / CloudWatch / Datadog). Configure in deployment.',
  });
  findings.push({
    severity: 'Medium', id: 'a09-no-alerting',
    message: 'No alerting on anomalies (failed auth bursts, RTP drift). Wire Prometheus → Alertmanager.',
  });
  // Health/metrics check
  const health = join(ROOT, 'server/routes/health.ts');
  if (existsSync(health)) {
    const src = readFileSync(health, 'utf8');
    if (/\/api\/metrics/.test(src)) {
      findings.push({
        severity: 'Info', id: 'a09-prometheus-metrics',
        message: 'Prometheus /api/metrics endpoint exposed.',
      });
    }
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────
// A10 — Server-Side Request Forgery
// ─────────────────────────────────────────────────────────────────────
export function auditA10SSRF() {
  const findings = [];
  const tracked = listSourceFiles(join(ROOT, 'server'));
  for (const f of tracked) {
    const src = readFileSync(f, 'utf8');
    // Look for unvalidated fetch/http.request/axios with request-derived URL
    if (/fetch\s*\(\s*(req\.|body\.|params\.|query\.|input\.)/.test(src)) {
      findings.push({
        severity: 'High', id: 'a10-ssrf-fetch',
        file: relative(ROOT, f),
        message: 'fetch() called with request-derived URL — SSRF risk.',
      });
    }
    if (/http\.request\s*\(\s*(req\.|body\.|params\.)/.test(src)) {
      findings.push({
        severity: 'High', id: 'a10-ssrf-http',
        file: relative(ROOT, f),
        message: 'http.request called with request-derived URL.',
      });
    }
  }
  if (findings.length === 0) {
    findings.push({
      severity: 'Info', id: 'a10-clean',
      message: 'No external URL fetch detected from request-derived input.',
    });
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────
export function runAudit() {
  const categories = emptyCategoryFindings();
  categories.A01.findings = auditA01BrokenAccessControl(join(ROOT, 'server/routes'));
  categories.A02.findings = auditA02CryptographicFailures({});
  categories.A03.findings = auditA03Injection({});
  categories.A04.findings = auditA04InsecureDesign({});
  categories.A05.findings = auditA05Misconfiguration({});
  categories.A06.findings = auditA06VulnerableComponents();
  categories.A07.findings = auditA07AuthenticationFailures();
  categories.A08.findings = auditA08IntegrityFailures();
  categories.A09.findings = auditA09LoggingMonitoring();
  categories.A10.findings = auditA10SSRF();
  // Aggregate counts
  const counts = { Critical: 0, High: 0, Medium: 0, Low: 0, Info: 0 };
  for (const c of Object.values(categories)) {
    for (const f of c.findings) {
      if (counts[f.severity] !== undefined) counts[f.severity]++;
    }
  }
  return { categories, counts };
}

export function countBySeverity(categories) {
  const counts = { Critical: 0, High: 0, Medium: 0, Low: 0, Info: 0 };
  for (const c of Object.values(categories)) {
    for (const f of c.findings) {
      if (counts[f.severity] !== undefined) counts[f.severity]++;
    }
  }
  return counts;
}

export function renderMarkdown(result, date) {
  const lines = [];
  lines.push(`# OWASP Top 10 (2021) Audit — ${date}`);
  lines.push('');
  lines.push(`**Counts:** Critical=${result.counts.Critical} High=${result.counts.High} Medium=${result.counts.Medium} Low=${result.counts.Low} Info=${result.counts.Info}`);
  lines.push('');
  for (const cat of OWASP_CATEGORIES) {
    const block = result.categories[cat.id];
    lines.push(`## ${cat.id} — ${cat.name}`);
    if (block.findings.length === 0) {
      lines.push('- No findings.');
    } else {
      for (const f of block.findings) {
        lines.push(`- **[${f.severity}]** \`${f.id}\` ${f.file ? `(${f.file}) ` : ''}— ${f.message}`);
        if (f.remediation) lines.push(`  - *Remediation:* ${f.remediation}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function main() {
  const result = runAudit();
  const date = todayIso();
  const dir = join(ROOT, 'reports/security');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `OWASP_TOP_10_${date}.json`),
    JSON.stringify({ date, ...result }, null, 2)
  );
  writeFileSync(
    join(dir, `OWASP_TOP_10_${date}.md`),
    renderMarkdown(result, date)
  );
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ date, ...result }, null, 2) + '\n');
  } else {
    // eslint-disable-next-line no-console
    console.log(`[owasp-audit] ${date} → Critical=${result.counts.Critical} High=${result.counts.High} Medium=${result.counts.Medium} Low=${result.counts.Low}`);
    // eslint-disable-next-line no-console
    console.log(`  reports/security/OWASP_TOP_10_${date}.{json,md}`);
  }
  if (result.counts.Critical > 0) process.exit(1);
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('owasp-audit.mjs');
if (isMain) main();
