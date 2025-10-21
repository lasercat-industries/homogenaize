/**
 * Detects if the code is running inside a Service Worker
 */
export const isServiceWorker =
  typeof globalThis !== 'undefined' &&
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  typeof (globalThis as any).ServiceWorkerGlobalScope !== 'undefined' &&
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).self instanceof (globalThis as any).ServiceWorkerGlobalScope;

/**
 * Detects if the code is running in a browser main thread
 */
export const isBrowser =
  typeof globalThis !== 'undefined' &&
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  typeof (globalThis as any).window !== 'undefined' &&
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  typeof (globalThis as any).document !== 'undefined' &&
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  typeof (globalThis as any).WorkerGlobalScope === 'undefined';
