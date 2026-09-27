import { packager } from '@electron/packager';
import sharp from 'sharp';
import { mkdir, access, mkdtemp, cp, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
for (const tool of ['yt-dlp', 'ffmpeg', 'ffprobe', 'deno']) await access(`vendor/${tool}`);
await mkdir('assets/AnyLoader.iconset', { recursive: true });
for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) await sharp('assets/icon.svg').resize(size * scale).png().toFile(`assets/AnyLoader.iconset/icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`);
await sharp('assets/icon.svg').resize(1024).png().toFile('assets/icon.png');
execFileSync('iconutil', ['-c', 'icns', 'assets/AnyLoader.iconset', '-o', 'assets/icon.icns']);
// Sign outside synced folders: File Provider can reattach FinderInfo during signing.
const stageRoot = await mkdtemp(path.join(os.tmpdir(), 'anyloader-package-'));
await mkdir('dist', { recursive: true });
const paths = await packager({ dir: '.', out: stageRoot, name: 'AnyLoader', executableName: 'AnyLoader', platform: 'darwin', arch: process.arch, icon: 'assets/icon.icns', appBundleId: 'com.alexandr-shalanin.anyloader', appCategoryType: 'public.app-category.utilities', appCopyright: 'Copyright © 2026 alexandr-shalanin', overwrite: true, asar: true, prune: true, extraResource: ['vendor'], ignore: [/^\/dist($|\/)/, /^\/test($|\/)/, /^\/test-results($|\/)/, /^\/\.runtime($|\/)/, /^\/docs($|\/)/, /^\/scripts($|\/)/, /^\/vendor($|\/)/, /^\/assets\/AnyLoader.iconset/, /^\/\.github($|\/)/, /^\/node_modules($|\/)/], extendInfo: { NSHighResolutionCapable: true, LSMinimumSystemVersion: '13.0', NSHumanReadableCopyright: 'Copyright © 2026 alexandr-shalanin' } });
for (const folder of paths) {
  const app = `${folder}/AnyLoader.app`;
  execFileSync('xattr', ['-cr', app]);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  const zip = `dist/AnyLoader-1.0.0-mac-${process.arch}.zip`;
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
  await cp(folder, `dist/${path.basename(folder)}`, { recursive: true, force: true });
  await writeFile('dist/build.json', JSON.stringify({ app, zip: path.resolve(zip), arch: process.arch }, null, 2));
  console.log(`Ready: ${app}\nZIP: ${zip}`);
}
