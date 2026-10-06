import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../../config/env';
import { badRequest, unprocessable } from '../../utils/errors';

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

const EXTENSION_BY_MIME: Record<AllowedMimeType, string> = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

/**
 * Ensure upload root directory exists on disk.
 */
export function ensureUploadDir(): string {
  const dir = path.resolve(env.UPLOAD_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Validate that a file does not exceed MAX_UPLOAD_MB.
 * AGENTS.md §14: ">10MB rejected"
 */
export function validateFileSize(sizeBytes: number): void {
  const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
  if (sizeBytes > maxBytes) {
    throw unprocessable(`File size exceeds maximum allowed limit of ${env.MAX_UPLOAD_MB} MB`);
  }
}

/**
 * AGENTS.md §14: "MIME mismatch rejected"
 * Inspect header magic bytes to verify content matches declared MIME type.
 */
export function validateFileSignature(buffer: Buffer, declaredMime: string): void {
  if (!ALLOWED_MIME_TYPES.includes(declaredMime as AllowedMimeType)) {
    throw badRequest(
      `Unsupported MIME type "${declaredMime}". Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`,
    );
  }

  if (buffer.length < 4) {
    throw badRequest('Invalid file: file is empty or corrupted');
  }

  // Check magic bytes
  switch (declaredMime) {
    case 'application/pdf': {
      // PDF must begin with "%PDF" (0x25, 0x50, 0x44, 0x46)
      const header = buffer.subarray(0, 4).toString('ascii');
      if (header !== '%PDF') {
        throw badRequest('MIME mismatch: file content does not match application/pdf');
      }
      break;
    }
    case 'image/png': {
      // PNG magic bytes: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
      if (
        buffer[0] !== 0x89 ||
        buffer[1] !== 0x50 ||
        buffer[2] !== 0x4e ||
        buffer[3] !== 0x47
      ) {
        throw badRequest('MIME mismatch: file content does not match image/png');
      }
      break;
    }
    case 'image/jpeg': {
      // JPEG magic bytes: 0xFF 0xD8 0xFF
      if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
        throw badRequest('MIME mismatch: file content does not match image/jpeg');
      }
      break;
    }
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      // DOCX is a zip archive: 0x50 0x4B 0x03 0x04 or 0x50 0x4B 0x05 0x06
      if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
        throw badRequest(
          'MIME mismatch: file content does not match DOCX specification',
        );
      }
      break;
    }
    case 'application/msword': {
      // OLE2 Compound Document: 0xD0 0xCF 0x11 0xE0
      if (
        buffer[0] !== 0xd0 ||
        buffer[1] !== 0xcf ||
        buffer[2] !== 0x11 ||
        buffer[3] !== 0xe0
      ) {
        throw badRequest('MIME mismatch: file content does not match DOC specification');
      }
      break;
    }
  }
}

/**
 * Generate a cryptographically random filename on disk.
 * AGENTS.md §8.7: "random server filename"
 */
export function generateRandomFilename(mimeType: AllowedMimeType): string {
  const ext = EXTENSION_BY_MIME[mimeType] || '.bin';
  const randomName = crypto.randomUUID();
  return `${randomName}${ext}`;
}

/**
 * Prevent path traversal attacks when resolving files.
 * AGENTS.md §14: "path traversal blocked"
 */
export function resolveSafeFilePath(filename: string): string {
  const uploadDir = ensureUploadDir();
  // Strip any directory traversal components
  const sanitized = path.basename(filename);
  const resolved = path.resolve(uploadDir, sanitized);

  if (!resolved.startsWith(uploadDir)) {
    throw badRequest('Invalid file path: path traversal detected');
  }

  return resolved;
}
