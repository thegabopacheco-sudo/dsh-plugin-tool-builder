#!/usr/bin/env node
// dsh-plugin-tool-builder — genera el esqueleto de un plugin MCP para DSH.
// Tools: status, preview, generate.

import path from 'node:path';
import os from 'node:os';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const VERSION = '0.1.0';
const DSH_HOME = (() => {
  const v = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  return v || path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.dsh');
})();
const CONFIG_FILE = path.join(DSH_HOME, 'tool-builder', 'config.json');
const CACHE_DIR = path.join(DSH_HOME, 'cache', 'tool-builder');
const READ_ONLY = String(process.env.DSH_TOOLBUILD_MODE || '').toLowerCase() === 'read-only';
const log = (m) => process.stderr.write(`[toolbuild] ${m}\n`);

function loadConfig() {
  try { if (existsSync(CONFIG_FILE)) return { allowedPaths: [], ...(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) || {}) }; } catch { /* defaults */ }
  return { allowedPaths: [] };
}
function allowedRoots() { const configured = loadConfig().allowedPaths; return (Array.isArray(configured) && configured.length ? configured : [process.env.USERPROFILE || process.env.HOME || os.homedir()]).map((item) => path.resolve(item)); }
function isAllowed(target) { const resolved = path.resolve(target); return resolved === CACHE_DIR || resolved.startsWith(CACHE_DIR + path.sep) || allowedRoots().some((root) => resolved === root || resolved.startsWith(root + path.sep)); }
function validateSlug(slug) { if (!/^[a-z][a-z0-9-]{1,40}$/.test(slug)) throw new Error('slug inválido: usa minúsculas, números y guiones (2-41 chars)'); return slug; }
function validateServerName(name) { if (!/^[a-z][a-z0-9-]{0,30}$/.test(name)) throw new Error('serverName inválido: minúsculas/números/guiones'); return name; }

