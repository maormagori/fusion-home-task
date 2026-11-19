# Demo video

`demo.mp4` (35 s): submit feedback → RECEIVED/ANALYZING → DONE → detail (sentiment, feature requests with
confidence, actionable insight, attempts) → resubmit the same text (duplicate notice).

Made with `record.mjs`: Playwright drives the real app against local Ollama (`qwen2.5:7b-instruct`) and records it.
An injected cursor glides between targets, typing runs at human speed, and captions are drawn into the page. ffmpeg
then converts the WebM to H.264 MP4. Playwright is not a project dependency, so install it in a scratch folder first:

```bash
npm run web:build && PORT=3100 DB_PATH=$(mktemp -d)/demo.db npm run dev     # fresh DB, or the first submit is a duplicate
node docs/demo/record.mjs http://localhost:3100 /tmp/demo-out              # set CHROME_EXE to a Chromium binary
ffmpeg -i /tmp/demo-out/*.webm -c:v libx264 -crf 28 -pix_fmt yuv420p -movflags +faststart /tmp/silent.mp4
```

Background music: the first 35 s of "Carefree" by Kevin MacLeod (incompetech.com), mixed in with a fade-out:

```bash
curl -L -o /tmp/carefree.mp3 https://incompetech.com/music/royalty-free/mp3-royaltyfree/Carefree.mp3
ffmpeg -i /tmp/silent.mp4 -i /tmp/carefree.mp3 -filter_complex \
  "[1:a]atrim=0:35,volume=1.0,afade=t=in:d=0.5,afade=t=out:st=32:d=3[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 128k -shortest -movflags +faststart docs/demo/demo.mp4
```

## Music credit

"Carefree" Kevin MacLeod (incompetech.com)
Licensed under Creative Commons: By Attribution 4.0 License
http://creativecommons.org/licenses/by/4.0/
