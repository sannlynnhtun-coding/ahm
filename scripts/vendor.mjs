import { copyFile, mkdir } from 'node:fs/promises';
await copyFile('node_modules/qrcode-generator/dist/qrcode.mjs', 'src/Ahm/wwwroot/js/qr-code.mjs');
await mkdir('src/Ahm/wwwroot/setup', { recursive: true });
await copyFile('google-apps-script/Code.gs', 'src/Ahm/wwwroot/setup/Ahm-Code.gs.txt');
