// Cloudflare R2 client (S3-compatible).
//
// Gated by ENABLE_R2_STORAGE=true; when off, callers must fall back to the
// existing inline-base64 storage path so existing deployments and tests don't
// break. Configure with R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
// R2_BUCKET_NAME, and R2_PUBLIC_URL (the public bucket domain used to construct
// fetchable URLs).

import fs from 'node:fs';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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

// ---------- private objects (Copy Studio Pre-flight) ----------
// Stored in a private bucket (STUDIO_R2_BUCKET: no public URL) under a key the
// caller chooses, and read back only through the signed-in API. Never
// R2_BUCKET_NAME, which has a public URL (Brook, 29 Sep).

function privateBucket(): string {
  const bucket = process.env.STUDIO_R2_BUCKET;
  if (!bucket) throw new Error("Pre-flight storage isn't configured: set STUDIO_R2_BUCKET to a private bucket");
  return bucket;
}

/**
 * Can the R2 keys write to the private bucket? A tiny put and delete: HeadBucket alone passed in production while
 * every PutObject was refused (a token scoped to another bucket, 1 Oct). For the boot log and the admins' Rules page.
 */
export async function probePrivateBucket(): Promise<{ ok: boolean; bucket?: string; error?: string }> {
  const bucket = process.env.STUDIO_R2_BUCKET;
  try {
    const s3 = getClient();
    if (!s3) return { ok: false, bucket, error: 'R2 is not configured' };
    const key = `studio/_probe/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
    await s3.send(new PutObjectCommand({ Bucket: privateBucket(), Key: key, Body: 'ok', ContentType: 'text/plain' }));
    await s3.send(new DeleteObjectCommand({ Bucket: privateBucket(), Key: key }));
    return { ok: true, bucket };
  } catch (err: any) {
    return { ok: false, bucket, error: String(err?.message || err?.name || err) };
  }
}

/** Remove a Pre-flight file (an upload that couldn't be completed). */
export async function deletePrivateObject(key: string): Promise<void> {
  const s3 = getClient();
  if (!s3) throw new Error('R2 storage not configured.');
  await s3.send(new DeleteObjectCommand({ Bucket: privateBucket(), Key: key }));
}

/** Store a Pre-flight file: a Buffer, or a file on disk (streamed, never read into memory). */
export async function putPrivateObject(key: string, body: Buffer | { path: string; size: number }, contentType: string): Promise<void> {
  const s3 = getClient();
  if (!s3) throw new Error('R2 storage not configured.');
  const Body = Buffer.isBuffer(body) ? body : fs.createReadStream(body.path);
  const ContentLength = Buffer.isBuffer(body) ? body.length : body.size;
  await s3.send(new PutObjectCommand({ Bucket: privateBucket(), Key: key, Body, ContentLength, ContentType: contentType }));
}

export async function getPrivateObject(key: string): Promise<Buffer> {
  const s3 = getClient();
  if (!s3) throw new Error('R2 storage not configured.');
  const res = await s3.send(new GetObjectCommand({ Bucket: privateBucket(), Key: key }));
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

/** A Pre-flight file as a stream (to send to the browser, or to a temp file), never whole in memory. */
export async function getPrivateObjectStream(key: string): Promise<Readable> {
  const s3 = getClient();
  if (!s3) throw new Error('R2 storage not configured.');
  const res = await s3.send(new GetObjectCommand({ Bucket: privateBucket(), Key: key }));
  return res.Body as Readable;
}

export async function downloadPrivateObject(key: string, dest: string): Promise<void> {
  await pipeline(await getPrivateObjectStream(key), fs.createWriteStream(dest));
}
