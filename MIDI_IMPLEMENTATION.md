# Browser MIDI and SysEx

Both modes run entirely in browser JavaScript. The HTTP server only serves files. There is no Rust process, server MIDI access, software synthesis, or automatic conversion between four- and six-operator voices.

## Connect and edit

1. Open the app over HTTPS or loopback HTTP in a browser that implements Web MIDI with SysEx permission.
2. Select **4 OP** for Yamaha YS200 or **6 OP** for the original Yamaha DX7.
3. Open **MIDI**, click **ENABLE MIDI / SYSEX**, and choose input/output ports and separate transmit/receive channels. Settings are independent for each engine and last for the page session. A device's MIDI OUT connects to the selected interface input.
4. **SEND VOICE** sends the displayed voice to the hardware edit buffer. Store it using the synth's own controls to retain it. **LIVE EDIT** first sends the displayed voice, then sends individual parameter changes, including names, operator switches, randomisation, undo, compare, pitch envelopes and effects.
5. **RECEIVE VOICE / BANK** arms reception for 30 seconds. YS200 requests a complete voice sequence or 32-voice VMEM bank when an output is available; with input only it listens for a manual dump. Original DX7 reception listens for a front-panel bulk dump. Enable SYS INFO on the DX7; its original MIDI chart specifies transmit channel 1.

SysEx bulk data is applied only while receive is armed. Incoming parameter changes are applied when Live Edit is enabled, filtered by input, receive channel and active synth protocol. Incoming changes do not echo into the output. The receiver discards incomplete YS200 extension sequences after three seconds and disarms after invalid data. Retry Receive to start a fresh transaction.

Engine, port and channel changes clear queued output and pending reception. Engine/port/channel changes disable Live Edit; explicitly enable it to synchronize the newly selected device. Disconnects stop queued output and disable live editing. Select reconnected ports to resume. Turning off Live Edit or cancelling output also releases audition notes.

## Files and banks

The file menu imports/exports native `.syx` voices and 32-slot banks, and version 1 synth-tagged JSON snapshots. JSON includes operator switches and current YS200 effects. Untagged legacy JSON and another engine's snapshots are rejected.

Create a bank from 32 copies of the displayed voice or import one; select slots to load them and use **REPLACE WITH EDIT** to update a slot. Bank export is local. Hardware bank transfer requires the explicit bank replacement checkbox. Check the hardware's memory protection and destination before transfer. A 32-voice dump does not imply backup of every YS200 memory or performance.

YS200 voice export includes EFEDS, ACED2, ACED, then VCED. Standalone EFEDS files can also be imported through the file menu. Imported voices become the Compare baseline. Voice import undo restores the prior voice and effects state; normal voice edits preserve independent effects history. Importing/selecting a voice while Live Edit is enabled sends it; receiving a hardware voice does not send it back.

## Protocols

| Mode | Single voice | Bank | Parameter changes |
| --- | --- | --- | --- |
| DX7 | Format 0, 155 bytes | Format 9, 32 × 128 bytes | Group bytes 0/1, address 0–155; function group 8 |
| YS200 | Format 3, 93 bytes; extensions format 126 | Format 4, 32 × 128 bytes | VCED group 18, ACED/ACED2 group 19, effects group 36 |

DX7 operator order is OP6 through OP1. YS200 wire order is OP4, OP2, OP3, OP1. Algorithm and signed-value offsets are explicit. Operator switches are parameter-only state, excluded from stored voice dumps.

YS200 retains hidden controller and legacy bytes in `voice.sysex`; bank source bytes are retained when available. `voice.effects` stores the three EFEDS fields. Reserved packed bytes remain preserved, while known fields are regenerated from the editor model. Effect preset 10 is accepted and shown as undocumented: the appendix permits it but names only ten front-panel effects.

All bulk messages are checked for framing, channel, format, declared size, seven-bit data, checksum and supported parameter bounds before commit. Files can contain concatenated SysEx messages; realtime bytes are ignored between/within framed file messages. Live Web MIDI delivers complete SysEx messages. Unknown formats and incomplete extension-only voice files are rejected.

**CONFIG** exposes YS200 voice controller settings and original DX7 function parameters. YS200 edits follow the Live Edit switch or SEND VOICE. Config groups supported destinations under Mod Wheel, Foot, Breath and Aftertouch. Destination switches set a native amount to zero when disabled and restore its prior amount while the panel stays open; newly enabled destinations start at 1. Pitch bias remains an independent amount. Dropdown buttons and menus are custom monochrome controls with keyboard navigation. DX7 function changes transmit immediately and are separate from voice dumps; unknown values are shown blank rather than guessed. DX7 assignment values are bitmasks: pitch 1, amplitude 2, envelope bias 4.

Hardware audition provides note/velocity, program change, modulation wheel, breath, foot, volume, channel pressure, pitch bend and sustain. Note release uses zero-velocity Note On for original DX7 compatibility. Panic releases tracked notes and sends sustain-off/all-notes-off on all channels. It also runs on window blur, page exit and cancellation. No automatic MIDI thru is enabled.

The output queue coalesces unsent changes by parameter address and spaces messages by at least their DIN MIDI wire time plus 30 ms. Bulk messages remain separate in multi-message transfers. Cancellation cannot retract bytes already sent. Sending means handing bytes to the MIDI interface, not receiving an acknowledgement from the synth. The recent echo cache is bounded and expires after 1.5 seconds.

## Validation and limits

Run `node --test tests/*.test.cjs`. Tests cover independent byte-layout examples, single/bank round trips, hidden controller/effect preservation, corrupt data, message routing, queue coalescing/cancellation, denied SysEx access, note release, live edits/compare/undo, atomic receive and effects history. Browser checks cover both modes, MIDI setup, disconnected errors, file/bank controls and function panels.

Physical DX7/YS200 hardware has not been exercised in this workspace. Final hardware acceptance: receive a known voice/bank, export and compare the known bytes; send an edit-buffer voice; audition; change each parameter class; compare/undo; receive again; test disconnect during a transfer. Timing margins are conservative defaults, not measured hardware certification.

Scope is native voice/bank editing, associated controller functions, and YS200 effects. YS200 multi/performance setup, sequencer/song data, remote front-panel switch emulation, cartridges and non-original DX7 models are separate device features, not implemented here. The app does not silently identify those dumps as voices.

## Sources

- Yamaha [YS100/YS200 MIDI appendix](https://manualzz.com/doc/55875224/yamaha-ys100-owner-manual), Add-11–13, Add-15–18 and Add-20–21: VCED, ACED, ACED2, EFEDS, VMEM, requests and parameter groups.
- Yamaha [original DX7 implementation chart v1.6](https://homepages.abdn.ac.uk/d.j.benson/pages/dx7/manuals/dx7-midi.txt): channel and channel-message behavior.
- [DX7 data sheet transcription](https://raw.githubusercontent.com/asb2m10/dexed/master/Documentation/sysex-format.txt), supporting the existing DX7 codec's formats and function-address table. The repository's earlier DX7 reference records the original Yamaha manuals.
- W3C [Web MIDI specification](https://www.w3.org/TR/webmidi/): browser access, SysEx permission, ports, send/clear and received message semantics.
