import { ensurePdfPromiseSupport } from './lms-pdf-compat.mjs';
ensurePdfPromiseSupport();
const { WorkerMessageHandler } = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/legacy/build/pdf.worker.min.mjs');
export { WorkerMessageHandler };
