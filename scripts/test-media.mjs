import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { downloadArgs, parseProgress } = createRequire(import.meta.url)('../src/core.cjs');
const folder = await mkdtemp(path.join(os.tmpdir(), 'anyloader-media-'));
const ffmpeg = path.resolve('vendor/ffmpeg');
execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-filter_complex', 'testsrc=size=320x180:rate=24[v];sine=frequency=440:sample_rate=44100[a]', '-map', '[v]', '-map', '[a]', '-t', '2', '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'aac', path.join(folder, 'fixture.mp4')]);
const fixture = await readFile(path.join(folder, 'fixture.mp4'));
execFileSync(ffmpeg, ['-v', 'error', '-i', path.join(folder, 'fixture.mp4'), '-map', '0:v', '-c', 'copy', path.join(folder, 'video.mp4')]);
execFileSync(ffmpeg, ['-v', 'error', '-i', path.join(folder, 'fixture.mp4'), '-map', '0:a', '-c', 'copy', path.join(folder, 'audio.m4a')]);
execFileSync(ffmpeg, ['-v', 'error', '-i', path.join(folder, 'video.mp4'), '-i', path.join(folder, 'audio.m4a'), '-map', '0:v', '-map', '1:a', '-c', 'copy', path.join(folder, 'merged.mkv')]);
const merged = JSON.parse(execFileSync('vendor/ffprobe', ['-v', 'quiet', '-show_streams', '-of', 'json', path.join(folder, 'merged.mkv')], { encoding: 'utf8' }));
assert.deepEqual(merged.streams.map(s => s.codec_type).sort(), ['audio', 'video']);
console.log('PASS: separate video + audio streams merged without transcoding');
const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': fixture.length }); res.end(fixture); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  for (const options of [{ mode: 'video', quality: 'best' }, ...['best', 'mp3', 'm4a', 'flac', 'wav'].map(audioFormat => ({ mode: 'audio', audioFormat }))]) {
    const args = downloadArgs({ url: 'https://youtu.be/local-test', options }, folder);
    // Only this isolated test replaces the validated URL with a generated local fixture.
    args[args.length - 1] = `http://127.0.0.1:${server.address().port}/fixture.mp4`;
    const child = spawn(path.resolve('vendor/yt-dlp'), ['--ignore-config', '--no-plugin-dirs', '--ffmpeg-location', ffmpeg, ...args]);
    let stdout = '', stderr = '';
    child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    assert.equal(code, 0, stderr);
    const metadata = JSON.parse(stdout.split('\n').find(l => l.startsWith('__META__')).slice(8));
    assert.ok(metadata.title, 'Expected metadata from the download pass');
    const file = JSON.parse(stdout.split('\n').find(l => l.startsWith('__FILE__')).slice(8));
    assert.ok(existsSync(file));
    assert.ok(stdout.split('\n').some(l => parseProgress(l)), 'Expected machine-readable live progress');
    const info = JSON.parse(execFileSync('vendor/ffprobe', ['-v', 'quiet', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }));
    assert.ok(Number(info.format.duration) >= 1.9);
    if (options.mode === 'audio') { assert.ok(info.streams.every(s => s.codec_type === 'audio')); if (options.audioFormat === 'mp3') assert.equal(info.streams[0].codec_name, 'mp3'); }
    else assert.ok(info.streams.some(s => s.codec_type === 'video'));
    console.log(`PASS: ${options.mode} ${options.audioFormat || 'best'} → verified ${path.basename(file)}`);
  }
} finally { server.close(); }
