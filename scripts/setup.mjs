import { mkdir, writeFile, copyFile, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
if (process.platform !== 'darwin') throw new Error('Build AnyLoader on macOS.');
await mkdir('vendor', { recursive: true });
const version = process.env.YTDLP_VERSION;
async function get(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status}: ${url}`); return Buffer.from(await r.arrayBuffer()); }
// Resolve an official release and verify the binary against its published SHA256.
const release = JSON.parse((await get(process.env.YTDLP_VERSION ? `https://api.github.com/repos/yt-dlp/yt-dlp/releases/tags/${version}` : 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest')).toString());
const base = `https://github.com/yt-dlp/yt-dlp/releases/download/${release.tag_name}`;
console.log(`Fetching yt-dlp ${release.tag_name}…`);
const [binary, sums] = await Promise.all([get(`${base}/yt-dlp_macos`), get(`${base}/SHA2-256SUMS`)]);
const expected = sums.toString().split('\n').find(l => /\s\*?yt-dlp_macos$/.test(l))?.split(/\s/)[0];
if (!expected || createHash('sha256').update(binary).digest('hex') !== expected) throw new Error('yt-dlp checksum mismatch.');
await writeFile('vendor/yt-dlp', binary);
if (!existsSync('vendor/sources/manifest.json') || !existsSync('vendor/ffprobe')) execFileSync(process.execPath, ['scripts/build-media.mjs'], { stdio: 'inherit' });
const denoPackage = path.dirname(require.resolve(`@deno/darwin-${process.arch}/package.json`));
await copyFile(path.join(denoPackage, 'deno'), 'vendor/deno');
for (const tool of ['yt-dlp', 'ffmpeg', 'ffprobe', 'deno']) await chmod(`vendor/${tool}`, 0o755);
await writeFile('vendor/versions.json', JSON.stringify({ ytDlp: release.tag_name, arch: process.arch, builtAt: new Date().toISOString() }, null, 2));
for (const [name, url] of [['YT-DLP-LICENSE', 'https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/LICENSE'], ['DENO-LICENSE', 'https://raw.githubusercontent.com/denoland/deno/main/LICENSE.md']]) await writeFile(`vendor/${name}`, await get(url));
console.log('Download tools are ready.');
