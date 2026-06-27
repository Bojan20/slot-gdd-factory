/**
 * @slot-math-engine/sdk — public entry point.
 *
 * Re-exports the SDK's stable API surface. Keep this file thin — every
 * import here is part of the npm package's published surface.
 */

export type {
  Jurisdiction,
  Topology,
  TopologyConfig,
  SymbolPool,
  PaytableEntry,
  FeatureConfig,
  IRDocument,
  RTPResult,
  SpinResult,
  ClientOptions,
  ApiError,
  RenderConfig,
  SeamlessHandshake,
} from './types.js';

export { SlotMathClient, IRBuilder, SlotMathLiveClient } from './client.js';
export type {
  LiveClientOptions,
  LiveEvent,
  LiveCommand,
} from './client.js';

export type {
  KernelParamSpec,
  KernelContext,
  KernelResult,
  KernelDefinition,
} from './kernel-author.js';

export { defineKernel, validateParams, defaultMC } from './kernel-author.js';

export type {
  KernelManifest,
  KernelCategory,
  KernelDependency,
  CertificationLevel,
  SubmissionResult,
  SubmitOptions,
} from './marketplace-submit.js';

export {
  submitKernel,
  validateManifest,
  validateKernelCode,
  manifestSkeleton,
} from './marketplace-submit.js';

export const SDK_VERSION = '0.1.0';
