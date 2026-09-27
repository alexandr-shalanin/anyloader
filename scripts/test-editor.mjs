import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const folder = await mkdtemp(path.join(os.tmpdir(), 'anyloader-editor-'));
const source = path.join(folder, 'Generated audio test clip.mp4');
const silent = path.join(folder, 'Silent clip.mp4');
const out = path.join(folder, 'exports'); await mkdir(out);
execFileSync('vendor/ffmpeg', ['-v', 'error', '-filter_complex', 'testsrc=size=320x180:rate=24[v];sine=frequency=440:sample_rate=44100[a]', '-map', '[v]', '-map', '[a]', '-t', '4', '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'aac', source]);
execFileSync('vendor/ffmpeg', ['-v', 'error', '-i', source, '-an', '-c:v', 'copy', silent]);
const digest = file => readFile(file).then(data => createHash('sha256').update(data).digest('hex'));
const originalHash = await digest(source);
const sourceJob = { id: 'source', title: 'Generated test clip · 4 seconds', platform: 'Local test fixture', file: source, duration: 4, status: 'completed', options: { mode: 'video', container: 'mp4', quality: 'best', audioFormat: 'best' }, progress: 100, createdAt: Date.now() };
await writeFile(path.join(folder, 'library.json'), JSON.stringify({ jobs: [sourceJob, { ...sourceJob, id: 'silent', title: 'Silent test clip', file: silent }, { ...sourceJob, id: 'missing', title: 'Missing clip', file: path.join(folder, 'missing.mp4') }], settings: { folder: out, notifications: false } }));
const application = process.env.ANYLOADER_APP;
const app = await electron.launch(application ? { executablePath: application, args: [`--data-dir=${folder}`] } : { args: ['.', `--data-dir=${folder}`] });
async function waitForJob(page, id) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const job = (await page.evaluate(() => window.anyloader.state())).jobs.find(j => j.id === id);
    if (job && ['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${id}`);
}
try {
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.waitForSelector('#engine-status:text("Engine ready")');
  await page.locator('[data-page="library"]').click();
  await page.locator('#library-list [data-id="source"][data-extract]').click();
  await page.locator('#extract-dialog').waitFor({ state: 'visible' });
  await page.locator('#extract-start').fill('0:01'); await page.locator('#extract-end').fill('0:02');
  await page.screenshot({ path: 'docs/screenshots/extract-audio.png' });
  await page.locator('#extract-submit').click();
  await page.locator('#extract-dialog').waitFor({ state: 'hidden' });
  let current = await page.evaluate(() => window.anyloader.state());
  let extracted = await waitForJob(page, current.jobs.find(j => j.type === 'extraction').id);
  assert.equal(extracted.status, 'completed', extracted.error);
  const inspect = file => JSON.parse(execFileSync('vendor/ffprobe', ['-v', 'quiet', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }));
  const wav = inspect(extracted.file);
  assert.equal(wav.streams[0].codec_name, 'pcm_s24le'); assert.equal(wav.streams[0].sample_rate, '48000');
  assert.ok(Math.abs(Number(wav.format.duration) - 1) < 0.05);
  for (const format of ['mp3', 'm4a', 'flac']) {
    const id = await page.evaluate(format => window.anyloader.extractAudio('source', { format }), format);
    const job = await waitForJob(page, id); assert.equal(job.status, 'completed', job.error);
    const info = inspect(job.file); assert.ok(info.streams.every(s => s.codec_type === 'audio')); assert.ok(Number(info.format.duration) >= 3.9);
  }
  const silentId = await page.evaluate(() => window.anyloader.extractAudio('silent', { format: 'wav' }));
  assert.match((await waitForJob(page, silentId)).error, /no audio track/);
  await assert.rejects(page.evaluate(() => window.anyloader.extractAudio('missing', { format: 'wav' })), /moved or deleted/);
  const beyond = await page.evaluate(() => window.anyloader.extractAudio('source', { format: 'wav', start: '20' }));
  assert.match((await waitForJob(page, beyond)).error, /beyond the end/);
  const cancelled = await page.evaluate(async () => {
    const id = await window.anyloader.extractAudio('source', { format: 'wav' });
    await window.anyloader.action(id, 'cancel'); return id;
  });
  assert.equal((await waitForJob(page, cancelled)).status, 'cancelled');
  await page.locator('[data-id="source"][data-action="favorite"]').last().click();
  await page.locator('#library-filter').selectOption('favorite');
  assert.equal(await page.locator('#library-list .job').count(), 1);
  assert.equal(await digest(source), originalHash);
  // Cancel immediately: this checks instant queueing without needing successful network extraction.
  const queue = await page.evaluate(async () => {
    const started = performance.now();
    const result = await window.anyloader.enqueue('https://youtu.be/BaW_jenozKc\nhttps://youtu.be/jNQXAC9IVRw', { mode: 'video' });
    const elapsed = performance.now() - started;
    for (const id of result.ids) await window.anyloader.action(id, 'cancel');
    return { count: result.ids.length, elapsed };
  });
  assert.equal(queue.count, 2); assert.ok(queue.elapsed < 1500, `Queue latency ${queue.elapsed}ms`);
  assert.deepEqual(errors, []);
  console.log(`PASS: offline WAV/MP3/M4A/FLAC, accurate trim, source preservation, silent/missing files, range validation, cancellation, favorites, batch queue (${Math.round(queue.elapsed)} ms).`);
  console.log(`Test data: ${folder}`);
} finally { await app.close(); }
