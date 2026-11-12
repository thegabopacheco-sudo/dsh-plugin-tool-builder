// Test end-to-end de tool-builder.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageDir = path.resolve(import.meta.dirname, '..');
const tmpDir = path.join(packageDir, 'test', 'tmp');
rmSync(tmpDir, { recursive: true, force: true });
const home = path.join(tmpDir, 'dsh-home');
mkdirSync(path.join(home, 'tool-builder'), { recursive: true });
writeFileSync(path.join(home, 'tool-builder', 'config.json'), JSON.stringify({ allowedPaths: [tmpDir] }), 'utf8');

function makeClient(extraEnv = {}) {
  const entry = process.env.TOOLBUILD_SERVER ? path.resolve(process.env.TOOLBUILD_SERVER) : path.join(packageDir, 'server.mjs');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME || process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP, DSH_HOME: home, ...extraEnv }, stderr: 'pipe' });
  transport.stderr?.on('data', (c) => process.stderr.write(`[server] ${c}`));
  const client = new Client({ name: 'toolbuild-test', version: '1.0.0' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } });
  return client.connect(transport).then(() => ({ client, transport }));
}
const textOf = (r) => (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
const args = { slug: 'demo-tool', serverName: 'demo', title: 'Demo Tool', description: 'Plugin de demostración generado en test.' };

const { client, transport } = await makeClient();
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
console.log('--- status ---'); console.log(textOf(await client.callTool({ name: 'status', arguments: {} })));
const preview = textOf(await client.callTool({ name: 'preview', arguments: args }));
console.log('--- preview ---'); console.log(preview);
console.log('preview lista archivos:', preview.includes('package.json') && preview.includes('cordis.patch.yml') && preview.includes('server.mjs'));
const target = path.join(tmpDir, 'generated');
console.log('preview no escribió:', !existsSync(target));
const noConfirm = await client.callTool({ name: 'generate', arguments: { ...args, outDir: target } });
console.log('generate sin confirm isError:', noConfirm.isError === true);
const generated = await client.callTool({ name: 'generate', arguments: { ...args, outDir: target, confirm: true } });
console.log('--- generate ---'); console.log(textOf(generated));
const files = ['package.json', 'cordis.patch.yml', 'scripts/postinstall.mjs', 'server.mjs', 'test/connect-test.mjs', 'README.md', 'LICENSE', '.gitignore'];
console.log('archivos generados:', files.every((file) => existsSync(path.join(target, file))));
const pkg = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
console.log('package válido:', pkg.name === 'dsh-plugin-demo-tool' && pkg.dsh?.bundle?.patch === './cordis.patch.yml');
const cordis = readFileSync(path.join(target, 'cordis.patch.yml'), 'utf8');
console.log('cordis serverName:', cordis.includes('serverName: demo'));
const check = spawnSync(process.execPath, ['--check', path.join(target, 'server.mjs')], { encoding: 'utf8' });
console.log('server.mjs sintaxis:', check.status === 0);
const testCheck = spawnSync(process.execPath, ['--check', path.join(target, 'test', 'connect-test.mjs')], { encoding: 'utf8' });
console.log('test sintaxis:', testCheck.status === 0);
const again = await client.callTool({ name: 'generate', arguments: { ...args, outDir: target, confirm: true } });
console.log('no sobrescribe isError:', again.isError === true);
const badSlug = await client.callTool({ name: 'generate', arguments: { ...args, slug: 'Mayusculas!!', outDir: path.join(tmpDir, 'x'), confirm: true } });
console.log('slug inválido isError:', badSlug.isError === true);
await client.close(); try { await transport.close?.(); } catch {}
const { client: roClient, transport: roTransport } = await makeClient({ DSH_TOOLBUILD_MODE: 'read-only' });
const roGen = await roClient.callTool({ name: 'generate', arguments: { ...args, outDir: path.join(tmpDir, 'ro'), confirm: true } });
console.log('read-only generate isError:', roGen.isError === true);
const roPreview = await roClient.callTool({ name: 'preview', arguments: args });
console.log('read-only preview ok:', roPreview.isError !== true);
await roClient.close(); try { await roTransport.close?.(); } catch {}
console.log('OK');
