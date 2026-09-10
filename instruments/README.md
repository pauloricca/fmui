# Headless Yamaha instruments

Two independent instrument services for testing this editor through **real native
MIDI ports**, with audio playback and bidirectional Yamaha SysEx. No UI, browser
audio synthesis, or changes to the editor are required. The Compose project is
separate from the editor's Compose project.

This is a working **voice-mode emulation/test environment**, not a complete
firmware or electrically accurate recreation of either instrument. The DX7
synthesis is Rust. YS200 synthesis uses the BSD-licensed C++ YM2414 core through
a narrow Rust FFI binding. MIDI, memory, voice allocation, controllers, streaming,
resampling, and effects are implemented in Rust; the host bridge is Python.

## Start

From the repository root, with Docker Desktop running and Python 3 available:

```sh
sh instruments/start.sh
```

This builds and starts the two containers, creates a project-local Python virtual
environment, and on macOS installs the host MIDI/audio bridge as a user LaunchAgent.
It runs independently of the terminal or Codex session, restarts if it exits, and
starts again at login. The bridge
creates virtual MIDI endpoints and plays 48 kHz stereo audio through the default
output device. On macOS, CoreMIDI and CoreAudio are used through RtMidi/PortAudio.
No microphone access is required. The instrument containers keep their memory in
separate volumes. Docker Desktop must also be running for synthesis to work.

To run the components separately:

```sh
docker compose -f instruments/compose.yml up -d --build --wait
sh instruments/bridge/start.sh
```

Running the macOS start script again updates the existing service without creating
duplicate ports. The bridge reconnects automatically after container restarts.

Manage the macOS bridge without rebuilding containers:

```sh
python3 instruments/bridge/service.py status
python3 instruments/bridge/service.py restart
python3 instruments/bridge/service.py uninstall
```

Logs are in `~/Library/Logs/ys200-editor/`. The service definition is
`~/Library/LaunchAgents/com.ys200-editor.midi-bridge.plist`. Re-run the start script
if you move the repository. For foreground debugging, uninstall the service first,
then run `sh instruments/bridge/start.sh --foreground`; Ctrl-C closes its ports.
Linux uses foreground mode by default.

Linux hosts need an ALSA sequencer and PortAudio (typically `libasound2` and
`libportaudio2`). Windows virtual MIDI endpoints are not supported by this bridge;
use a macOS/Linux host. The containers themselves require neither audio hardware
nor privileged/device mounts.

## Connect the editor

Open the editor normally, choose a synth mode, open **MIDI**, and enable SysEx.

| Editor mode | Editor MIDI input | Editor MIDI output | RX / TX |
| --- | --- | --- | --- |
| 6 OP | DX7 Emulator OUT | DX7 Emulator IN | 1 / 1 |
| 4 OP | YS200 Emulator OUT | YS200 Emulator IN | 1 / 1 |

Use **SEND VOICE**, **LIVE EDIT**, and the audition controls. Both instruments can
run and sound simultaneously. Imported voices and the editor's algorithms,
waveforms, envelopes, frequency modes, controller settings, and effects reach the
services through the same MIDI path as a hardware instrument.

**YS200 receive:** click RECEIVE VOICE / BANK; the emulator answers the native
request. **DX7 receive:** the original DX7 does not support a voice dump request.
Arm RECEIVE in the editor, then trigger its headless front-panel equivalent:

```sh
python3 instruments/bridge/cli.py dump /tmp/dx7-voice.syx
# Or, after arming bank reception:
python3 instruments/bridge/cli.py bank /tmp/dx7-bank.syx
```

These commands both save the data and transmit it through DX7 Emulator OUT. The
same commands work on YS200 with `--address 127.0.0.1:7200`. Received edits are
never automatically echoed, preventing MIDI loops.

The original DX7 transmits on channel 1 even if configured to receive elsewhere.
YS200 uses its configured receive channel for transmission. Override RX using
`DX7_CHANNEL` / `YS200_CHANNEL` in the environment before starting Compose. The
native binary also offers `--tx-channel` for explicit test configurations.

## Headless controls and recording

The CLI uses only Python's standard library; it does not need the host bridge.

