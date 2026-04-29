// Cloudflare R2 client (S3-compatible).
//
// Gated by ENABLE_R2_STORAGE=true; when off, callers must fall back to the
// existing inline-base64 storage path so existing deployments and tests don't
// break. Configure with R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
// R2_BUCKET_NAME, and R2_PUBLIC_URL (the public bucket domain used to construct
// fetchable URLs).

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

const R2_ENABLED = process.env.ENABLE_R2_STORAGE === 'true';

let client: S3Client | null = null;
let configError: string | null = null;

function getClient(): S3Client | null {
  if (!R2_ENABLED) return null;
  if (client) return client;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    if (!configError) {
      configError =
        'ENABLE_R2_STORAGE=true but R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are missing.';
      console.warn(`[r2] ${configError} Falling back to inline base64 storage.`);
    }
    return null;
  }

  client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  return client;
}

export function isR2Enabled(): boolean {
  return R2_ENABLED && getClient() !== null;
}

export interface R2UploadResult {
  url: string;
  key: string;
}

/**
 * Upload a buffer to R2. Returns a public URL (using R2_PUBLIC_URL) and the
 * object key. Throws on failure — callers should catch and fall back.
 */
export async function uploadBuffer(
  buffer: Buffer,
  mimeType: string,
  originalName: string
): Promise<R2UploadResult> {
  const s3 = getClient();
  if (!s3) throw new Error('R2 storage not configured.');

  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error('R2_BUCKET_NAME not configured.');

  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const key = `${randomUUID()}-${safeName}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    })
  );

  const publicBase = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  if (!publicBase) {
    throw new Error('R2_PUBLIC_URL not configured — cannot construct asset URL.');
  }

  return { url: `${publicBase}/${key}`, key };
}

/** Fetch an R2 object back as a Buffer (used by AI vision fallback). */
export async function fetchAsBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`R2 fetch failed: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
