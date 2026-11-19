# Demo video

`demo.mp4` (35 s): submit feedback → RECEIVED/ANALYZING → DONE → detail (sentiment, feature requests with
confidence, actionable insight, attempts) → resubmit the same text (duplicate notice).

Made with `record.mjs`: Playwright drives the real app against local Ollama (`qwen2.5:7b-instruct`) and records it.
An injected cursor glides between targets, typing runs at human speed, and captions are drawn into the page. ffmpeg
then converts the WebM to H.264 MP4. Playwright is not a project dependency, so install it in a scratch folder first:

```bash
npm run web:build && PORT=3100 DB_PATH=$(mktemp -d)/demo.db npm run dev     # fresh DB, or the first submit is a duplicate
node docs/demo/record.mjs http://localhost:3100 /tmp/demo-out              # set CHROME_EXE to a Chromium binary
ffmpeg -i /tmp/demo-out/*.webm -c:v libx264 -crf 28 -pix_fmt yuv420p -movflags +faststart docs/demo/demo.mp4
```