```sh
python3 instruments/bridge/cli.py status
python3 instruments/bridge/cli.py load /path/to/voice-or-bank.syx
python3 instruments/bridge/cli.py store 0
python3 instruments/bridge/cli.py midi "c0 00"
python3 instruments/bridge/cli.py functions
python3 instruments/bridge/cli.py panic
python3 instruments/bridge/cli.py record /tmp/dx7.wav --note 69 --hold 1 --seconds 3
python3 instruments/bridge/cli.py --address 127.0.0.1:7200 record /tmp/ys200.wav --note 60 --hold 2 --seconds 5
```

`store` and Program Change use zero-based slots. DX7 has 32 internal slots; YS200
has 100 user slots. They begin with an audible INIT voice. Factory ROM/cartridge
voices are not bundled. A bulk voice updates the edit buffer, while a bank updates
32 memory slots. Use `store` to copy the edit buffer into memory. Operator switches
are temporary edit state and reset to ON when a stored voice is recalled.

YS200's `bank-start N` chooses a 32-slot window for bank uploads/downloads, where
0 ≤ N ≤ 68. This is an **administrative test facility**, not a claim to implement
Yamaha's complete all-memory/card transfer protocol. Hidden native voice fields,
controller data, and reserved VMEM bytes are retained. Unpacked-only extension
bytes naturally cannot be represented by a VMEM bank.

State includes all user voices, edit buffer, functions, selected program, and bank
window. It is saved atomically, at most four times per second. Containers refuse
to load a corrupt/incompatible state file rather than replacing it with defaults.
Allow 250 ms after an edit before forcibly stopping a container.

Audio options:

```sh
sh instruments/bridge/start.sh --list-audio
sh instruments/bridge/start.sh --audio-device "MacBook Pro Speakers"
sh instruments/bridge/start.sh --no-audio
sh instruments/bridge/start.sh --ys200 off
```

TCP binds to host loopback only, on 7007 (DX7) and 7200 (YS200). Override with
`DX7_PORT` / `YS200_PORT` and pass matching `--dx7 host:port` / `--ys200 host:port`
to the bridge. No MIDI/audio ports are exposed to the LAN by default.

## Implemented sound and protocol

| Feature | DX7 | YS200 |
| --- | --- | --- |
| Polyphony | 16 voices | 8 voices |
| Operators / algorithms | 6 sine operators / 32 | 4 operators / 8 |
| Operator envelopes | 4 rates / 4 levels; nonzero L4 allowed | AR / D1R / D1L / D2R / RR; zero-rate holds, EG shift, reverb rate |
| Oscillators | Ratio/fixed, fine, detune, key sync | Native coarse index mapping, ratio/fixed, fine, detune, 8 waveforms |
| Pitch envelope | 4 rates / 4 levels | Legacy bytes preserved, ignored by synthesis |
| Scaling | Keyboard level/rate scaling, velocity, AM sensitivity | Keyboard level/rate scaling, velocity, AM enable, envelope bias |
| LFO | 6 waveforms, sync, delay, pitch/AM | 4 waveforms, sync, delay, pitch/AM |
| MIDI controls | Notes, program, volume, expression, sustain, bend, mono, basic portamento, wheel/foot/breath/pressure assignments | Same channel controls, per-voice controller assignments |
| SysEx voice/bank | VCED 155 bytes / VMEM 4096 bytes | VCED 93 bytes; EFEDS, ACED2, ACED; VMEM 4096 bytes |
| Live SysEx | Voice addresses 0–155; function group 8 | Groups 18, 19, 36; operator mask |
| Effects | None | Approximate hall/room/plate, delay, stereo delay/echo, distortion combinations, gate/reverse gate |

The decoder handles fragmented SysEx, running status, and interleaved realtime
bytes. Lengths, seven-bit bytes, checksums, parameter bounds, and channels are
checked before applying changes. Banks commit only after all 32 voices validate.
YS200 extension sequences are isolated per connection and expire after three
seconds. EFEDS is also a standalone command, so its effect change applies
independently, even if a subsequent voice message is invalid.

Note release, sustain, all-notes-off, all-sound-off, controller reset, and active
sensing timeout are handled. The audio thread owns synthesis state; bounded
network queues prevent a slow reader blocking audio. Stale audio may be dropped
to bound latency. MIDI queue overflow disconnects the peer instead of silently
dropping a message. The host keeps a small jitter buffer (about 30 ms).

