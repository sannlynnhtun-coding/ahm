import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('dist-publish/wwwroot', 'dist', { recursive: true });
await rm('dist/lib', { recursive: true, force: true });
