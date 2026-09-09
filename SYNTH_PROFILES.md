# Synth profiles and DX7 preparation

The app opens YS200 (4OP). The stacked 6OP / 4OP buttons select independent original-DX7 and YS200 editing buffers. DX7 is now a ready profile; see [DX7_REFERENCE.md](DX7_REFERENCE.md) for implementation, sources and limits.

## Implemented boundary

- `app/ys200.js`: YS200 validation, envelope geometry and routing data.
- `app/ys200-profile.js`: defaults, control specifications, scope, labels, waveform artwork, captions, summaries, seed operation, help and optional effects codec.
- `app/dx7.js`: native DX7 validation, envelopes, routing and voice/bank SysEx codec.
- `app/dx7-profile.js`: native DX7 controls and presentation, including global pitch EG.
- `app/synths.js`: registry and versioned, synth-tagged voice snapshots.
- `app/editor.js`: shared controls, selection, compare, undo, diagrams and export. Operator/control columns follow the profile. Feedback is a list of source/destination operator indices, not an assumed operator 4 loop.
- `app/effects-ui.js`: mounts only when the profile supplies effects. The existing EFEDS codec is attached exclusively to YS200.

Profiles own their native parameter names and representations. Do not translate DX7 rates into YS200 AR/D1R fields. `scope(key)` chooses global or operator storage regardless of the control row. `limits`, `reason`, `valid` and `normalize` own device constraints. `createVoice` returns a fresh buffer; `seed` must produce valid device values. `envelopePoints` supplies points in the shared 250×108 schematic viewport, with `hold` text and `envelopeTitle` explaining the model. `operatorSummary`, `formatValue`, waveform functions and captions supply device presentation.

Algorithms have indexed operator positions, modulation edges, carrier lists and feedback edges. DX7 layouts explicitly encode loops spanning several operators and use a wider diagram viewport. The synthetic six-operator regression fixture proves cardinality/selection/feedback/effects isolation, not DX7 synthesis fidelity.

JSON exports now have `{format:'fm-editor-voice', version:1, synthId, voice}`. The MIDI file workflow includes current YS200 effects in snapshots. Old untagged exports are not silently identified as another synth; version 1 snapshots can be imported through the file menu. A future importer needs an explicit legacy YS200 migration. Effects retain independent undo/compare, EFEDS import/export and live MIDI.

## Original DX7 differences that affect the editor

Compared with the current YS200 controls:

| Area | YS200 | Original DX7 |
|---|---|---|
| Operators / algorithms | 4 / 8 | 6 / 32; algorithm-specific feedback paths |
| Oscillator waves | Eight sine-derived choices | Sine only |
| Amplitude envelope | AR, D1R, D1L, D2R, RR; shift and REV | Four rates plus four levels, each 0–99; level 4 is start/release target |
| Pitch envelope | Legacy fields ignored | Separate global four-rate/four-level EG |
| Frequency | Encoded coarse 0–63, fine 0–15 with constraints, fixed range | Coarse 0–31, fine 0–99; ratio/fixed conversion differs |
| Detune | −3…+3 | −7…+7 |
| Keyboard scaling | Level amount; rate 0–3 | Breakpoint, left/right depth and curve; rate 0–7 |
| AM sensitivity | Global AMS plus operator AME | Operator AMS 0–3 |
| LFO | Four waves | Six: triangle, saw down/up, square, sine, sample/hold |
| Sync | LFO sync | LFO sync plus oscillator key sync |
| Effects | EFEDS processor plus envelope REV | Neither YS200 effects nor its envelope shift/REV |

These control differences are grounded in Yamaha's [DX7 operating manual](https://homepages.abdn.ac.uk/d.j.benson/pages/dx7/manuals/dx7-man.pdf), particularly printed pp. 39–43, 46–53 and 63. YS200 values are recorded in [PARAMETER_AUDIT.md](PARAMETER_AUDIT.md) and [EFFECTS_REFERENCE.md](EFFECTS_REFERENCE.md). Envelope drawings remain schematic; a shared graph renderer does not imply shared timing or gain calculations.

## MIDI and remaining implementation work

The DX7 has a different single-voice payload (155 bytes, format 0) and packed bank (32 × 128 bytes, format 9). Operator blocks run OP6 to OP1. The DX7 profile supplies separate pack/unpack and parameter-address codecs; never reuse the YS200 voice layout or EFEDS exporter. Validate framing, lengths, seven-bit bytes and Yamaha checksum before applying incoming data. Operator enable is edit state, not an extra byte appended to a voice dump. Source: Yamaha's [DX7 MIDI transmission/reception data](https://device.report/m/623add735fb65205bba86849e9c3bd3ed5c080829d3c51aff3d45fed059fc234.pdf).

The original MIDI chart specifies transmit channel 1 and selectable receive channels 1–16, channel aftertouch, and no MIDI clock/song-position support. Do not treat the LFO as MIDI-clock synced or assume the YS200 sequencer/multi workflow applies. Verify firmware-specific behavior with hardware. Source: [Yamaha DX7 MIDI chart v1.6](https://homepages.abdn.ac.uk/d.j.benson/pages/dx7/manuals/dx7-midi.txt).

## Remaining work

Browser MIDI transport, native voice/bank workflows, live parameter editing and device controller panels are implemented; see [MIDI_IMPLEMENTATION.md](MIDI_IMPLEMENTATION.md). Hardware verification, YS200 multi/system/sequencer editing and audio synthesis remain separate. YS200 now has VCED/ACED/ACED2/EFEDS and VMEM codecs; see MIDI_IMPLEMENTATION.md. The engines do not convert voices automatically.

Engine selection keeps independent voice, original/compare, operator selection and undo buffers in memory. YS200 effects retain their own state. The DX7 PITCH panel reuses shared controls and history. Reloading the page resets session state; export files to retain edits.

Run `node --test tests/editor.test.cjs` for the current validation suite.

The browser MIDI implementation is in `app/midi-protocol.js`, `app/midi-transport.js` and `app/midi-ui.js`. Run all checks with `node --test tests/*.test.cjs`.