function packageJsonTemplate(slug, serverName, title, description) {
  return JSON.stringify({
    name: `dsh-plugin-${slug}`,
    version: '0.1.0',
    description,
    type: 'module',
    license: 'MIT',
    author: 'thegabopacheco-sudo',
    keywords: ['deepseek', 'deepseek-harness', 'dsh', 'dsh-plugin', 'mcp', slug],
    main: './dist/server.mjs',
    files: ['dist/', 'docs/', 'cordis.patch.yml', 'scripts/postinstall.mjs', 'README.md', 'CHANGELOG.md', 'LICENSE'],
    scripts: { 'build:bundle': 'esbuild server.mjs --bundle --platform=node --format=esm --target=node20 --outfile=dist/server.mjs', prepack: 'npm run build:bundle', postinstall: 'node scripts/postinstall.mjs' },
    engines: { node: '>=20' },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    devDependencies: { '@modelcontextprotocol/server': '2.2.0', '@modelcontextprotocol/client': '2.2.0', esbuild: '0.28.2', zod: '4.4.3' },
  }, null, 2) + '\n';
}
function cordisTemplate(slug, serverName) {
  return [
    `# dsh-plugin-${slug} — capa bundle de DSH.`,
    `# Inserta una fila @deepseek-ai/dsh-mcp-client que lanza el servidor como "${serverName}".`,
    `# Tools resultantes: mcp__${serverName}__* (ver README).`,
    '- insert:',
    `    - id: mcp-${slug}`,
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    `        serverName: ${serverName}`,
    '        transport: stdio',
    '        command: !!js process.execPath',
    '        args:',
    `          - !!js "(process.env.DSH_HOME && process.env.DSH_HOME.trim() !== '' ? process.env.DSH_HOME : (process.env.USERPROFILE || process.env.HOME || '') + '/.dsh') + '/plugins/${slug}/server.mjs'"`,
    '        env:',
    "          ELECTRON_RUN_AS_NODE: '1'",
    '        failOnStartupError: false',
    '        toolCallTimeoutMs: 60000',
    '',
  ].join('\n');
}
function postinstallTemplate(slug) {
  return `// dsh-plugin-${slug} — despliega el runtime en <DSH_HOME>/plugins/${slug}.
import { existsSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const log = (m) => process.stdout.write('[dsh-plugin-${slug}] ' + m + '\\n');

function findDshHome() {
  const fromEnv = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  if (fromEnv) return fromEnv;
  let current = packageDir;
  for (let depth = 0; depth < 14; depth++) {
    const parent = path.dirname(current);
    if (parent === current) break;
    if (path.basename(current).toLowerCase() === 'profiles') return path.dirname(current);
    current = parent;
  }
  const fallback = path.join(homedir(), '.dsh');
  return existsSync(path.join(fallback, 'profiles')) ? fallback : null;
}

const dshHome = findDshHome();
if (!dshHome) { log('no se encontró DSH_HOME; no se desplegó nada.'); process.exit(0); }
const target = path.join(dshHome, 'plugins', '${slug}');
try {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  let copied = 0;
  for (const [from, to] of [[path.join(packageDir, 'dist', 'server.mjs'), path.join(target, 'server.mjs')], [path.join(packageDir, 'package.json'), path.join(target, 'package.json')]]) {
    if (!existsSync(from)) { log('aviso: falta ' + path.relative(packageDir, from)); continue; }
    copyFileSync(from, to);
    copied++;
  }
  log('desplegados ' + copied + '/2 archivos en ' + target);
} catch (error) {
  log('falló el despliegue: ' + error.message);
}
`;
}
function serverTemplate(slug, serverName, title) {
  return `#!/usr/bin/env node
// dsh-plugin-${slug} — ${title}. GENERADO por tool-builder.
// Tools: status, ping.

import path from 'node:path';
import os from 'node:os';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const VERSION = '0.1.0';
const DSH_HOME = (() => {
  const v = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  return v || path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.dsh');
})();
const READ_ONLY = String(process.env.DSH_${slug.toUpperCase().replace(/-/g, '_')}_MODE || '').toLowerCase() === 'read-only';
const log = (m) => process.stderr.write('[${serverName}] ' + m + '\\n');

function buildInstructions() {
  return ['${title}: plugin MCP generado por tool-builder.', '', 'Herramientas: status, ping.', '', 'Reglas:', '- Implementa aquí la lógica real antes de publicar.', '- Lectura por defecto; escrituras requieren confirm:true.', '- Respeta allowedPaths si el plugin toca archivos.'].join('\\n');
}

function buildServer() {
  const server = new McpServer({ name: 'dsh-plugin-${slug}', version: VERSION }, { capabilities: { tools: {} }, instructions: buildInstructions() });
  server.registerTool('status', { title: 'Estado', description: 'Estado del plugin y modo.', inputSchema: z.object({}) }, async () => ({ content: [{ type: 'text', text: ['Plugin ${slug} v' + VERSION, 'DSH_HOME: ' + DSH_HOME, 'Modo: ' + (READ_ONLY ? 'read-only' : 'normal')].join('\\n') }] }));
  server.registerTool('ping', { title: 'Ping', description: 'Comprueba que el servidor responde.', inputSchema: z.object({ message: z.string().max(200).optional() }) }, async (args) => ({ content: [{ type: 'text', text: 'pong' + (args.message ? ': ' + args.message : '') }] }));
  return server;
}

log('iniciando ${slug}');
serveStdio(buildServer, { onerror: (e) => log('serveStdio: ' + e.message) });
process.on('uncaughtException', (e) => log('excepción: ' + e.message));
process.on('unhandledRejection', (e) => log('rechazo: ' + (e && e.message ? e.message : String(e))));
`;
}
function testTemplate(slug, serverName) {
  return `// Test e2e de dsh-plugin-${slug} (generado por tool-builder).
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageDir = path.resolve(import.meta.dirname, '..');
const entry = process.env.${slug.toUpperCase().replace(/-/g, '_')}_SERVER ? path.resolve(process.env.${slug.toUpperCase().replace(/-/g, '_')}_SERVER) : path.join(packageDir, 'server.mjs');
const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { SystemRoot: process.env.SystemRoot || 'C:\\\\Windows', PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME || process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP, DSH_HOME: path.join(packageDir, 'test', 'tmp-home') }, stderr: 'pipe' });
transport.stderr?.on('data', () => {});
const client = new Client({ name: '${slug}-test', version: '1.0.0' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } });
await client.connect(transport);
const textOf = (r) => (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\\n');
const tools = (await client.listTools()).tools.map((t) => t.name);
console.log('tools:', tools.join(', '));
console.log('status:', textOf(await client.callTool({ name: 'status', arguments: {} })).slice(0, 200));
if (!tools.includes('status')) throw new Error('falta tool status');
const ping = await client.callTool({ name: 'ping', arguments: { message: 'hola' } });
console.log('ping:', textOf(ping));
if (!textOf(ping).includes('pong')) throw new Error('ping no responde');
await client.close(); try { await transport.close?.(); } catch {}
console.log('OK');
`;
}
function readmeTemplate(slug, serverName, title, description) {
  return `# ${title}\n\n${description}\n\nPlugin MCP para [DeepSeek Harness](https://github.com/deepseek-ai). Generado con \`tool-builder\`; completa la lógica antes de publicar.\n\n## Instalación\n\ndsh plugin install github:TU_USUARIO/dsh-plugin-${slug}\n\n## Tools\n\n- \`status\` — estado del plugin\n- \`ping\` — prueba de respuesta\n\n## Desarrollo\n\n\`\`\`bash\nnpm install\nnpm run build:bundle\nnode test/connect-test.mjs\n\`\`\`\n\n## Licencia\n\nMIT\n`;
}
function licenseTemplate() { return 'MIT License\n\nCopyright (c) 2026 thegabopacheco-sudo\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n'; }

