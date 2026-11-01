import { createWorkerGateway } from './handler.mjs';

Deno.serve(createWorkerGateway());
