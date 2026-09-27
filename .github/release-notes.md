AnyLoader 1.1 — ready for your next edit.

- Extract audio from saved library videos, entirely offline: WAV (48 kHz / 24-bit), MP3, M4A, and FLAC.
- Optional start/end times for exporting just the sound you need. Original videos remain untouched.
- Favorites and an Extracted audio library filter for reusable editing assets.
- Paste up to 20 links, queue immediately, and receive metadata in the same download pass.
- Balanced/fast/conservative fragment concurrency, retries with backoff, and idle-sleep protection during work. Actual throughput depends on the source and network.
- Editing MP4 explicitly selects H.264/AAC and reports unavailable formats instead of silently substituting other codecs.
- Remembered format choices and less frequent progress redraws.
- A standalone Apple Silicon app with yt-dlp, FFmpeg, FFprobe, and Deno bundled.

## Install

Download `AnyLoader-1.1.0-mac-arm64.zip`, unzip, and drag **AnyLoader.app** to Applications. Requires an Apple Silicon Mac running macOS 13 or later. Existing history and settings are preserved.

This release is ad-hoc signed, not Developer ID signed or notarized. If macOS blocks the first launch, use **System Settings → Privacy & Security → Open Anyway** for this trusted download.

Best quality means the highest quality the source makes available. YouTube or TikTok can require a signed-in browser or restrict access; optional browser-session support is in Settings. Playlists, channels, live broadcasts, and DRM-protected media are not supported.

The source repository includes real application screenshots, setup instructions, tests, and third-party notices. Corresponding FFmpeg/LAME sources are bundled in the app.
