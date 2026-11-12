import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const types = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript', '.xml': 'application/xml', '.txt': 'text/plain' };
const port = 4173;
await stat(resolve(root, 'index.html'));

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let target = resolve(root, `.${pathname}`);
    const fromRoot = relative(root, target);
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) throw new Error('Invalid path');
    if ((await stat(target)).isDirectory()) target = resolve(target, 'index.html');
    const contents = await readFile(target);
    response.writeHead(200, { 'Content-Type': `${types[extname(target)] ?? 'application/octet-stream'}; charset=utf-8` });
    response.end(contents);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('페이지를 찾을 수 없습니다.');
  }
}).listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}/`));
