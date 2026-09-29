import { rm } from 'node:fs/promises';

await rm('dist-publish', { recursive: true, force: true });
await rm('dist', { recursive: true, force: true });
