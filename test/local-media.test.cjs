const { test } = require('node:test');
const assert = require('node:assert/strict');
const { timestamp, audioOptions, audioArgs } = require('../src/local-media.cjs');
test('clip timestamps accept decimal seconds and clock times', () => {
  assert.equal(timestamp('1:02.500'), 62.5);
  assert.equal(timestamp('1:02:03'), 3723);
  assert.equal(timestamp('12.25'), 12.25);
  assert.equal(timestamp(''), null);
  for (const value of ['-1', '1:99', 'NaN', '--exec', 'Infinity']) assert.throws(() => timestamp(value));
});
test('audio exports reject unsupported formats and reversed ranges', () => {
  assert.throws(() => audioOptions({ format: '../oops' }));
  assert.throws(() => audioOptions({ format: 'wav', start: '10', end: '9' }));
  assert.deepEqual(audioOptions({ format: 'wav' }), { format: 'wav', start: 0, end: null });
});
test('editing WAV uses accurate output-side trim, first audio stream and no overwrite', () => {
  const args = audioArgs('/tmp/source.mp4', '/tmp/output.wav', audioOptions({ format: 'wav', start: '1', end: '3' }));
  assert.ok(args.indexOf('-ss') > args.indexOf('-i'));
  assert.equal(args[args.indexOf('-t') + 1], '2');
  assert.equal(args[args.indexOf('-map') + 1], '0:a:0');
  assert.ok(args.includes('pcm_s24le')); assert.ok(args.includes('48000')); assert.ok(args.includes('-n'));
  assert.ok(!args.includes('-y'));
});
