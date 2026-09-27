# Verification — 2026-09-27

Host: Apple Silicon, macOS 26.6.2.

- Seven automated core tests passed: supported and malicious URLs, option sanitization, best quality, capped quality, audio extraction, and progress parsing.
- Real Electron UI checks passed: launch, audio/video controls, rejected URL, saved settings, library navigation, minimum window width, and renderer isolation.
- Real media pipeline checks passed for original video and original audio, MP3, M4A, FLAC, and WAV. Tests generate a local fixture, download it through the bundled yt-dlp executable, and inspect the output with bundled FFprobe.
- Separate video and audio streams were merged without transcoding and verified with FFprobe.
- A real public TikTok video was downloaded through the app, followed by its MP3 audio. FFprobe verified both files. The library screenshot shows those actual completed jobs.
- A public YouTube test request was blocked by YouTube's “sign in to confirm you're not a bot” response on this network. A successful live YouTube download is **not** claimed. The error is surfaced, and opt-in browser-session support is available. No private browser cookies were accessed during testing.
- The app was packaged for ARM64, ad-hoc signed, and passed deep strict code-signature verification outside the iCloud-synced source folder. macOS 13 is the declared minimum; older macOS versions and Intel builds have not been exercised on this host.
- Runtime FFmpeg and FFprobe dependencies were checked: only macOS system libraries/frameworks, no Homebrew libraries.
- Dependency audit reported zero known vulnerabilities after updating the build tools.

Tests use temporary data directories. The installed application starts with an empty personal library. Real downloaded media used in verification is not included in the repository or release.
