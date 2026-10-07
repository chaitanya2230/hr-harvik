import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../jobs/queues';
import { getRedis } from '../../db/redis';
import { logger } from '../../utils/logger';
import { generateDocument, type DocumentContext } from './document.service';

/**
 * AGENTS.md §3 — queued PDF generation jobs (BullMQ + Redis 7).
 *
 * Mirrors the report-export pattern (D-46): the API process writes job state
 * to Redis with a TTL, the worker process performs the generation, and the
 * frontend polls `GET /documents/pdf-jobs/:jobId`. `mode: 'queued'` on
 * `POST /document-templates/:id/generate` is opt-in — the default synchronous
 * flow is unchanged (decision recorded in docs/DECISIONS.md).
 *
 * When Redis has no live connection (unit tests) the job runs inline so the
 * observable contract (pending → completed/failed) still holds without a
 * worker process.
 */

const jobKey = (jobId: string): string => `pdf-generate:${jobId}`;
const PDF_JOB_TTL_SECONDS = 3600;

export interface StoredPdfJob {
  status: 'pending' | 'completed' | 'failed';
  ownerId: string;
  templateId: string;
  employeeId: string;
  documentId?: string;
  error?: string;
  createdAt: string;
}

export interface PdfGenerationPayload {
  jobId: string;
  templateId: string;
  employeeId: string;
  title?: string;
  confidential: boolean;
  /** Full request context, serialised into the job payload so the worker can
   * reproduce the audit trail (actor, ip) of the original request. */
  context: DocumentContext;
}

export async function getPdfJobResult(jobId: string): Promise<StoredPdfJob | null> {
  const raw = await getRedis().get(jobKey(jobId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredPdfJob;
  } catch {
    return null;
  }
}

async function setPdfJobResult(jobId: string, result: Omit<StoredPdfJob, 'createdAt'>): Promise<void> {
  await getRedis().set(
    jobKey(jobId),
    JSON.stringify({ ...result, createdAt: new Date().toISOString() }),
    'EX',
    PDF_JOB_TTL_SECONDS,
  );
}

/**
 * Runs one generation payload and records its terminal state. Shared by the
 * BullMQ worker, the API inline fallback and the no-Redis test path.
 * Re-throwing on failure lets BullMQ retry with its backoff policy.
 */
export async function runPdfGenerationJob(
  payload: PdfGenerationPayload,
): Promise<{ documentId: string }> {
  try {
    const doc = await generateDocument(
      {
        templateId: payload.templateId,
        employeeId: payload.employeeId,
        title: payload.title,
        confidential: payload.confidential,
      },
      payload.context,
    );
    const documentId = String(doc._id);
    await setPdfJobResult(payload.jobId, {
      status: 'completed',
      ownerId: payload.context.account.userId,
      templateId: payload.templateId,
      employeeId: payload.employeeId,
      documentId,
    });
    return { documentId };
  } catch (error) {
    await setPdfJobResult(payload.jobId, {
      status: 'failed',
      ownerId: payload.context.account.userId,
      templateId: payload.templateId,
      employeeId: payload.employeeId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function queuePdfGenerationJob(input: {
  templateId: string;
  employeeId: string;
  title?: string;
  confidential: boolean;
  context: DocumentContext;
}): Promise<string> {
  const jobId = `pdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await setPdfJobResult(jobId, {
    status: 'pending',
    ownerId: input.context.account.userId,
    templateId: input.templateId,
    employeeId: input.employeeId,
  });

  const payload: PdfGenerationPayload = { jobId, ...input };

  try {
    const redis = getRedis();
    if (redis && redis.status === 'ready') {
      const queue = new Queue(QUEUE_NAMES.pdfGeneration, { connection: redis });
      await queue.add('generate-pdf', payload, { jobId });
      await queue.close();
    } else {
      // No live queue (tests/dev without worker): run inline, asynchronously,
      // so the caller still observes pending → completed/failed via polling.
      setTimeout(() => {
        void runPdfGenerationJob(payload).catch((error: unknown) => {
          logger.error({ error, jobId }, 'Inline PDF generation job failed');
        });
      }, 10);
    }
  } catch (error) {
    logger.error({ error, jobId }, 'Failed to enqueue PDF generation; running inline');
    // Inline fallback keeps the contract: the job still reaches a terminal
    // state that the status endpoint can report.
    await runPdfGenerationJob(payload).catch(() => {
      /* terminal 'failed' state already stored by runPdfGenerationJob */
    });
  }

  return jobId;
}
