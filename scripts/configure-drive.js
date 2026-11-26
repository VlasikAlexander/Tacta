import { writeFile } from 'node:fs/promises';
import { validClientId } from '../web/drive-sync.js';

const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID?.trim();
if (!validClientId(clientId)) throw new Error('GOOGLE_DRIVE_CLIENT_ID должен быть OAuth Client ID для веб-приложения.');

await writeFile(new URL('../web/drive-config.json', import.meta.url), JSON.stringify({ clientId }, null, 2) + '\n');
