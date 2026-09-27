export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:8080/api',
  /** The QR code must point at wherever this app is actually served. */
  appBaseUrl: typeof location === 'undefined' ? '' : location.origin,
};
