# Original DX7 / 6OP implementation

## Sources reviewed

- [Yamaha DX7 operating manual](https://homepages.abdn.ac.uk/d.j.benson/pages/dx7/manuals/dx7-man.pdf), printed pp. 23–26, 28–43, 51–53, 55–57, 63: engine, envelopes, frequency modes, keyboard scaling, modulation, algorithm chart, MIDI operation.
- [DX7 MIDI format documentation](https://raw.githubusercontent.com/asb2m10/dexed/master/Documentation/sysex-format.txt): original hardware observations and Yamaha data-sheet transcription, including VCED, packed VMEM, parameter addresses and function messages.
- [Yamaha MIDI implementation chart, v1.6](https://homepages.abdn.ac.uk/d.j.benson/pages/dx7/manuals/dx7-midi.txt): supported channel messages and original-model restrictions.
- [MSFA algorithm bus definitions](https://raw.githubusercontent.com/asb2m10/dexed/master/Source/msfa/fm_core.cc): independent cross-check of all 32 routing graphs. Tests reconstruct the factual bus topology independently of the editor's explicit edge lists, including multi-operator feedback in algorithms 4 and 6.

## Engine and presentation

6OP is the original DX7 (16-note polyphony, six sine operators); 4OP remains YS200. Operator count is not polyphony. This app edits voices and does not currently synthesize sound.

All stored DX7 voice parameters are editable: native R1–R4/L1–L4 operator envelopes, global pitch EG, 32 algorithms, feedback, ratio/fixed frequency, detune, breakpoint/depth/curve keyboard level scaling, rate scaling, velocity/AM sensitivity, LFO, independent oscillator/LFO sync, transpose, and name. The PITCH button reuses the lower sliders. Graphs follow L4 → L1 → L2 → L3, hold, then L4, allowing rising/falling stages. Pitch level 50 is neutral.

Frequency labels exclude detune: ratio `(coarse || 0.5) * (1 + fine/100)`; fixed `10 ** (coarse % 4 + fine/100)` Hz. Breakpoint 39 displays C3. Curves follow the wire order −LIN, −EXP, +EXP, +LIN.

The envelope renderer is a stage-relative sketch using nonlinear rate weights and level indices. It does not emulate Yamaha's envelope clocks, logarithmic gain, nonlinear pitch-level mapping, key scaling, velocity, or retrigger behavior. Rate zero is slow, not a YS200-style infinite hold. No YS200 waveform, shift, reverb or EFEDS controls leak into DX7.

## MIDI and files

`DX7Codec` implements single voice encode/decode (155-byte payload), packed voice conversion (128 bytes), 32-voice banks, framed SysEx import/export, checksum validation and voice parameter-change encoding. Operator blocks serialize OP6 first; UI operators remain OP1 first. Stored algorithm is zero-based; UI is 1–32. Detune and transpose offsets are explicit. Operator mute uses address 155's six-bit edit mask and is excluded from voice dumps.

The file menu accepts one complete voice/bank message, validates before applying, and lets users select a bank voice. Imported voices become the compare baseline; undo restores the previous voice and baseline. JSON preserves local mute state. SysEx exports the displayed voice. The codec can produce banks; the UI exports individual voices.

Browser MIDI, parameter streaming, explicit bank transfer and hardware audition are implemented; see [MIDI_IMPLEMENTATION.md](MIDI_IMPLEMENTATION.md). Receive listens for a front-panel dump. The CONTROL panel exposes function controls (mono/poly, bend, portamento, controller ranges/assignments) separately from voice data. The original chart fixes transmit to channel 1, allows receive 1–16, supports channel pressure rather than poly pressure, and has no MIDI clock. These must remain separate when transport is added.

## Validation

Run `node --test tests/editor.test.cjs`. Coverage includes original 4OP behavior, engine/effect/history isolation, pitch editing, native bounds and frequency display, envelope stage order, all algorithm edges/carriers/feedback, operator wire order, signed offsets, mute mask, single/bank round trips and corrupt-message rejection. Browser checks cover 6OP, PITCH, file menu and switching. Simulated MIDI transport and editor integration are tested. Physical hardware timing and reception have not been tested.