## Fidelity and remaining work

The algorithms and distinct envelope/oscillator architectures are implemented,
and frequency/behavior are tested. **No physical DX7/YS200 A/B calibration has been
performed. Do not use these services as a bit-exact hardware oracle.**

- DX7 uses the MIT Plaits-derived floating-point Rust core, with its approximate
  envelope/pitch/velocity/scaling curves. It does not emulate the original CPU,
  fixed-point EGS/OPS pipeline, DAC quantization, or analog output stage. Unsynced
  oscillators retain per-slot phase between notes; idle hardware oscillator timing
  is not cycle-exact.
- YS200 uses ymfm's log-sine, chip envelopes, algorithms, feedback, and waveform
  implementation. Firmware-to-register mappings for LFO speed/delay, output level,
  velocity, keyboard scaling, and controller amounts are approximations. The core
  runs at its nominal 3.579545 MHz clock and is resampled to 48 kHz with a 32-tap
  polyphase filter; exact YS200 clock/DAC/output behavior needs hardware validation.
- YS200's separate effects processor is approximated with newly written DSP, not
  the original effects ROM. Preset 10 is preserved but bypassed because its
  algorithm is undocumented. Time mappings, gate behavior, stereo characteristics,
  and reverb coloration are not hardware matched.
- Mono/portamento are basic performance implementations. DX7 glissando and
  retain/follow behavior, YS200 fingered-portamento nuances, and polyphonic
  aftertouch are not implemented. Associated stored native settings round-trip.
- YS200 sequencer/song data, multi/performance mode, card/ROM banks, remote panel
  switch protocol, full-system dumps, microtuning, and CPU/firmware execution are
  outside this voice-mode implementation. Unknown SysEx is rejected; it is not
  misidentified as a supported voice transfer.

The next accuracy milestone requires matched dry recordings from real instruments:
isolated carriers across notes/velocities, every envelope stage/rate, fixed and
ratio frequencies, feedback sweeps, all waveforms/algorithms, modulation, and wet
effect impulse responses. Keep captured patches and MIDI timing alongside audio.

## Verification

No Rust installation is needed on the host:

```sh
node instruments/tests/editor-fixtures.cjs
docker run --rm -v "$PWD/instruments:/build" -w /build rust:1.90-bookworm cargo test --offline --locked
python3 instruments/tests/integration.py
# With the bridge already running:
instruments/bridge/.venv/bin/python instruments/tests/integration.py --native
node --test tests/*.test.cjs
```

Integration tests temporarily load fixtures into the selected services, exercise
MIDI, and restore their current voices and selected 32-slot memory windows in a
`finally` block. Run on idle instruments. Rust tests cover editor-codec byte
agreement, algorithm carriers, waveform differences, concert pitch, octave ratio,
fixed pitch, bend, envelope release/hold, sustain/panic, framing, corrupt messages,
connection-isolated extension reception, and persistence.

The image build runs tests and needs no crates.io access: its only Rust dependency
and the native chip source are vendored. See [THIRD_PARTY.md](THIRD_PARTY.md) for
source versions, licenses, and local fixes.

Stop the containers, retaining their memory:

```sh
docker compose -f instruments/compose.yml down
```

## Transport protocol

Each TCP packet is a big-endian u32 length followed by one kind byte and a payload.
Length includes the kind byte and must be 1–65536. Audio is interleaved stereo
little-endian float32 at 48000 Hz, 480 frames per packet.

| Kind | Direction | Payload |
| --- | --- | --- |
| 1 | Both | Raw MIDI bytes; client packets may fragment/concatenate messages |
| 2 | Server → client | Audio samples |
| 3 | Client → server | Command bytes: 0 voice dump, 1 bank dump, 2+slot store, 3 panic, 4 status, 5+start bank window, 6 DX7 function dump |
| 4 | Client → server | One subscription byte: MIDI bit 1, audio bit 2 |
| 5 | Server → client | UTF-8 JSON status; greeting and command/subscription acknowledgement |
| 6 | Server → client | UTF-8 error text |

Clients initially subscribe to MIDI only. Send a status command at least every
30 seconds to keep an otherwise idle connection alive. Dump MIDI is broadcast to
MIDI subscribers, followed by an acknowledgement to the requesting client.
