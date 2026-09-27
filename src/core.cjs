const ALLOWED = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be', 'tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com']);
function validateURL(input) {
  if (typeof input !== 'string' || input.length > 4096) throw new Error('Paste a YouTube or TikTok link.');
  let url;
  try { url = new URL(input.trim()); } catch { throw new Error('That link is incomplete. Include https:// and try again.'); }
  if (!['https:', 'http:'].includes(url.protocol) || !ALLOWED.has(url.hostname) || url.username || url.password || url.port) throw new Error('AnyLoader supports YouTube and TikTok links only.');
  if (url.pathname === '/' && !url.searchParams.get('v')) throw new Error('Paste a link to a video, rather than a profile or homepage.');
  if (url.pathname.startsWith('/playlist')) throw new Error('Please use an individual video link. Playlist downloads are not supported.');
  url.protocol = 'https:'; url.hash = '';
  for (const key of ['list', 'index', 'si', 'feature', 't']) url.searchParams.delete(key);
  return url.href;
}
function validateOptions(value = {}) {
  return {
    mode: value.mode === 'audio' ? 'audio' : 'video',
    quality: ['best', '2160', '1440', '1080', '720', '480'].includes(value.quality) ? value.quality : 'best',
    container: ['mkv', 'mp4'].includes(value.container) ? value.container : 'mkv',
    audioFormat: ['best', 'mp3', 'm4a', 'flac', 'wav'].includes(value.audioFormat) ? value.audioFormat : 'best'
  };
}
function downloadArgs(job, folder) {
  const o = validateOptions(job.options);
  const args = ['--newline', '--progress', '--no-simulate', '--no-playlist', '--match-filter', '!is_live', '--continue', '--no-overwrites', '--windows-filenames', '--trim-filenames', '180', '--paths', folder,
    '--print', 'before_dl:__META__{"title":%(title|null)j,"author":%(uploader|null)j,"duration":%(duration|null)j,"thumbnail":%(thumbnail|null)j,"height":%(height|null)j}',
    '--output', `%(title).120B [%(id)s] [${o.mode === 'audio' ? `audio-${o.audioFormat}` : `video-${o.quality}-${o.container}`}].%(ext)s`, '--progress-template', 'download:__PROGRESS__%(progress)j', '--print', 'after_move:__FILE__%(filepath)j'];
  if (o.mode === 'audio') args.push('-f', 'bestaudio/best', '--extract-audio', '--audio-format', o.audioFormat, '--audio-quality', '0');
  else {
    const cap = o.quality === 'best' ? '' : `[height<=${o.quality}]`;
    // MKV preserves the best source codecs. MP4 prefers widely playable H.264/AAC.
    const format = o.container === 'mp4'
      ? `bestvideo${cap}[ext=mp4][vcodec~='^(avc1|h264)']+bestaudio[acodec~='^(mp4a|aac)']/best${cap}[ext=mp4][vcodec~='^(avc1|h264)'][acodec~='^(mp4a|aac)']`
      : `bestvideo${cap}+bestaudio/best${cap}`;
    args.push('-f', format, '--merge-output-format', o.container);
    if (o.container === 'mp4') args.push('--remux-video', 'mp4');
  }
  return [...args, '--', validateURL(job.url)];
}
function parseProgress(line) {
  if (!line.startsWith('__PROGRESS__')) return null;
  try {
    const p = JSON.parse(line.slice(12));
    const total = Number(p.total_bytes || p.total_bytes_estimate || 0);
    return { progress: total ? Math.min(100, Number(p.downloaded_bytes || 0) / total * 100) : 0, bytes: Number(p.downloaded_bytes || 0), total, speed: Number(p.speed || 0), eta: Number(p.eta || 0), stage: p.status === 'finished' ? 'Processing media' : 'Downloading' };
  } catch { return null; }
}
module.exports = { validateURL, validateOptions, downloadArgs, parseProgress };
