const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateURL, validateOptions, downloadArgs, parseProgress } = require('../src/core.cjs');
test('accepts supported links and removes playlist/tracking context', () => {
  assert.equal(validateURL('http://www.youtube.com/watch?v=abc&list=xyz&si=123'), 'https://www.youtube.com/watch?v=abc');
  assert.equal(validateURL('https://vm.tiktok.com/abc/'), 'https://vm.tiktok.com/abc/');
  assert.equal(validateURL('https://www.tiktok.com/@creator/video/123'), 'https://www.tiktok.com/@creator/video/123');
});
test('rejects local, deceptive, credentialed, unsupported and playlist URLs', () => {
  for (const url of ['file:///etc/passwd', 'https://youtube.com.evil.test/watch?v=1', 'https://youtube.com@evil.test/video', 'https://u:p@youtube.com/watch?v=1', 'https://localhost/a', 'https://youtube.com:9999/watch?v=1', 'https://youtube.com/', 'https://youtube.com/playlist?list=x', '--exec=evil', null]) assert.throws(() => validateURL(url));
});
test('best quality has no resolution cap and preserves original streams', () => {
  const args = downloadArgs({ url: 'https://youtu.be/test', options: {} }, '/tmp/downloads');
  assert.equal(args[args.indexOf('-f') + 1], 'bestvideo+bestaudio/best');
  assert.equal(args[args.indexOf('--merge-output-format') + 1], 'mkv');
  assert.equal(args.at(-2), '--');
});
test('caps both separate and combined streams', () => {
  const args = downloadArgs({ url: 'https://youtu.be/test', options: { quality: '1080' } }, '/tmp/downloads');
  assert.equal(args[args.indexOf('-f') + 1], 'bestvideo[height<=1080]+bestaudio/best[height<=1080]');
});
test('audio extraction requests best source and explicit format', () => {
  const args = downloadArgs({ url: 'https://youtu.be/test', options: { mode: 'audio', audioFormat: 'mp3' } }, '/tmp/downloads');
  assert.ok(args.includes('--extract-audio')); assert.equal(args[args.indexOf('--audio-format') + 1], 'mp3'); assert.ok(!args.includes('--merge-output-format'));
});
test('editing MP4 never falls back to an incompatible codec', () => {
  const args = downloadArgs({ url: 'https://youtu.be/test', options: { container: 'mp4' } }, '/tmp');
  const choices = args[args.indexOf('-f') + 1].split('/');
  assert.ok(choices.every(choice => choice.includes("vcodec~='^(avc1|h264)'") && choice.includes("acodec~='^(mp4a|aac)'")));
  assert.ok(args.includes('--remux-video'));
  assert.ok(args.includes('--no-simulate'));
  assert.ok(args.some(arg => arg.startsWith('before_dl:__META__')));
});
test('untrusted options never become executable arguments', () => { assert.deepEqual(validateOptions({ mode: '--exec', quality: '9999;rm', container: '../../bad', audioFormat: '--exec' }), { mode: 'video', quality: 'best', container: 'mkv', audioFormat: 'best' }); });
test('parses progress including unknown size, completion and malformed data', () => {
  assert.equal(parseProgress('__PROGRESS__{"downloaded_bytes":50,"total_bytes":100,"speed":25}').progress, 50);
  assert.equal(parseProgress('__PROGRESS__{"downloaded_bytes":50}').progress, 0);
  assert.equal(parseProgress('__PROGRESS__{"status":"finished"}').stage, 'Processing media');
  assert.equal(parseProgress('__PROGRESS__broken'), null); assert.equal(parseProgress('random line'), null);
});
