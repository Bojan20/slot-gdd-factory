/**
 * SLOT MATH ENGINE TEMPLATE - Math Archive System
 *
 * Creates tamper-evident archive of locked math configuration.
 * Archive contains:
 * - SimReport.json (full simulation results)
 * - config_snapshot.json (frozen config)
 * - MATH_LOCK.json (lock verification)
 * - MANIFEST.sha256 (checksums of all files)
 *
 * Archive format: .tar.gz for:
 * - Single file delivery
 * - Built-in compression
 * - Universal compatibility
 * - Easy verification
 */

import { createReadStream, createWriteStream, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { join, basename, dirname } from 'path';
import { createGzip, createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';

/**
 * Manifest entry for a file
 */
export interface ManifestEntry {
  path: string;
  sha256: string;
  size: number;
  modifiedAt: string;
}

/**
 * Full manifest structure
 */
export interface ArchiveManifest {
  schemaVersion: string;
  createdAt: string;
  game: string;
  mathVersion: string;
  files: ManifestEntry[];
  totalSize: number;
  archiveHash?: string;
}

const MANIFEST_FILENAME = 'MANIFEST.sha256';
const SCHEMA_VERSION = 'v1.0.0';

/**
 * Calculate SHA-256 hash of a file
 */
export function calculateFileHash(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Calculate SHA-256 hash of string content
 */
export function calculateContentHash(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Generate manifest for a directory
 */
export function generateManifest(
  dirPath: string,
  mathVersion: string,
  game: string = 'Slot Math Engine'
): ArchiveManifest {
  const files: ManifestEntry[] = [];
  let totalSize = 0;

  // Get all files in directory (non-recursive for math lock folder)
  const entries = readdirSync(dirPath);

  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    const stat = statSync(fullPath);

    if (stat.isFile() && entry !== MANIFEST_FILENAME) {
      const hash = calculateFileHash(fullPath);
      const fileEntry: ManifestEntry = {
        path: entry,
        sha256: hash,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString()
      };
      files.push(fileEntry);
      totalSize += stat.size;
    }
  }

  // Sort files for consistent ordering
  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    game,
    mathVersion,
    files,
    totalSize
  };
}

/**
 * Write manifest file
 */
export function writeManifest(dirPath: string, manifest: ArchiveManifest): string {
  const manifestPath = join(dirPath, MANIFEST_FILENAME);
  const content = formatManifest(manifest);
  writeFileSync(manifestPath, content);
  return manifestPath;
}

/**
 * Format manifest for human-readable output
 */
export function formatManifest(manifest: ArchiveManifest): string {
  const lines: string[] = [
    `# Math Archive Manifest`,
    `# Schema: ${manifest.schemaVersion}`,
    `# Created: ${manifest.createdAt}`,
    `# Game: ${manifest.game}`,
    `# Math Version: ${manifest.mathVersion}`,
    `# Total Files: ${manifest.files.length}`,
    `# Total Size: ${manifest.totalSize} bytes`,
    `#`,
    `# SHA-256 Checksums:`,
    ``
  ];

  for (const file of manifest.files) {
    lines.push(`${file.sha256}  ${file.path}`);
  }

  lines.push('');
  lines.push(`# End of manifest`);

  return lines.join('\n');
}

/**
 * Parse manifest from file content
 */
export function parseManifest(content: string): ManifestEntry[] {
  const entries: ManifestEntry[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.startsWith('#') || line.trim() === '') continue;

    // Format: sha256  filename
    const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
    if (match) {
      entries.push({
        path: match[2],
        sha256: match[1],
        size: 0,  // Not stored in simple format
        modifiedAt: ''
      });
    }
  }

  return entries;
}

/**
 * Verify all files against manifest
 */
export function verifyManifest(
  dirPath: string,
  manifest: ArchiveManifest
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const entry of manifest.files) {
    const filePath = join(dirPath, entry.path);

    if (!existsSync(filePath)) {
      errors.push(`Missing file: ${entry.path}`);
      continue;
    }

    const actualHash = calculateFileHash(filePath);
    if (actualHash !== entry.sha256) {
      errors.push(`Hash mismatch: ${entry.path} (expected ${entry.sha256.slice(0, 8)}..., got ${actualHash.slice(0, 8)}...)`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Simple tar implementation for Node.js
 * Creates a POSIX tar file without external dependencies
 */
function createTarHeader(name: string, size: number, mtime: Date): Buffer {
  const header = Buffer.alloc(512, 0);

  // File name (100 bytes)
  header.write(name.slice(0, 99), 0);

  // File mode (8 bytes) - 0644
  header.write('0000644\0', 100);

  // UID (8 bytes)
  header.write('0000000\0', 108);

  // GID (8 bytes)
  header.write('0000000\0', 116);

  // File size (12 bytes, octal)
  header.write(size.toString(8).padStart(11, '0') + '\0', 124);

  // Modification time (12 bytes, octal)
  const mtimeSeconds = Math.floor(mtime.getTime() / 1000);
  header.write(mtimeSeconds.toString(8).padStart(11, '0') + '\0', 136);

  // Checksum placeholder (8 spaces)
  header.write('        ', 148);

  // Type flag ('0' = regular file)
  header.write('0', 156);

  // Calculate checksum
  let checksum = 0;
  for (let i = 0; i < 512; i++) {
    checksum += header[i];
  }
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);

  return header;
}

/**
 * Create tar archive from directory
 */
export async function createTarGz(
  sourceDir: string,
  outputPath: string,
  manifest: ArchiveManifest
): Promise<void> {
  const chunks: Buffer[] = [];

  // Add each file to tar
  for (const entry of manifest.files) {
    const filePath = join(sourceDir, entry.path);
    const content = readFileSync(filePath);
    const stat = statSync(filePath);

    // Create tar header
    const header = createTarHeader(entry.path, content.length, stat.mtime);
    chunks.push(header);

    // Add file content
    chunks.push(content);

    // Pad to 512-byte boundary
    const padding = 512 - (content.length % 512);
    if (padding < 512) {
      chunks.push(Buffer.alloc(padding, 0));
    }
  }

  // Add manifest
  const manifestContent = Buffer.from(formatManifest(manifest));
  const manifestHeader = createTarHeader(MANIFEST_FILENAME, manifestContent.length, new Date());
  chunks.push(manifestHeader);
  chunks.push(manifestContent);
  const manifestPadding = 512 - (manifestContent.length % 512);
  if (manifestPadding < 512) {
    chunks.push(Buffer.alloc(manifestPadding, 0));
  }

  // Add two empty blocks to end tar
  chunks.push(Buffer.alloc(1024, 0));

  // Combine and compress
  const tarBuffer = Buffer.concat(chunks);

  // Write compressed
  const gzip = createGzip({ level: 9 });
  const output = createWriteStream(outputPath);

  await new Promise<void>((resolve, reject) => {
    gzip.on('error', reject);
    output.on('error', reject);
    output.on('finish', resolve);

    gzip.pipe(output);
    gzip.end(tarBuffer);
  });
}

/**
 * Create complete math archive
 */
export async function createMathArchive(
  lockDir: string,
  mathVersion: string,
  outputPath?: string
): Promise<{ archivePath: string; manifest: ArchiveManifest }> {
  // Generate manifest
  const manifest = generateManifest(lockDir, mathVersion);

  // Write manifest to directory
  writeManifest(lockDir, manifest);

  // Determine output path
  const archivePath = outputPath || join(
    dirname(lockDir),
    `math-lock-${mathVersion}-${Date.now()}.tar.gz`
  );

  // Create archive
  await createTarGz(lockDir, archivePath, manifest);

  // Calculate and add archive hash to manifest
  manifest.archiveHash = calculateFileHash(archivePath);

  return { archivePath, manifest };
}

/**
 * Quick verification of archive integrity
 */
export function verifyArchiveHash(archivePath: string, expectedHash: string): boolean {
  const actualHash = calculateFileHash(archivePath);
  return actualHash === expectedHash;
}

/**
 * Print archive info
 */
export function printArchiveInfo(manifest: ArchiveManifest): void {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  MATH ARCHIVE INFO');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Game:         ${manifest.game}`);
  console.log(`  Math Version: ${manifest.mathVersion}`);
  console.log(`  Created:      ${manifest.createdAt}`);
  console.log(`  Files:        ${manifest.files.length}`);
  console.log(`  Total Size:   ${(manifest.totalSize / 1024).toFixed(1)} KB`);

  if (manifest.archiveHash) {
    console.log(`  Archive SHA:  ${manifest.archiveHash.slice(0, 16)}...`);
  }

  console.log('\n  Files:');
  for (const file of manifest.files) {
    const sizeKB = (file.size / 1024).toFixed(1);
    console.log(`    ${file.sha256.slice(0, 8)}... ${file.path.padEnd(30)} ${sizeKB} KB`);
  }

  console.log('═══════════════════════════════════════════════════════════\n');
}
