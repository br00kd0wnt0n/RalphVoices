import { Router, Response } from 'express';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

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

// Upload endpoint - returns base64 data and extracted text for PDFs
router.post('/', authMiddleware, upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const file = req.file;
    const base64Data = file.buffer.toString('base64');
    const mimeType = file.mimetype;
    const isImage = mimeType.startsWith('image/');
    const isPDF = mimeType === 'application/pdf';

    let extractedText = '';

    // Extract text from PDF
    if (isPDF) {
      try {
        const pdfData = await pdfParse(file.buffer);
        extractedText = pdfData.text;
        console.log(`Extracted ${extractedText.length} chars from PDF`);
      } catch (pdfError) {
        console.error('PDF extraction failed:', pdfError);
        extractedText = '[PDF text extraction failed]';
      }
    }

    res.json({
      success: true,
      file: {
        name: file.originalname,
        mimeType,
        size: file.size,
        isImage,
        isPDF,
        base64: `data:${mimeType};base64,${base64Data}`,
        extractedText: isPDF ? extractedText : undefined,
      },
    });
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

    const processedFiles = await Promise.all(files.map(async (file) => {
      const base64Data = file.buffer.toString('base64');
      const mimeType = file.mimetype;
      const isImage = mimeType.startsWith('image/');
      const isPDF = mimeType === 'application/pdf';

      let extractedText = '';

      if (isPDF) {
        try {
          const pdfData = await pdfParse(file.buffer);
          extractedText = pdfData.text;
        } catch (pdfError) {
          console.error('PDF extraction failed:', pdfError);
          extractedText = '[PDF text extraction failed]';
        }
      }

      return {
        name: file.originalname,
        mimeType,
        size: file.size,
        isImage,
        isPDF,
        base64: `data:${mimeType};base64,${base64Data}`,
        extractedText: isPDF ? extractedText : undefined,
      };
    }));

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
