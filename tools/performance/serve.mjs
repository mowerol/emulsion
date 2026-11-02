// SPDX-License-Identifier: GPL-3.0-or-later
// Serve a frozen audit checkout (argument) without changing or watching the user's app.
import { createServer } from 'vite';
const server = await createServer({ root: process.argv[2], logLevel: 'error', server: { host: '127.0.0.1', port: 5299, strictPort: true, watch: null } });
await server.listen();
console.log('Audit server: http://127.0.0.1:5299');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0); });
