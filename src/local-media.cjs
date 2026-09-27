const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function timestamp(value, fallback = null) {
  if (value === '' || value === undefined || value === null) return fallback;
  const text = String(value).trim();
  if (!/^\d+(?::[0-5]?\d){0,2}(?:\.\d{1,3})?$/.test(text)) throw new Error('Use seconds or a time such as 0:12.500.');
  const seconds = text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
  if (!Number.isFinite(seconds) || seconds > 604800) throw new Error('That time is outside the supported range.');
  return seconds;
}
function audioOptions(input = {}) {
  if (!['wav', 'mp3', 'm4a', 'flac'].includes(input.format)) throw new Error('Choose WAV, MP3, M4A, or FLAC.');
  const start = timestamp(input.start, 0), end = timestamp(input.end);
  if (end !== null && end <= start) throw new Error('The end time must be after the start time.');
  return { format: input.format, start, end };
}
function runTool(executable, args, signal, onLine = () => {}, timeout = 0) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled'));
    const child = spawn(executable, args, { shell: false });
    let output = '', errors = '', buffer = '', killTimer, timer;
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    const stop = () => { child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 2000); };
    signal?.addEventListener('abort', stop, { once: true });
    if (timeout) timer = setTimeout(stop, timeout);
    child.stdout.on('data', data => {
      output = (output + data).slice(-5_000_000);
      buffer += data; const lines = buffer.split(/\r?\n/); buffer = lines.pop(); lines.forEach(onLine);
    });
    child.stderr.on('data', data => { errors = (errors + data).slice(-8000); });
    const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', stop); };
    child.on('error', error => { cleanup(); reject(error); });
    child.on('close', code => {
      cleanup();
      if (signal?.aborted) return reject(new Error('Cancelled'));
      if (code !== 0) return reject(new Error(errors.trim() || 'The media tool could not read this file.'));
      resolve(output);
    });
  });
}
async function probeMedia(binDir, file, signal) {
  if (!file || !path.isAbsolute(file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('The original video was moved or deleted. Restore it and try again.');
  const output = await runTool(path.join(binDir, 'ffprobe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], signal, undefined, 30000);
  return JSON.parse(output);
}
function audioArgs(file, output, options) {
  const codecs = {
    wav: ['-c:a', 'pcm_s24le', '-ar', '48000'],
    mp3: ['-c:a', 'libmp3lame', '-q:a', '0'],
    m4a: ['-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart'],
    flac: ['-c:a', 'flac']
  };
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', file];
  if (options.start) args.push('-ss', String(options.start));
  if (options.end !== null) args.push('-t', String(options.end - options.start));
  return [...args, '-map', '0:a:0', '-vn', '-map_metadata', '-1', ...codecs[options.format], '-progress', 'pipe:1', '-nostats', output];
}
async function extractAudio({ binDir, job, signal, onProgress }) {
  const options = audioOptions(job.extraction);
  const info = await probeMedia(binDir, job.sourceFile, signal);
  if (!(info.streams || []).some(stream => stream.codec_type === 'audio')) throw new Error('This video has no audio track to extract.');
  const duration = Number(info.format?.duration) || job.duration || 0;
  if (duration && options.start >= duration) throw new Error('The start time is beyond the end of this video.');
  if (duration && options.end !== null && options.end > duration + 0.05) throw new Error('The end time is beyond the end of this video.');
  const length = (options.end ?? duration) - options.start;
  const stem = path.basename(job.sourceFile, path.extname(job.sourceFile)).slice(0, 70);
  const clip = options.start || options.end !== null ? ` ${options.start}-${options.end ?? 'end'}s` : '';
  const output = path.join(job.folder, `${stem} [audio-${options.format}${clip}] ${job.id.slice(0, 8)}.${options.format}`);
  const temporary = path.join(job.folder, `.anyloader-${job.id}.part.${options.format}`);
  fs.mkdirSync(job.folder, { recursive: true });
  try {
    await runTool(path.join(binDir, 'ffmpeg'), audioArgs(job.sourceFile, temporary, options), signal, line => {
      if (line.startsWith('out_time_us=')) {
        const seconds = Number(line.slice(12)) / 1e6;
        onProgress({ progress: length > 0 ? Math.min(99, seconds / length * 100) : 0, stage: 'Extracting audio', speed: 0 });
      }
    });
    if (signal.aborted) throw new Error('Cancelled');
    // Exclusive publication: an existing file, including the original, is never overwritten.
    fs.copyFileSync(temporary, output, fs.constants.COPYFILE_EXCL);
    return { file: output, duration: length > 0 ? length : duration, size: fs.statSync(output).size };
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
module.exports = { timestamp, audioOptions, audioArgs, probeMedia, extractAudio };
