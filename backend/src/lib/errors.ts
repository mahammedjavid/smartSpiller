/** Every error the API returns is one of these — Section 12 of the PRD. */
export type ApiErrorCode =
  | 'NO_IMAGE'
  | 'UNSUPPORTED_TYPE'
  | 'FILE_TOO_LARGE'
  | 'BAD_REQUEST'
  | 'BILL_NOT_FOUND'
  | 'BILL_NOT_OPEN'
  | 'NOT_BILL_OWNER'
  | 'NOT_A_PARTICIPANT'
  | 'NOT_A_BILL'
  | 'RATE_LIMITED'
  | 'MODEL_BUSY'
  | 'SCAN_FAILED'
  | 'SCAN_TIMEOUT'
  | 'INTERNAL';

const STATUS: Record<ApiErrorCode, number> = {
  NO_IMAGE: 400,
  UNSUPPORTED_TYPE: 400,
  FILE_TOO_LARGE: 413,
  BAD_REQUEST: 400,
  BILL_NOT_FOUND: 404,
  BILL_NOT_OPEN: 409,
  NOT_BILL_OWNER: 403,
  NOT_A_PARTICIPANT: 403,
  NOT_A_BILL: 422,
  RATE_LIMITED: 429,
  MODEL_BUSY: 503,
  SCAN_FAILED: 502,
  SCAN_TIMEOUT: 504,
  INTERNAL: 500,
};

/** User-facing copy. Never leak a stack trace or raw model output (NFR-3). */
const MESSAGE: Record<ApiErrorCode, string> = {
  NO_IMAGE: 'Please choose a photo of your bill.',
  UNSUPPORTED_TYPE: 'That file type isn’t supported. Use a JPEG, PNG or WEBP photo.',
  FILE_TOO_LARGE: 'That photo is larger than 8 MB. Try a smaller one.',
  BAD_REQUEST: 'Something in that request didn’t look right.',
  BILL_NOT_FOUND: 'This bill doesn’t exist. Check the link with your friend.',
  BILL_NOT_OPEN: 'This bill isn’t open for splitting.',
  NOT_BILL_OWNER: 'Only the person who paid can do that.',
  NOT_A_PARTICIPANT: 'You haven’t joined this bill yet.',
  NOT_A_BILL: 'We couldn’t find a bill in that photo.',
  RATE_LIMITED: 'Too many scans just now. Wait a moment and try again.',
  MODEL_BUSY: 'The bill reader is busy right now. Try again, or enter the bill manually.',
  SCAN_FAILED: 'Couldn’t read the bill right now.',
  SCAN_TIMEOUT: 'Reading the bill took too long. Try again or enter it manually.',
  INTERNAL: 'Something went wrong on our side.',
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly userMessage: string;

  constructor(code: ApiErrorCode, detail?: string) {
    super(detail ?? code);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
    this.userMessage = MESSAGE[code];
  }

  toJSON() {
    return { error: { code: this.code, message: this.userMessage } };
  }
}
