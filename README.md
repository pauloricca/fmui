# YS200 editor

## Headless test instruments

Run `sh instruments/start.sh` to start the separate DX7/YS200 emulator Compose
stack and native MIDI/audio bridge. Both instruments appear as MIDI ports in the
editor, with bidirectional SysEx and audio playback. See
[instruments/README.md](instruments/README.md) for setup, command-line dumps and
recording, tests, and the remaining hardware-fidelity limitations.

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

## Controlled randomisation

RANDOMISE chooses an algorithm first and preserves the voice name. It mixes pluck, sustained and soft envelopes across operators, with at least one
contrasting contour. Modulators can decay into a short transient or swell in
more slowly, while carriers retain audible levels. It chooses settings using each operator's
carrier/modulator role and distance from the output. Carriers stay enabled, with
a fundamental, restrained keyboard/velocity scaling and healthy output levels.
Modulators have broader harmonic ratios, waveforms and fine tuning; deeper stacks
use lower modulation levels. YS200 coarse frequencies use encoded ratio-table
indices, rather than treating the coarse value as a frequency ratio.

Both engines use ratio mode, neutral transpose, gentle LFO modulation and
envelopes that release. YS200 controller-dependent attenuation is cleared and
effects retain a strong dry signal. DX7 pitch movement stays near neutral.
These constraints favour playable results over covering every legal value; they
do not constrain subsequent manual edits or existing modulation mappings.
Undo and redo restore the voice and YS200 effects together.
