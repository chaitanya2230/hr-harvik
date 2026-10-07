import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../../config/env';
import { badRequest, unprocessable } from '../../utils/errors';
import { ensureUploadDir } from '../documents/storage.service';

export const ALLOWED_RESUME_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export type AllowedResumeMimeType = (typeof ALLOWED_RESUME_MIME_TYPES)[number];

const EXTENSION_BY_MIME: Record<AllowedResumeMimeType, string> = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

export function ensureResumeUploadDir(): string {
  const root = ensureUploadDir();
  const resumeDir = path.join(root, 'resumes');
  if (!fs.existsSync(resumeDir)) {
    fs.mkdirSync(resumeDir, { recursive: true });
  }
  return resumeDir;
}

export function validateResumeFileSize(sizeBytes: number): void {
  const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
  if (sizeBytes > maxBytes) {
    throw unprocessable(`Resume file size exceeds maximum allowed limit of ${env.MAX_UPLOAD_MB} MB`);
  }
}

export function validateResumeFileSignature(buffer: Buffer, declaredMime: string): void {
  if (!ALLOWED_RESUME_MIME_TYPES.includes(declaredMime as AllowedResumeMimeType)) {
    throw badRequest(
      `Unsupported resume MIME type "${declaredMime}". Allowed types: PDF, DOC, DOCX`,
    );
  }

  if (buffer.length < 4) {
    throw badRequest('Invalid resume file: file is empty or corrupted');
  }

  switch (declaredMime) {
    case 'application/pdf': {
      const header = buffer.subarray(0, 4).toString('ascii');
      if (header !== '%PDF') {
        throw badRequest('MIME mismatch: file content does not match application/pdf');
      }
      break;
    }
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
        throw badRequest('MIME mismatch: file content does not match DOCX specification');
      }
      break;
    }
    case 'application/msword': {
      if (
        buffer.length < 8 ||
        buffer[0] !== 0xd0 ||
        buffer[1] !== 0xcf ||
        buffer[2] !== 0x11 ||
        buffer[3] !== 0xe0 ||
        buffer[4] !== 0xa1 ||
        buffer[5] !== 0xb1 ||
        buffer[6] !== 0x1a ||
        buffer[7] !== 0xe1
      ) {
        throw badRequest('MIME mismatch: file content does not match DOC specification');
      }
      break;
    }
    default:
      throw badRequest(`Unsupported resume MIME type "${declaredMime}"`);
  }
}

export function saveUploadedResume(
  buffer: Buffer,
  declaredMime: string,
): { serverFilename: string; ext: string } {
  const dir = ensureResumeUploadDir();
  const ext = EXTENSION_BY_MIME[declaredMime as AllowedResumeMimeType] ?? '.bin';
  const serverFilename = `${crypto.randomUUID()}${ext}`;
  const filePath = path.join(dir, serverFilename);
  fs.writeFileSync(filePath, buffer);
  return { serverFilename, ext };
}

export function readResumeFileStream(serverFilename: string): fs.ReadStream {
  const dir = ensureResumeUploadDir();
  // Protect against directory traversal
  const safeFilename = path.basename(serverFilename);
  const filePath = path.join(dir, safeFilename);
  if (!fs.existsSync(filePath)) {
    throw badRequest('Resume file not found on disk');
  }
  return fs.createReadStream(filePath);
}

export function deleteResumeFile(serverFilename: string): void {
  try {
    const dir = ensureResumeUploadDir();
    const safeFilename = path.basename(serverFilename);
    const filePath = path.join(dir, safeFilename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore cleanup error
  }
}
