export const environment = {
  production: true,
  /**
   * The deployed backend, called directly rather than proxied: the bill room
   * holds an open Server-Sent Events stream, and CDN proxies tend to buffer or
   * time those out. Direct means CORS_ORIGINS on the backend must list this
   * app's origin.
   *
   * Set this to your Render URL before deploying the frontend.
   */
  apiBaseUrl: 'https://smart-splitter-api.onrender.com/api',
  /** The QR code must point at wherever this app is actually served. */
  appBaseUrl: typeof location === 'undefined' ? '' : location.origin,
};
