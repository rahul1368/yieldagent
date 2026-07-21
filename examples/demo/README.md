# yieldagent demo

A single, self-contained `index.html` that shows the human-in-the-loop flow:
the agent runs, **pauses for your approval** before sending an email, and
resumes (or stops) based on what you click. It uses a simulated model, so it
needs no server and no API key.

## Run it locally

Just open the file:

```bash
open index.html        # macOS
# or double-click it, or serve the folder:
npx serve .
```

## Deploy it (GitHub Pages)

This file is also copied to `docs/index.html` at the repo root, which gives the
shortest possible Pages URL. To publish:

1. Push the repo to GitHub.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   pick branch `main` and folder **`/docs`**, then Save.
3. In ~1 minute the demo is live at `https://rahul1368.github.io/yieldagent/`.

If you edit this `examples/demo/index.html`, copy it over so the published
version stays in sync:

```bash
cp examples/demo/index.html docs/index.html
```

## Record the GIF for the README

The pause-and-approve moment is the whole pitch — a short GIF of it belongs at
the top of the main README.

1. Open the demo and click **Run the agent**.
2. Record the screen while you let it pause, then click **Approve**:
   - macOS: **Cmd+Shift+5** (record a region), or [Kap](https://getkap.co) / Gifox for a GIF.
   - Cross-platform: [ScreenToGif](https://www.screentogif.com) or [peek](https://github.com/phw/peek).
3. Save it as `examples/demo/demo.gif` and it will show up in the README.
4. Keep it short (~6–8s) and crop tight to the log panel.