function filesFor(slug, serverName, title, description) {
  return {
    'package.json': packageJsonTemplate(slug, serverName, title, description),
    'cordis.patch.yml': cordisTemplate(slug, serverName),
    'scripts/postinstall.mjs': postinstallTemplate(slug),
    'server.mjs': serverTemplate(slug, serverName, title),
    'test/connect-test.mjs': testTemplate(slug, serverName),
    'README.md': readmeTemplate(slug, serverName, title, description),
    'LICENSE': licenseTemplate(),
    '.gitignore': 'node_modules/\ndist/\ntest/tmp/\ntest/tmp-home/\n*.log\n',
  };
}
function textResult(text) { return { content: [{ type: 'text', text }] }; }

function buildInstructions() {
  return [
    'Tool Builder: genera el esqueleto de un plugin MCP para el harness.',
    '',
    `Salida por defecto: ${CACHE_DIR}`,
    '',
    'Herramientas: status, preview, generate.',
    '',
    'Reglas:',
    '- preview no escribe; generate requiere confirm:true.',
    '- Genera package.json, cordis.patch.yml, postinstall, server.mjs con status/ping, test e2e, README y LICENSE.',
    '- No inventa lógica de negocio: el esqueleto se completa a mano antes de publicar.',
    '- Nunca sobrescribe un directorio existente con archivos.',
  ].join('\n');
}

function buildServer() {
  const server = new McpServer({ name: 'dsh-plugin-tool-builder', version: VERSION }, { capabilities: { tools: {} }, instructions: buildInstructions() });

  server.registerTool(
    'status',
    { title: 'Estado', description: 'Rutas permitidas, salida por defecto y modo.', inputSchema: z.object({}) },
    async () => textResult([`Rutas permitidas: ${allowedRoots().join(', ')}`, `Salida por defecto: ${CACHE_DIR}`, `Modo: ${READ_ONLY ? 'read-only' : 'normal'}`].join('\n')),
  );

  server.registerTool(
    'preview',
    { title: 'Previsualizar esqueleto', description: 'Lista archivos y tamaños sin escribir.', inputSchema: z.object({ slug: z.string().min(2).max(41), serverName: z.string().min(1).max(31), title: z.string().min(2).max(120), description: z.string().min(10).max(400) }) },
    async (args) => {
      const slug = validateSlug(args.slug);
      const serverName = validateServerName(args.serverName);
      const files = filesFor(slug, serverName, args.title.trim(), args.description.trim());
      const list = Object.entries(files).map(([name, content]) => `- ${name} (${content.length} bytes)`);
      return textResult([`Plugin: dsh-plugin-${slug} · servidor: ${serverName}`, `Archivos (${list.length}):`, ...list, '', `Destino por defecto: ${path.join(CACHE_DIR, slug)}`].join('\n'));
    },
  );

  server.registerTool(
    'generate',
    {
      title: 'Generar plugin',
      description: 'Escribe el esqueleto completo. Requiere confirm:true.',
      inputSchema: z.object({ slug: z.string().min(2).max(41), serverName: z.string().min(1).max(31), title: z.string().min(2).max(120), description: z.string().min(10).max(400), outDir: z.string().optional(), confirm: z.boolean().optional() }),
    },
    async (args) => {
      if (READ_ONLY) throw new Error('modo read-only: generate deshabilitado');
      if (args.confirm !== true) throw new Error('generate requiere confirm:true y pedido explícito');
      const slug = validateSlug(args.slug);
      const serverName = validateServerName(args.serverName);
      const target = args.outDir ? path.resolve(args.outDir) : path.join(CACHE_DIR, slug);
      if (!isAllowed(target)) throw new Error(`ruta no permitida: ${target}`);
      if (existsSync(target)) { try { if (readdirSync(target).length > 0) throw new Error(`el destino ya existe y no está vacío: ${target}`); } catch (error) { if (/ya existe/.test(error.message)) throw error; } }
      const files = filesFor(slug, serverName, args.title.trim(), args.description.trim());
      for (const [name, content] of Object.entries(files)) {
        const file = path.join(target, name);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, content, 'utf8');
      }
      return textResult([`Plugin generado: ${target}`, `${Object.keys(files).length} archivos`, '', 'Siguiente: implementa la lógica, npm install, npm run build:bundle, node test/connect-test.mjs.'].join('\n'));
    },
  );

  return server;
}

try { mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignora */ }
log(`cache: ${CACHE_DIR} · modo: ${READ_ONLY ? 'read-only' : 'normal'}`);
serveStdio(buildServer, { onerror: (e) => log(`serveStdio: ${e.message}`) });
process.on('uncaughtException', (e) => log(`excepción: ${e.message}`));
process.on('unhandledRejection', (e) => log(`rechazo: ${e && e.message ? e.message : String(e)}`));
