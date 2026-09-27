import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const data = await mkdtemp(path.join(os.tmpdir(), 'anyloader-live-'));
const downloads = path.join(data, 'downloads');
await mkdir(downloads);
await writeFile(path.join(data, 'library.json'), JSON.stringify({ jobs: [], settings: { folder: downloads, notifications: false } }));
const application = process.env.ANYLOADER_APP;
const app = await electron.launch(application ? { executablePath: application, args: [`--data-dir=${data}`] } : { args: ['.', `--data-dir=${data}`] });
const url = process.env.TEST_URL || 'https://www.tiktok.com/@patroxofficial/video/6742501081818877190';
try {
  const page = await app.firstWindow();
  await page.waitForSelector('#engine-status:text("Engine ready")');
  for (const mode of ['video', 'audio']) {
    await page.locator(`[data-mode="${mode}"]`).click();
    if (mode === 'audio') await page.locator('#audio-format').selectOption('mp3');
    await page.locator('#url').fill(url);
    await page.locator('#download-button').click();
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const current = await page.evaluate(() => window.anyloader.state());
      if (current.jobs.some(j => j.options.mode === mode && ['completed', 'failed'].includes(j.status)) || await page.locator('#link-error').isVisible()) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.equal(await page.locator('#link-error').isVisible(), false, await page.locator('#link-error').textContent());
    const state = await page.evaluate(() => window.anyloader.state());
    const job = state.jobs.find(j => j.options.mode === mode);
    assert.ok(job, 'Expected the download to enter the queue');
    assert.equal(job.status, 'completed', job.error);
    const info = JSON.parse(execFileSync('vendor/ffprobe', ['-v', 'quiet', '-show_streams', '-of', 'json', job.file], { encoding: 'utf8' }));
    assert.ok(info.streams.some(s => s.codec_type === 'audio'));
    if (mode === 'video') assert.ok(info.streams.some(s => s.codec_type === 'video'));
    else assert.ok(info.streams.every(s => s.codec_type === 'audio'));
    console.log(`PASS live ${mode}: ${job.title} (${job.size} bytes)`);
  }
  await page.locator('[data-page="library"]').click();
  await page.waitForTimeout(500);
  await page.evaluate(() => { document.querySelector('#toast').hidden = true; });
  await page.screenshot({ path: 'docs/screenshots/library.png' });
  console.log(`Live test files: ${downloads}`);
} finally { await app.close(); }
