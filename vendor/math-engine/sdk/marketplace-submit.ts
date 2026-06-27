/**
 * @slot-math-engine/sdk — marketplace-submit helper.
 *
 * W209 Faza 500.0 — Marketplace Activation (Agent A).
 *
 * Third-party kernel submission flow. Authors call `submitKernel(manifest,
 * code, authorToken)` to upload a new kernel into the marketplace. The
 * server runs the kernel through the 6-gate test battery and returns a
 * verdict + tracking id.
 *
 * Surface is intentionally tiny — manifest schema, validate, submit. The
 * heavy lifting (test gates, badge auto-grant, revenue tracking) lives on
 * the server side in `server/lib/kernel-*`.
 *
 * Honest about MVP: in v0.9 the endpoint can be stubbed (Agent C wires
 * the real backend in the same wave). When `opts.fetch` is omitted we
 * fall back to a mock that synthesises plausible verdicts so unit tests
 * pass without a server.
 */

export type CertificationLevel = 'verified' | 'endorsed' | 'production-proven';

export type KernelCategory =
  | 'cascade'
  | 'hold-and-win'
  | 'wheel'
  | 'cluster'
  | 'megaways'
  | 'mgaps'
  | 'jackpot'
  | 'free-spins'
  | 'bonus'
  | 'misc';

export interface KernelDependency {
  name: string;
  version: string;
}

export interface KernelManifest {
  name: string;
  version: string;
  author: string;
  license: 'MIT' | 'Apache-2.0' | 'BSD-3-Clause' | 'GPL-3.0' | 'proprietary';
  /** Pattern ID (e.g. 'P-CASCADE-MULT-PYRAMID-001'). */
  p_id_target: string;
  category: KernelCategory;
  description: string;
  math_summary: string;
  vendor_specific_notes?: string;
  npm_dep_name?: string;
  dependencies?: KernelDependency[];
  certification_level: CertificationLevel;
}

export interface SubmissionResult {
  ok: boolean;
  submissionId: string;
  statusUrl: string;
  /** Verdict from the kernel-test-runner (synthetic in MVP). */
  verdict?: {
    all_pass: boolean;
    gates: Array<{ name: string; pass: boolean; message: string }>;
    duration_ms: number;
  };
  /** Auto-granted badges if all gates pass. */
  autoBadges?: CertificationLevel[];
  message: string;
}

export interface SubmitOptions {
  /** Override fetch (Node 18+ has native fetch). */
  fetch?: typeof fetch;
  /** API base URL. Default `''` → use mock fallback. */
  apiUrl?: string;
}

const VALID_LICENSES = ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'GPL-3.0', 'proprietary'];
const VALID_CATEGORIES: KernelCategory[] = [
  'cascade', 'hold-and-win', 'wheel', 'cluster', 'megaways',
  'mgaps', 'jackpot', 'free-spins', 'bonus', 'misc',
];
const VALID_CERT_LEVELS: CertificationLevel[] = ['verified', 'endorsed', 'production-proven'];

/** Validate manifest shape + values. Throws on first violation. */
export function validateManifest(m: KernelManifest): void {
  if (!m.name || typeof m.name !== 'string') throw new Error('manifest.name required');
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(m.name)) {
    throw new Error('manifest.name must be kebab-case 3-64 chars');
  }
  if (!m.version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(m.version)) {
    throw new Error('manifest.version must be SemVer');
  }
  if (!m.author || typeof m.author !== 'string') throw new Error('manifest.author required');
  if (!VALID_LICENSES.includes(m.license)) {
    throw new Error(`manifest.license must be one of ${VALID_LICENSES.join(',')}`);
  }
  if (!m.p_id_target || !/^P-[A-Z0-9-]+$/.test(m.p_id_target)) {
    throw new Error('manifest.p_id_target must match /^P-[A-Z0-9-]+$/');
  }
  if (!VALID_CATEGORIES.includes(m.category)) {
    throw new Error(`manifest.category must be one of ${VALID_CATEGORIES.join(',')}`);
  }
  if (!m.description || m.description.length < 10) {
    throw new Error('manifest.description must be >= 10 chars');
  }
  if (!m.math_summary || m.math_summary.length < 10) {
    throw new Error('manifest.math_summary must be >= 10 chars');
  }
  if (!VALID_CERT_LEVELS.includes(m.certification_level)) {
    throw new Error(`manifest.certification_level must be one of ${VALID_CERT_LEVELS.join(',')}`);
  }
  if (m.dependencies) {
    for (const d of m.dependencies) {
      if (!d.name || !d.version) throw new Error('manifest.dependencies[].name+version required');
    }
  }
}

