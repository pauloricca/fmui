# YS200 Effects implementation

Source: Yamaha YS100 owner manual, EFFECT section pp.22–23 and shared YS100/200 MIDI appendix Add-13, Add-15, Add-18, Add-20–21:
https://manualzz.com/doc/55875224/yamaha-ys100-owner-manual

The ten named front-panel programs are indexed 0–9: Hall, Room, Plate, Delay, Delay Left/Right, Stereo Echo, Distortion + Reverb, Distortion + Echo, Gate Reverb, Reverse Gate. Balance 0 disables the effect. The final two programs use room size rather than time. No independent distortion drive, damping, delay feedback, or EQ parameters are documented in EFEDS; do not invent them.

EFEDS has three bytes: preset 0–10, time 0–40, balance 0–99. Value 10 is accepted by the codec but deliberately not offered as a named preset: the manual does not establish its meaning. Time is shown as its encoded index; no unverified linear seconds/milliseconds conversion is used.

Parameter changes: F0 43 1n 24 pp vv F7; pp = 04 preset, 05 time, 06 balance. n is channel minus one. `Effects.changes` builds all three messages.

Bulk export: F0 43 0n 7E 00 0D [ASCII "LM  8036EF"] [preset time balance] [checksum] F7. Identifier contains TWO spaces. Checksum negates the sum of all 13 payload bytes modulo 128. Total length 21 bytes. Export changes the edit-buffer data when loaded by compatible MIDI software; it is not a memory-store command. Browser MIDI transmission and hardware audition are implemented; see MIDI_IMPLEMENTATION.md.

The documented EFEDS request also returns ACED2, ACED and VCED; it must not be treated as an effects-only reply in the MIDI receiver. VMEM effects reside at offsets 91–93. Voice ACED REV is a separate envelope pseudo-reverb parameter.

Effects have a separate local buffer and undo/compare history, retained across view switches. The MIDI file menu includes effects with voice JSON snapshots. Reloading resets the prototype. Defaults are local demonstration values, not claimed factory values.

Validation: automated message framing, ranges, checksum, live input, gesture undo, compare lockout, room-size labeling and navigation tests. Browser layout checked. Not tested against physical YS200 hardware; exact time-index display mapping remains unverified.
