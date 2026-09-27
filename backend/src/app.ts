import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { errorHandler, notFound } from './middleware/error.js';
import { healthRouter } from './routes/health.js';
import { scanRouter } from './routes/scan.js';
import { billsRouter } from './routes/bills.js';

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', 1); // Render sits behind a proxy; needed for rate-limit keys
  app.use(helmet());
  app.use(
    cors({
      origin(origin, cb) {
        // No Origin header = curl/health check, which we allow.
        if (!origin || config.corsOrigins.includes(origin)) cb(null, true);
        else cb(new Error(`Origin ${origin} is not allowed`));
      },
    }),
  );
  app.use(express.json({ limit: '256kb' }));

  app.use('/api', healthRouter);
  app.use('/api', scanRouter);
  app.use('/api', billsRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
