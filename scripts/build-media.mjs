// Build a redistributable LGPL media engine with no nonfree or GPL components.
import { mkdir, writeFile, copyFile, open, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
const root = path.resolve('.runtime/media');
const prefix = path.join(root, 'prefix');
await mkdir(root, { recursive: true });
await mkdir('vendor/sources', { recursive: true });
const sources = [
  { file: 'lame-3.100.tar.gz', url: 'https://downloads.sourceforge.net/project/lame/lame/3.100/lame-3.100.tar.gz', sha256: 'ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e' },
  { file: 'ffmpeg-8.0.3.tar.xz', url: 'https://ffmpeg.org/releases/ffmpeg-8.0.3.tar.xz', sha256: '6136812ea6d4e68bdba27e33c2a94382711cdf4f8602ffef056ff792bd6f9818' }
];
const manifest = [];
for (const s of sources) {
  const response = await fetch(s.url); if (!response.ok) throw new Error(`Source download failed: ${s.url}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(data).digest('hex') !== s.sha256) throw new Error(`Source checksum mismatch: ${s.file}`);
  await writeFile(`vendor/sources/${s.file}`, data);
  execFileSync('tar', ['-xf', path.resolve(`vendor/sources/${s.file}`), '-C', root]);
  manifest.push({ ...s, sha256: createHash('sha256').update(data).digest('hex') });
}
const log = await open(path.join(root, 'build.log'), 'w');
const run = (cmd, args, cwd, env = {}) => execFileSync(cmd, args, { cwd, env: { ...process.env, MACOSX_DEPLOYMENT_TARGET: '12.0', ...env }, stdio: ['ignore', log.fd, log.fd] });
const jobs = String(Math.min(os.availableParallelism(), 8));
const lame = path.join(root, 'lame-3.100');
console.log(`Building LAME; log: ${root}/build.log`);
run('./configure', [`--prefix=${prefix}`, '--disable-shared', '--enable-static', '--disable-frontend', '--disable-dependency-tracking', `--build=${process.arch === 'arm64' ? 'arm' : 'x86_64'}-apple-darwin`], lame);
run('make', ['clean'], lame); run('make', ['-j', jobs], lame); run('make', ['install'], lame);
const ffmpeg = path.join(root, 'ffmpeg-8.0.3');
const flags = [`--prefix=${prefix}`, '--disable-autodetect', '--disable-doc', '--disable-debug', '--disable-ffplay', '--disable-avdevice', '--disable-x86asm', '--enable-small', '--enable-static', '--disable-shared', '--enable-libmp3lame', '--enable-audiotoolbox', '--enable-videotoolbox', '--enable-securetransport', `--extra-cflags=-I${prefix}/include`, `--extra-ldflags=-L${prefix}/lib`];
console.log('Building FFmpeg and FFprobe…');
run('./configure', flags, ffmpeg); run('make', ['clean'], ffmpeg); run('make', ['-j', jobs], ffmpeg);
for (const tool of ['ffmpeg', 'ffprobe']) await copyFile(path.join(ffmpeg, tool), `vendor/${tool}`);
await copyFile(path.join(ffmpeg, 'COPYING.LGPLv2.1'), 'vendor/FFMPEG-LICENSE');
await copyFile(path.join(lame, 'COPYING'), 'vendor/LAME-LICENSE');
await writeFile('vendor/sources/manifest.json', JSON.stringify({ sources: manifest, ffmpegConfigure: flags, buildScript: 'scripts/build-media.mjs', note: 'Unmodified corresponding sources are included. Built without --enable-gpl or --enable-nonfree.' }, null, 2));
await log.close();
console.log(execFileSync('vendor/ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n').slice(0, 3).join('\n'));
