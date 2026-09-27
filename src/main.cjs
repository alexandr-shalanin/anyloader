const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu, Notification, nativeImage, powerSaveBlocker } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { validateURL, validateOptions, downloadArgs, parseProgress } = require('./core.cjs');
const { audioOptions, extractAudio } = require('./local-media.cjs');
app.setName('AnyLoader');
const customData = process.argv.find(a => a.startsWith('--data-dir='))?.slice(11);
if (customData) app.setPath('userData', path.resolve(customData));
let win, store, saveTimer, emitTimer, sleepBlocker, quitting = false;
const running = new Map(), probes = new Set(), metadataCache = new Map();
const binDir = app.isPackaged ? path.join(process.resourcesPath, 'vendor') : path.join(__dirname, '../vendor');
const storePath = () => path.join(app.getPath('userData'), 'library.json');
const rendererURL = pathToFileURL(path.join(__dirname, 'renderer/index.html')).href;
function save() {
  clearTimeout(saveTimer);
  saveTimer = null;
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(`${storePath()}.tmp`, JSON.stringify(store, null, 2));
  fs.renameSync(`${storePath()}.tmp`, storePath());
}
function publish() {
  emitTimer = null;
  if (win && !win.isDestroyed()) win.webContents.send('state', snapshot());
  app.dock?.setBadge(running.size ? String(running.size) : '');
  const active = store.jobs.filter(j => running.has(j.id));
  win?.setProgressBar(active.length ? active.reduce((s, j) => s + j.progress / 100, 0) / active.length : -1);
  if (running.size && sleepBlocker === undefined) sleepBlocker = powerSaveBlocker.start('prevent-app-suspension');
  if (!running.size && sleepBlocker !== undefined) { powerSaveBlocker.stop(sleepBlocker); sleepBlocker = undefined; }
}
function emit(immediate = true) {
  if (immediate) { clearTimeout(emitTimer); publish(); }
  else if (!emitTimer) emitTimer = setTimeout(publish, 200);
  if (!saveTimer) saveTimer = setTimeout(save, 2000);
}
function snapshot() { return { ...store, engine: ['yt-dlp', 'ffmpeg', 'ffprobe', 'deno'].every(tool => fs.existsSync(path.join(binDir, tool))), version: app.getVersion(), toolVersion: (() => { try { return JSON.parse(fs.readFileSync(path.join(binDir, 'versions.json'))).ytDlp; } catch { return 'unavailable'; } })() }; }
function baseArgs() {
  const args = ['--ignore-config', '--no-plugin-dirs', '--no-playlist', '--socket-timeout', '25', '--retries', '10', '--fragment-retries', '10', '--retry-sleep', 'http:exp=1:10', '--retry-sleep', 'fragment:exp=1:10', '--concurrent-fragments', String(store.settings.fragments || 4), '--ffmpeg-location', path.join(binDir, 'ffmpeg'), '--js-runtimes', `deno:${path.join(binDir, 'deno')}`];
  if (['chrome', 'firefox', 'safari', 'edge'].includes(store.settings.cookies)) args.push('--cookies-from-browser', store.settings.cookies);
  return args;
}
function launch(args) {
  const child = spawn(path.join(binDir, 'yt-dlp'), args, { shell: false, detached: true, env: { ...process.env, PATH: `${binDir}:/usr/bin:/bin`, DENO_DIR: path.join(app.getPath('userData'), 'deno-cache') } });
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  return child;
}
function terminate(child) {
  if (child.cancel) return child.cancel();
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 2000);
  child.once('close', () => clearTimeout(timer));
}
function readableError(raw) {
  const text = raw.replace(/\x1b\[[0-9;]*m/g, '').trim();
  const errors = text.split('\n').filter(s => /ERROR:/.test(s));
  return (errors.at(-1) || text || 'The download could not be completed. Please try again.').replace(/^ERROR:\s*/, '').slice(-1400);
}
async function inspect(input) {
  const url = validateURL(input);
  const cacheKey = `${store.settings.cookies}:${url}`;
  const cached = metadataCache.get(cacheKey);
  if (cached && Date.now() - cached.time < 300000) return cached.info;
  if (probes.size >= 3) throw new Error('Please wait for the current link check to finish.');
  return new Promise((resolve, reject) => {
    const child = launch([...baseArgs(), '--dump-single-json', '--skip-download', '--', url]); probes.add(child);
    let out = '', err = '', expired = false;
    const timer = setTimeout(() => { expired = true; terminate(child); }, 90000);
    child.stdout.on('data', b => { out += b; if (out.length > 20_000_000) terminate(child); });
    child.stderr.on('data', b => { err = (err + b).slice(-16000); });
    child.on('error', e => { clearTimeout(timer); probes.delete(child); reject(new Error(`Download engine unavailable: ${e.message}. Run npm run setup.`)); });
    child.on('close', code => {
      clearTimeout(timer); probes.delete(child);
      if (code !== 0) return reject(new Error(expired ? 'This link took too long to respond. Check your connection and try again.' : readableError(err)));
      try {
        const info = JSON.parse(out);
        if (info._type === 'playlist' || info.entries) throw new Error('Please use a single video link.');
        if (info.is_live) throw new Error('This video is live. Try again once the broadcast has finished.');
        const result = { url, title: info.title || 'Untitled video', author: info.uploader || info.channel || '', duration: info.duration || 0, thumbnail: /^https:\/\//.test(info.thumbnail || '') ? info.thumbnail : '', platform: new URL(url).hostname.includes('youtu') ? 'YouTube' : 'TikTok', qualities: [...new Set((info.formats || []).map(f => f.height).filter(Boolean))].sort((a, b) => b - a), id: info.id };
        if (metadataCache.size >= 50) metadataCache.delete(metadataCache.keys().next().value);
        metadataCache.set(cacheKey, { info: result, time: Date.now() });
        resolve(result);
      } catch (e) { reject(e); }
    });
  });
}
function schedule() {
  if (quitting) return;
  while (running.size < store.settings.concurrent) {
    const job = store.jobs.findLast(j => j.status === 'queued');
    if (!job) break;
    try { startJob(job); } catch (error) { job.status = 'failed'; job.stage = 'Needs attention'; job.error = error.message; }
  }
  emit();
}
function startJob(job) {
  if (job.type === 'extraction') return startExtraction(job);
  job.status = 'downloading'; job.error = ''; job.stage = 'Connecting'; job.speed = 0;
  fs.mkdirSync(job.folder, { recursive: true });
  const child = launch([...baseArgs(), ...downloadArgs(job, job.folder)]);
  running.set(job.id, child);
  let buf = '', err = '', outputFile = '', ended = false;
  const line = text => {
    const progress = parseProgress(text);
    if (progress) Object.assign(job, progress);
    if (text.startsWith('__META__')) {
      try {
        const meta = JSON.parse(text.slice(8));
        job.title = String(meta.title || job.title);
        job.author = meta.author === 'NA' ? '' : String(meta.author || '');
        job.duration = Number(meta.duration) || 0;
        job.height = Number(meta.height) || 0;
        job.thumbnail = /^https:\/\//.test(meta.thumbnail || '') ? meta.thumbnail : '';
        job.stage = 'Downloading';
      } catch {}
    }
    if (text.startsWith('__FILE__')) { try { outputFile = JSON.parse(text.slice(8)); } catch {} }
    if (/\[(Merger|ExtractAudio|Metadata|VideoRemuxer)\]/.test(text)) job.stage = 'Processing media';
    emit(false);
  };
  child.stdout.on('data', data => { buf += data.toString(); const lines = buf.split(/\r?\n/); buf = lines.pop(); lines.forEach(line); });
  child.stderr.on('data', b => { err = (err + b).slice(-16000); });
  function finish(code, failure) {
    if (ended) return; ended = true;
    if (buf) line(buf);
    running.delete(job.id);
    if (job.status === 'downloading') {
      if (code === 0 && outputFile && fs.existsSync(outputFile)) {
        job.status = 'completed'; job.progress = 100; job.file = outputFile; job.completedAt = Date.now(); job.stage = 'Saved';
        job.size = fs.statSync(outputFile).size;
        if (store.settings.notifications && Notification.isSupported()) new Notification({ title: 'Your download is ready', body: job.title, silent: true }).show();
      } else {
        job.status = 'failed'; job.error = failure || readableError(err); job.stage = 'Needs attention';
        if (job.options.container === 'mp4' && /Requested format is not available/.test(job.error)) job.error = 'This video does not offer H.264/AAC at the selected quality. Choose Original quality or a different resolution and try again.';
      }
    }
    job.speed = 0; save(); schedule();
  }
  child.on('error', e => finish(-1, e.message)); child.on('close', code => finish(code));
}
function startExtraction(job) {
  job.status = 'downloading'; job.stage = 'Reading saved video'; job.error = ''; job.progress = 0;
  const controller = new AbortController();
  running.set(job.id, { cancel: () => controller.abort() });
  extractAudio({ binDir, job, signal: controller.signal, onProgress: progress => { Object.assign(job, progress); emit(false); } })
    .then(result => {
      if (job.status !== 'downloading') return;
      Object.assign(job, result, { status: 'completed', progress: 100, stage: 'Saved', completedAt: Date.now() });
      if (store.settings.notifications && Notification.isSupported()) new Notification({ title: 'Your audio is ready', body: job.title, silent: true }).show();
    })
    .catch(error => { if (job.status === 'downloading') Object.assign(job, { status: 'failed', stage: 'Needs attention', error: error.message }); })
    .finally(() => { running.delete(job.id); save(); schedule(); });
}
function handle(name, fn) { ipcMain.handle(name, async (event, ...args) => {
  if (event.sender !== win?.webContents || event.senderFrame.url !== rendererURL) throw new Error('Untrusted request.');
  try { return await fn(...args); } catch (e) { throw new Error(e.message); }
}); }
function registerIPC() {
  handle('state', snapshot);
  handle('clipboard', () => clipboard.readText().slice(0, 4096));
  handle('inspect', inspect);
  handle('enqueue', (input, options) => {
    if (typeof input !== 'string' || input.length > 82000) throw new Error('Paste up to 20 video links.');
    const lines = input.trim().split(/\s+/);
    if (lines.length > 20) throw new Error('Add up to 20 links at a time.');
    const urls = [...new Set(lines.map(validateURL))];
    const selected = validateOptions(options);
    if (quitting) throw new Error('AnyLoader is closing. Try again after reopening.');
    const ids = [];
    for (const url of urls) {
      if (store.jobs.some(j => j.type !== 'extraction' && j.url === url && ['queued', 'downloading', 'paused'].includes(j.status) && JSON.stringify(j.options) === JSON.stringify(selected))) continue;
      const cached = metadataCache.get(`${store.settings.cookies}:${url}`)?.info;
      const job = { url, title: cached?.title || 'Getting video details…', author: cached?.author || '', thumbnail: cached?.thumbnail || '', duration: cached?.duration || 0, platform: new URL(url).hostname.includes('youtu') ? 'YouTube' : 'TikTok', id: crypto.randomUUID(), options: selected, folder: store.settings.folder, status: 'queued', progress: 0, createdAt: Date.now(), stage: 'Waiting' };
      store.jobs.unshift(job); ids.push(job.id);
    }
    if (!ids.length) throw new Error('These downloads are already in your queue.');
    store.settings.defaultOptions = selected;
    save(); schedule(); return { ids, skipped: lines.length - ids.length };
  });
  handle('extract-audio', (id, input) => {
    const source = store.jobs.find(job => job.id === id);
    if (!source || source.status !== 'completed' || source.options.mode !== 'video') throw new Error('Choose a completed video in your library.');
    if (!source.file || !fs.existsSync(source.file)) throw new Error('The original video was moved or deleted. Restore it and try again.');
    const extraction = audioOptions(input);
    const pending = store.jobs.find(job => job.type === 'extraction' && job.parentId === id && ['queued', 'downloading', 'paused'].includes(job.status) && JSON.stringify(job.extraction) === JSON.stringify(extraction));
    if (pending) throw new Error('That audio export is already in your queue.');
    const job = { id: crypto.randomUUID(), type: 'extraction', parentId: id, sourceFile: source.file, url: source.url, title: source.title, author: source.author, thumbnail: source.thumbnail, duration: source.duration, platform: 'Local audio', extraction, options: { ...validateOptions(), mode: 'audio', audioFormat: extraction.format }, folder: store.settings.folder, status: 'queued', progress: 0, createdAt: Date.now(), stage: 'Waiting' };
    store.jobs.unshift(job); save(); schedule(); return job.id;
  });
  handle('action', (id, action) => {
    const job = store.jobs.find(j => j.id === id); if (!job) throw new Error('Download not found.');
    const child = running.get(id);
    if (action === 'favorite') { job.favorite = !job.favorite; save(); emit(); return snapshot(); }
    if (child && ['retry', 'remove'].includes(action)) throw new Error('The task is still stopping. Try again in a moment.');
    if (action === 'pause' && ['downloading', 'queued'].includes(job.status)) { job.status = 'paused'; job.stage = 'Paused'; if (child) terminate(child); }
    if (action === 'cancel' && ['queued', 'downloading', 'paused'].includes(job.status)) { job.status = 'cancelled'; job.stage = 'Cancelled'; if (child) terminate(child); }
    if (action === 'retry' && ['failed', 'cancelled', 'paused'].includes(job.status) && !child) { job.status = 'queued'; job.error = ''; job.stage = 'Waiting'; }
    if (action === 'remove' && !child && !['queued', 'downloading'].includes(job.status)) store.jobs = store.jobs.filter(j => j.id !== id);
    if (action === 'reveal' || action === 'open') {
      if (!job.file || !fs.existsSync(job.file)) throw new Error('The saved file has been moved or deleted.');
      if (action === 'reveal') shell.showItemInFolder(job.file);
      else return shell.openPath(job.file).then(error => { if (error) throw new Error(error); });
    }
    schedule(); return snapshot();
  });
  handle('choose-folder', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Save downloads to', defaultPath: store.settings.folder, properties: ['openDirectory', 'createDirectory'] });
    if (!result.canceled) { store.settings.folder = result.filePaths[0]; save(); emit(); }
    return snapshot();
  });
  handle('open-folder', async () => { fs.mkdirSync(store.settings.folder, { recursive: true }); const error = await shell.openPath(store.settings.folder); if (error) throw new Error(error); });
  handle('settings', value => {
    store.settings = { ...store.settings, fragments: [1, 4, 8].includes(value.fragments) ? value.fragments : store.settings.fragments, concurrent: [1, 2, 3].includes(value.concurrent) ? value.concurrent : store.settings.concurrent, notifications: typeof value.notifications === 'boolean' ? value.notifications : store.settings.notifications, cookies: ['none', 'chrome', 'firefox', 'safari', 'edge'].includes(value.cookies) ? value.cookies : store.settings.cookies, defaultOptions: validateOptions(value.defaultOptions || store.settings.defaultOptions) };
    save(); schedule(); return snapshot();
  });
  handle('clear-history', async () => {
    const r = await dialog.showMessageBox(win, { type: 'question', message: 'Clear finished download history?', detail: 'Your downloaded files will stay on your Mac.', buttons: ['Keep history', 'Clear history'], defaultId: 0, cancelId: 0 });
    if (r.response === 1) { store.jobs = store.jobs.filter(j => ['queued', 'downloading', 'paused'].includes(j.status)); save(); emit(); }
    return snapshot();
  });
}
function createWindow() {
  win = new BrowserWindow({ width: 1200, height: 840, minWidth: 960, minHeight: 720, title: 'AnyLoader', backgroundColor: '#f5f3eb', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 21, y: 22 }, show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_w, _p, callback) => callback(false));
  win.loadFile(path.join(__dirname, 'renderer/index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (!win) createWindow(); win.show(); win.focus(); });
  app.whenReady().then(() => {
    const defaults = { folder: path.join(app.getPath('downloads'), 'AnyLoader'), fragments: 4, concurrent: 2, notifications: true, cookies: 'none', defaultOptions: validateOptions() };
    try { store = JSON.parse(fs.readFileSync(storePath(), 'utf8')); if (!Array.isArray(store.jobs) || !store.settings) throw new Error('Invalid data'); store.settings = { ...defaults, ...store.settings }; }
    catch { if (fs.existsSync(storePath())) fs.copyFileSync(storePath(), `${storePath()}.recovery-${Date.now()}`); store = { settings: defaults, jobs: [] }; }
    for (const job of store.jobs) if (['downloading', 'queued'].includes(job.status)) { job.status = 'paused'; job.stage = 'Paused after restart'; }
    registerIPC(); createWindow();
    const icon = path.join(__dirname, '../assets/icon.png'); if (fs.existsSync(icon)) app.dock?.setIcon(nativeImage.createFromPath(icon));
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'AnyLoader', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => win?.webContents.send('navigate', 'settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
      { label: 'File', submenu: [{ label: 'New download', accelerator: 'CmdOrCtrl+N', click: () => { if (!win) createWindow(); win.show(); win.webContents.send('navigate', 'download'); } }, { label: 'Open downloads folder', accelerator: 'CmdOrCtrl+Shift+O', click: () => { fs.mkdirSync(store.settings.folder, { recursive: true }); shell.openPath(store.settings.folder); } }, { role: 'close' }] },
      { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }
    ]));
    app.on('activate', () => { if (!win) createWindow(); });
  });
  app.on('window-all-closed', () => {});
  app.on('before-quit', e => {
    if (!quitting && (running.size || probes.size)) {
      e.preventDefault(); quitting = true;
      for (const job of store.jobs) if (['downloading', 'queued'].includes(job.status)) { job.status = 'paused'; job.stage = 'Paused after quit'; }
      for (const child of [...running.values(), ...probes]) terminate(child);
      save(); setTimeout(() => app.quit(), 2300);
    } else { quitting = true; if (store) save(); }
  });
}
