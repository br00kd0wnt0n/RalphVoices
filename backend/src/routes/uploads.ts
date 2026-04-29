import { Router, Response } from 'express';
import multer from 'multer';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { isR2Enabled, uploadBuffer } from '../services/r2.js';

// Lazy load pdf-parse to avoid initialization crash in some environments
let pdfParse: typeof import('pdf-parse') | null = null;
const getPdfParse = async () => {
  if (!pdfParse) {
    pdfParse = (await import('pdf-parse')).default;
  }
  return pdfParse;
};

interface ProcessedFile {
  name: string;
  mimeType: string;
  size: number;
  isImage: boolean;
  isPDF: boolean;
  base64: string;
  url?: string;
  extractedText?: string;
}

async function processUploadedFile(file: Express.Multer.File): Promise<ProcessedFile> {
  const mimeType = file.mimetype;
  const isImage = mimeType.startsWith('image/');
  const isPDF = mimeType === 'application/pdf';
  const base64Data = file.buffer.toString('base64');

  let extractedText = '';
  if (isPDF) {
    try {
      const parser = await getPdfParse();
      const pdfData = await parser(file.buffer);
      extractedText = pdfData.text;
      console.log(`Extracted ${extractedText.length} chars from PDF`);
    } catch (pdfError) {
      console.error('PDF extraction failed:', pdfError);
      extractedText = '[PDF text extraction failed]';
    }
  }

  // When R2 is enabled, push images and original PDFs to object storage and
  // return the URL. Images stop including base64 in the response (saves payload
  // size and DB JSONB bloat). PDFs still return base64 for backward
  // compatibility but also expose `url` for audit/recovery.
  let url: string | undefined;
  let base64: string = `data:${mimeType};base64,${base64Data}`;

  if (isR2Enabled() && (isImage || isPDF)) {
    try {
      const uploaded = await uploadBuffer(file.buffer, mimeType, file.originalname);
      url = uploaded.url;
      if (isImage) {
        // Image content lives in R2; downstream code will fetch from `url`. Keep
        // base64 as an empty marker so older clients don't choke on undefined.
        base64 = '';
      }
    } catch (err) {
      console.warn('[uploads] R2 upload failed, falling back to inline base64:', err);
    }
  }

  return {
    name: file.originalname,
    mimeType,
    size: file.size,
    isImage,
    isPDF,
    base64,
    ...(url ? { url } : {}),
    ...(isPDF ? { extractedText } : {}),
  };
}

const router = Router();

// Configure multer for memory storage (files stored as buffers)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: JPEG, PNG, GIF, WebP, PDF'));
    }
  },
});

// Upload endpoint — when ENABLE_R2_STORAGE=true, image/PDF buffers go to R2 and
// we return a `url` alongside (PDFs still include base64 for compatibility).
router.post('/', authMiddleware, upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const processed = await processUploadedFile(req.file);
    res.json({ success: true, file: processed });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to process upload' });
  }
});

// Upload multiple files
router.post('/multiple', authMiddleware, upload.array('files', 5), async (req: AuthRequest, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No files uploaded' });
      return;
    }

    const processedFiles = await Promise.all(files.map(processUploadedFile));

    res.json({
      success: true,
      files: processedFiles,
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to process uploads' });
  }
});

export default router;
