import { copyFile } from 'node:fs/promises';
await copyFile('node_modules/qrcode-generator/dist/qrcode.mjs', 'src/Ahm/wwwroot/js/qr-code.mjs');
