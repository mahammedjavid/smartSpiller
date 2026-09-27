import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const config = {
  port: Number(process.env['PORT'] ?? 8080),
  corsOrigins: (process.env['CORS_ORIGINS'] ?? 'http://localhost:4200')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  geminiApiKey: required('GEMINI_API_KEY'),
  geminiModel: process.env['GEMINI_MODEL'] ?? 'gemini-3.8-flash',
  scanTimeoutMs: Number(process.env['SCAN_TIMEOUT_MS'] ?? 25_000),
  scanRetries: Math.max(1, Number(process.env['SCAN_RETRIES'] ?? 3)),
  databaseFile: process.env['DATABASE_FILE'] ?? 'data/smart-splitter.db',
  maxUploadBytes: 8 * 1024 * 1024,
} as const;

export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedMime = (typeof ALLOWED_MIME)[number];
