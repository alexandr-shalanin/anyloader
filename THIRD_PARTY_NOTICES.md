# Third-party components

AnyLoader is MIT licensed. Bundled programs are separate executables and keep their original licenses.

| Component | License / source |
| --- | --- |
| Electron | MIT; Chromium and Node notices are included in Electron's distribution. [Source](https://github.com/electron/electron) |
| yt-dlp | Unlicense, plus dependencies in the official standalone binary. The official release contains its dependency notices. [Source and license details](https://github.com/yt-dlp/yt-dlp#license) |
| FFmpeg 8.0.3 | LGPL 2.1 or later, built without GPL/nonfree features. [Source](https://ffmpeg.org/releases/ffmpeg-8.0.3.tar.xz) |
| LAME 3.100 | LGPL 2.0 or later. [Source](https://downloads.sourceforge.net/project/lame/lame/3.100/lame-3.100.tar.gz) |
| Deno | MIT, with third-party components. [Source](https://github.com/denoland/deno) |

The packaged app includes FFmpeg and LAME's exact unmodified source archives in `Contents/Resources/vendor/sources`, along with SHA-256 hashes and FFmpeg's configure arguments in `manifest.json`. Build instructions are in `scripts/build-media.mjs` in this repository. Both tools can be rebuilt and replaced by the user; there is no application integrity check preventing replacement. Re-sign a locally modified app with an ad-hoc signature if required by macOS.

The media build uses static LGPL libraries. Corresponding sources and configuration are supplied to allow modification and relinking. No proprietary media library is linked into AnyLoader.
