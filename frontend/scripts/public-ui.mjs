import ngrok from '@ngrok/ngrok';
import { createServer, loadEnv } from 'vite';

const env = { ...loadEnv('development', process.cwd(), ''), ...process.env };
let server, listener;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  if (listener) await ngrok.disconnect(listener.url()).catch(() => {});
  if (server) await server.close();
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await close(); process.exit(0); });
}
try {
  if (!env.API_KEY || env.API_KEY.startsWith('REPLACE_')) throw new Error('Set API_KEY in the React .env to your backend API_KEY.');
  if (!env.NGROK_AUTHTOKEN || env.NGROK_AUTHTOKEN.startsWith('YOUR_')) throw new Error('Set NGROK_AUTHTOKEN in the React .env.');
  listener = await ngrok.forward({ addr: 'http://127.0.0.1:5173', authtoken: env.NGROK_AUTHTOKEN });
  const publicUrl = new URL(listener.url());
  // Allow only the hostname assigned to this tunnel, not every ngrok domain.
  server = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true, hmr: false, allowedHosts: [publicUrl.hostname] } });
  await server.listen();
  console.log(`\nPublic React UI: ${publicUrl.origin}\nLocal UI: http://127.0.0.1:5173\nKeep FastAPI running on port 8000. Press Ctrl+C to close the tunnel.\n`);
} catch (error) {
  const knownConfigError = error.message?.startsWith('Set ');
  console.error(knownConfigError ? error.message : 'Public UI startup failed. Check ngrok token/account, internet access and whether port 5173 is already in use.');
  await close();
  process.exitCode = 1;
}
