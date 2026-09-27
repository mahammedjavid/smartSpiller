import { Router } from 'express';
import multer from 'multer';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { ALLOWED_MIME, config } from '../config.js';
import { ApiError } from '../lib/errors.js';
import { reconcile } from '../lib/reconcile.js';
import { extractBill } from '../services/gemini.js';

// Memory only — nothing is ever written to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!(ALLOWED_MIME as readonly string[]).includes(file.mimetype)) {
      cb(new ApiError('UNSUPPORTED_TYPE', file.mimetype));
      return;
    }
    cb(null, true);
  },
});

// The Gemini free tier allows a handful of requests a minute — stay inside it.
const scanLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // ipKeyGenerator normalises IPv6 so a /64 can't spin up unlimited keys.
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
  handler: (_req, _res, next) => next(new ApiError('RATE_LIMITED')),
});

export const scanRouter: Router = Router();

scanRouter.post(
  '/scan',
  scanLimiter,
  upload.single('image'),
  async (req, res, next) => {
    try {
      const file = req.file;
      if (!file || file.size === 0) throw new ApiError('NO_IMAGE');

      // The buffer goes to Gemini and is then dropped — the photo is never stored.
      const bill = await extractBill(file.buffer, file.mimetype);
      res.json(reconcile(bill));
    } catch (error) {
      next(error);
    }
  },
);