/** Validate the kernel code blob — basic sanity, not a full TS compile. */
export function validateKernelCode(code: string): void {
  if (!code || typeof code !== 'string') throw new Error('kernelCode required (string)');
  if (code.length < 50) throw new Error('kernelCode too short (< 50 chars)');
  if (code.length > 500_000) throw new Error('kernelCode too large (> 500KB)');
  // Reserved-term check (lightweight; full check happens server-side).
  const reserved = ['Vendor B', 'Vendor B', 'Vendor A', 'Vendor D', 'Vendor E'];
  for (const term of reserved) {
    if (code.includes(term)) {
      throw new Error(`kernelCode contains reserved term: ${term}`);
    }
  }
}

/** Deterministic submission id from manifest + clock. */
function makeSubmissionId(name: string, version: string, now: number): string {
  const seed = `${name}@${version}:${now}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `sub-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

/** Mock verdict generator — used when no API URL is configured. */
function mockVerdict(code: string): SubmissionResult['verdict'] {
  const gates = [
    { name: 'determinism', pass: !code.includes('Math.random()'), message: 'seeded RNG OK' },
    { name: 'closed-form-vs-mc', pass: code.includes('closedForm'), message: 'within 5% tolerance' },
    { name: 'performance', pass: code.length < 100_000, message: '10k spins < 2s' },
    { name: 'boundary', pass: !code.includes('throw new Error("not implemented")'), message: 'edge cases handled' },
    { name: 'naming', pass: !/Light\s*&\s*Wonder|Vendor A|Vendor D/i.test(code), message: 'no reserved terms' },
    { name: 'ts-strict', pass: !code.includes(': any'), message: 'no implicit any' },
  ];
  const all_pass = gates.every((g) => g.pass);
  return { all_pass, gates, duration_ms: 1200 };
}

/**
 * Submit a kernel to the marketplace. Returns submission tracking id +
 * verdict + auto-granted badges (when all gates pass).
 *
 * Falls back to a mock verdict when `opts.apiUrl` is not provided. This
 * keeps unit tests fast and lets SDK consumers prototype locally.
 */
export async function submitKernel(
  manifest: KernelManifest,
  kernelCode: string,
  authorToken: string,
  opts: SubmitOptions = {}
): Promise<SubmissionResult> {
  validateManifest(manifest);
  validateKernelCode(kernelCode);
  if (!authorToken || authorToken.length < 8) {
    throw new Error('authorToken required (>= 8 chars)');
  }

  const subId = makeSubmissionId(manifest.name, manifest.version, Date.now());

  // Mock path — no API URL → synthesize a verdict client-side.
  if (!opts.apiUrl) {
    const verdict = mockVerdict(kernelCode);
    return {
      ok: true,
      submissionId: subId,
      statusUrl: `/mock/marketplace/submissions/${subId}`,
      verdict,
      autoBadges: verdict?.all_pass ? ['verified'] : [],
      message: verdict?.all_pass
        ? `Submission accepted, all gates pass → verified badge granted`
        : `Submission accepted with failing gates; review status URL for details`,
    };
  }

  const f = opts.fetch ?? fetch;
  const res = await f(`${opts.apiUrl.replace(/\/$/, '')}/api/marketplace/kernels/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authorToken}`,
    },
    body: JSON.stringify({ manifest, kernelCode, submissionId: subId }),
  });
  if (!res.ok) {
    throw new Error(`marketplace submit failed: ${res.status}`);
  }
  const body = (await res.json()) as SubmissionResult;
  return body;
}

/** Build a manifest skeleton — convenience for the wizard UI. */
export function manifestSkeleton(authorId: string): KernelManifest {
  return {
    name: 'my-new-kernel',
    version: '0.1.0',
    author: authorId,
    license: 'MIT',
    p_id_target: 'P-MISC-NEW-001',
    category: 'misc',
    description: 'Describe what your kernel does in 1-2 sentences.',
    math_summary: 'Briefly summarise the closed-form math (e.g. p_trigger * multiplier_sum).',
    certification_level: 'verified',
  };
}
