// Production React static server + fixed FastAPI proxy. Node.js 22+.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const dist = fileURLToPath(new URL('./dist/', import.meta.url));
const backend = new URL(process.env.BACKEND_URL || 'https://diet-planner-api-6aod.onrender.com');
if (!['http:', 'https:'].includes(backend.protocol) || backend.pathname !== '/' || backend.search || backend.username || backend.password) throw new Error('BACKEND_URL must be the backend origin without /health');
const key = process.env.API_KEY;
if (!key || key.length < 32 || key.startsWith('REPLACE_')) throw new Error('Configure API_KEY to match the backend application key');
await stat(resolve(dist, 'index.html'));
const types = { '.html':'text/html; charset=utf-8', '.js':'application/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.woff2':'font/woff2' };
function json(res, status, code, message) { res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify({error:{code,message}})); }
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (pathname === '/health' && req.method === 'GET') {res.writeHead(200,{'Content-Type':'application/json'});res.end('{"status":"ok"}');return;}
    if (pathname.startsWith('/api')) {
      if (pathname !== '/api/v1/diet-plan' || req.method !== 'POST') {json(res,404,'NOT_FOUND','API route not found');return;}
      if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {json(res,415,'INVALID_CONTENT_TYPE','Use application/json');return;}
      const chunks=[];let size=0;
      for await (const chunk of req) {size+=chunk.length;if(size>32768){json(res,413,'REQUEST_TOO_LARGE','Request body too large');return;}chunks.push(chunk);}
      const body=Buffer.concat(chunks);
      try {JSON.parse(body.toString());} catch {json(res,400,'INVALID_JSON','Invalid JSON body');return;}
      const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),200000);
      const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.once('close',disconnect);
      try {
        const upstream=await fetch(new URL('/api/v1/diet-plan',backend),{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':key},body,signal:controller.signal,redirect:'error'});
        const text=await upstream.text();
        if(!res.destroyed){res.writeHead(upstream.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(text);}
      } catch (error) {if(!res.destroyed)json(res,error.name==='AbortError'?504:502,'BACKEND_UNAVAILABLE','Cannot complete the backend request. Check backend availability and configuration');}
      finally {clearTimeout(timeout);res.off('close',disconnect);}
      return;
    }
    if (!['GET','HEAD'].includes(req.method)) {json(res,405,'METHOD_NOT_ALLOWED','Method not allowed');return;}
    const decoded=decodeURIComponent(pathname);
    if (decoded.split('/').some(part=>part.startsWith('.') && part !== '')) {json(res,404,'NOT_FOUND','Not found');return;}
    let file=resolve(dist,'.'+decoded);
    if(file!==resolve(dist)&&!file.startsWith(dist.endsWith(sep)?dist:dist+sep)){json(res,404,'NOT_FOUND','Not found');return;}
    try {if(!(await stat(file)).isFile())throw new Error();} catch {
      if(extname(decoded)){json(res,404,'NOT_FOUND','Not found');return;}
      file=resolve(dist,'index.html');
    }
    const data=await readFile(file);
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':extname(file)==='.html'?'no-cache':'public, max-age=3600'});
    res.end(req.method==='HEAD'?undefined:data);
  } catch {if(!res.headersSent)json(res,500,'SERVER_ERROR','Unexpected frontend server error');else res.end();}
});
server.requestTimeout=30000;
server.listen(Number(process.env.PORT)||10000,'0.0.0.0',()=>console.log('React production server ready'));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>process.exit(0)));
