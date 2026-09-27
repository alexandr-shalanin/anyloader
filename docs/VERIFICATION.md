# Verification — 2026-09-27

Host: Apple Silicon, macOS 26.6.2.

- Eleven automated tests passed: supported and malicious URLs, option sanitization, best/capped quality, strict H.264/AAC MP4 selection, progress parsing, export formats, and time-range validation.
- Real Electron UI checks passed: launch, audio/video controls, rejected URL, saved settings, library navigation, minimum window width, and renderer isolation.
- Real media pipeline checks passed for original video and original audio, MP3, M4A, FLAC, and WAV. Tests generate a local fixture, download it through the bundled yt-dlp executable, and inspect the output with bundled FFprobe.
- Separate video and audio streams were merged without transcoding and verified with FFprobe.
- Offline editor checks passed with real generated media: WAV (48 kHz / 24-bit), MP3, M4A, FLAC, an accurate one-second trim, cancellation, missing/silent-file errors, invalid ranges, favorites, and batch queueing. The original video's SHA-256 hash was unchanged after exports.
- Two links entered the queue in 3 ms in development and 7 ms in the packaged app, without a metadata preflight. This measures queue latency, **not** transfer throughput. Fragment concurrency is configurable (1/4/8); no before/after network-speed multiplier has been established.
- A real public TikTok video was downloaded through the app with Editing MP4, followed by its MP3 audio. FFprobe verified H.264/AAC video and audio-only MP3; titles arrived during the same download pass. The library screenshot shows those actual completed jobs. Codec aliases and absent metadata are covered by regression checks.
- A public YouTube test request was blocked by YouTube's “sign in to confirm you're not a bot” response on this network. A successful live YouTube download is **not** claimed. The error is surfaced, and opt-in browser-session support is available. No private browser cookies were accessed during testing.
- The app was packaged for ARM64, ad-hoc signed, and passed deep strict code-signature verification outside the iCloud-synced source folder. macOS 13 is the declared minimum; older macOS versions and Intel builds have not been exercised on this host.
- The full offline-editor and UI checks were also run against the packaged v1.1.0 executable, not just the development app.
- Runtime FFmpeg and FFprobe dependencies were checked: only macOS system libraries/frameworks, no Homebrew libraries.
- Dependency audit reported zero known vulnerabilities after updating the build tools.

Tests use temporary data directories and do not modify the user's personal library. The audio-export screenshot uses a real generated four-second fixture; downloaded or generated test media is not included in the repository or release.
