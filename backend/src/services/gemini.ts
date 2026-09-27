import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../config.js';
import { ApiError } from '../lib/errors.js';
import { geminiBillSchema, type GeminiBill } from '../lib/scanSchema.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

const PROMPT = `You are reading a photograph of a restaurant, cafe or food-delivery bill from India.

Extract the bill EXACTLY as printed. Rules:
- All money values are in rupees as plain numbers (e.g. 1280.50). Never include currency symbols, commas or text.
- "items" must contain only orderable line items (dishes, drinks). Never include subtotal, tax, service charge, discount, tip, round off or grand total as an item.
- If a line shows a quantity (e.g. "2 x Masala Dosa 180.00"), set quantity to that number and totalPrice to the line's total, not the unit price.
- Combine CGST and SGST (and any other tax lines) into a single "tax" number.
- "discount" is a positive number representing the amount taken off.
- "roundOff" may be negative.
- Use null for anything not printed on the bill. Do not guess or compute values that are not shown.
- CRITICAL: transcribe each amount exactly as printed, character for character. Bills often
  contain arithmetic errors. If the line items do not add up to the printed subtotal, report BOTH
  exactly as printed and change NOTHING. Never adjust, halve, scale or invent a figure to make
  the arithmetic balance — a mismatch is information the person needs to see, not an error to fix.
- billDate: the date printed on the bill in YYYY-MM-DD format, else null.
- If the photo is not a bill or receipt at all, set isBill to false and leave everything else empty.

Return JSON only.`;

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    isBill: { type: Type.BOOLEAN },
    restaurantName: { type: Type.STRING, nullable: true },
    billDate: { type: Type.STRING, nullable: true },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          quantity: { type: Type.INTEGER },
          unitPrice: { type: Type.NUMBER, nullable: true },
          totalPrice: { type: Type.NUMBER },
        },
        required: ['name', 'quantity', 'totalPrice'],
      },
    },
    subtotal: { type: Type.NUMBER, nullable: true },
    tax: { type: Type.NUMBER, nullable: true },
    serviceCharge: { type: Type.NUMBER, nullable: true },
    tip: { type: Type.NUMBER, nullable: true },
    discount: { type: Type.NUMBER, nullable: true },
    roundOff: { type: Type.NUMBER, nullable: true },
    total: { type: Type.NUMBER, nullable: true },
  },
  required: ['isBill', 'items'],
} as const;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ApiError('SCAN_TIMEOUT')), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Google returns 503 UNAVAILABLE under load, and says it is usually temporary. */
const isTransient = (message: string): boolean =>
  /\b503\b|UNAVAILABLE|high demand|overloaded|deadline/i.test(message);

async function generate(image: Buffer, mimeType: string): Promise<string> {
  const response = await withTimeout(
    ai.models.generateContent({
      model: config.geminiModel,
      contents: [
        {
          role: 'user',
          parts: [
            { text: PROMPT },
            { inlineData: { mimeType, data: image.toString('base64') } },
          ],
        },
      ],
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: responseSchema as never,
      },
    }),
    config.scanTimeoutMs,
  );
  return response.text ?? '';
}

export async function extractBill(image: Buffer, mimeType: string): Promise<GeminiBill> {
  let raw = '';
  let lastTransient = '';

  // A busy model is the single most likely failure on the free tier, and it
  // clears in a second or two — so retry before telling the user it failed.
  for (let attempt = 0; attempt < config.scanRetries; attempt++) {
    try {
      raw = await generate(image, mimeType);
      lastTransient = '';
      break;
    } catch (error) {
      if (error instanceof ApiError) throw error; // a timeout is not worth retrying
      const message = error instanceof Error ? error.message : String(error);

      if (/429|quota|rate limit/i.test(message)) throw new ApiError('RATE_LIMITED', message);
      if (!isTransient(message)) throw new ApiError('SCAN_FAILED', message);

      lastTransient = message;
      if (attempt < config.scanRetries - 1) await sleep(700 * (attempt + 1));
    }
  }

  if (lastTransient) throw new ApiError('MODEL_BUSY', lastTransient);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError('SCAN_FAILED', `Model returned non-JSON: ${raw.slice(0, 200)}`);
  }

  const result = geminiBillSchema.safeParse(parsed);
  if (!result.success) throw new ApiError('SCAN_FAILED', result.error.message);
  if (!result.data.isBill) throw new ApiError('NOT_A_BILL');

  return result.data;
}
