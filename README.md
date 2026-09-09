# YS200 editor

## Development

Start the editor with `./start.sh`, or `docker compose up -d`, then visit
http://localhost:5173.

If you already have the old nginx container, switch to the development server once:

```sh
docker compose up --build -d
```

Files in `app/` are mounted directly into the container. Saving CSS injects the
updated styles without refreshing; saving HTML or JavaScript reloads the page.
Page reloads reset in-memory editor state, so save patches you want to keep.
Polling supports Docker Desktop file sharing. No rebuild is needed for app edits.

After changing dependencies or the Dockerfile, run `docker compose up --build -d`.
After changing `bs-config.cjs`, run `docker compose restart ui`.

To run without Docker: `npm ci` followed by `npm run dev`.
Run the existing tests with `npm test`.

## Production image

The default Dockerfile target still serves static files through nginx:

```sh
docker build -t ys200-editor .
docker run --rm -p 5173:80 ys200-editor
```

The editor automatically saves its session to this browser's local storage: both
synth voice buffers and undo/redo history, effects, modulation settings, mappings,
MIDI preferences and received banks, and the selected engine/operator/view.
Reloading restores those settings. Enable MIDI/SysEx to reconnect saved ports;
active notes and in-progress transfers are not resumed. Local storage belongs to
the current site address and browser; export voice files for a separate backup.
