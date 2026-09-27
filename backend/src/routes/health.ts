import { Router } from 'express';

export const healthRouter: Router = Router();

// Hit this ~2 minutes before a demo to wake the free Render instance.
healthRouter.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});
