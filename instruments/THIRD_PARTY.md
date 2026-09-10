# Source provenance

All third-party source is vendored; builds do not fetch moving upstream branches.

## Rust DX7/FM core

- Project: <https://github.com/spacejam/dx7>, version **0.0.4**.
- Commit recorded by the crate: `ae09663064b07b4244aa70e7ba04fb93c55e960f`.
- Crate archive: <https://static.crates.io/crates/dx7/dx7-0.0.4.crate>.
- Archive SHA-256: `14f7ebb0106e3658a43f8639598f97cbec51071b643acc729b478fe080b65d19`.
- Copyright Tyler Neely (2025), Emilie Gillet (2021); **MIT**. Full permission
  notices are retained at the top of every source file.
- Derived from the Mutable Instruments Plaits FM implementation. This is an
  approximate floating-point synthesis core, not original Yamaha firmware.

Local changes in `vendor/dx7/src/fm/voice.rs`:

1. Apply live patches without resetting phase/envelope state or skipping a block.
2. Honor the operator enable bitmask during synthesis.
3. Remove the Plaits macro's release-time scaling in native instrument mode.
4. Copy a reused input bus before borrowing an output bus mutably, avoiding
   overlapping Rust slice references in certain algorithms.
5. Retain oscillator phases across notes when key sync is disabled.
6. Apply controller envelope bias separately from LFO AM sensitivity.

## YM2414/OPZ chip core

- Project: <https://github.com/aaronsgiles/ymfm>.
- Vendored `main` archive snapshot downloaded 2026-09-09:
  <https://codeload.github.com/aaronsgiles/ymfm/tar.gz/refs/heads/main>.
- Archive SHA-256: `474e5fd8157ef0385a8877be293a335bfd81612dec7b90d97d0c3c496929fe0b`.
- Copyright Aaron Giles (2021); **BSD-3-Clause**. Complete license is in
  `vendor/ymfm/LICENSE` and in the distributed container.
- Only `ymfm.h`, `ymfm_fm.h`, `ymfm_fm.ipp`, `ymfm_opz.h`, and `ymfm_opz.cpp`
  are needed. Sources retain upstream notices and their documented uncertainties.

Local changes in `vendor/ymfm/ymfm_opz.cpp`:

1. Map the no-EG-shift restriction to the final carrier (Yamaha OP1, physical slot
   24), rather than the feedback operator (physical slot 0).
2. Include the shared accumulator's ten fractional phase bits in fixed-frequency
   stepping. The unmodified calculation produced a frequency 1024 times too low.
   Tests measure fixed 400 Hz and invariance under MIDI pitch changes.

`native/opz.cpp` adds ownership, register access, sample generation, and per-slot
reset for voice stealing. It does not include Yamaha firmware or copyrighted ROMs.

## Hardware/protocol references

- Yamaha YS100/YS200 MIDI appendix, transcribed at
  <https://manualzz.com/doc/55875224/yamaha-ys100-owner-manual>.
- Yamaha TX81Z manual (shared 4-operator architecture):
  <https://usa.yamaha.com/files/download/other_assets/9/316769/TX81ZE.pdf>.
- Original DX7 MIDI chart:
  <https://homepages.abdn.ac.uk/d.j.benson/pages/dx7/manuals/dx7-midi.txt>.
- Native DX7 layouts:
  <https://github.com/asb2m10/dexed/blob/master/Documentation/sysex-format.txt>.
- Olaf Dietrich's oscillator measurements and coarse/fine ratio derivation:
  <https://dtrx.de/od/dx11/osc_frequencies.html>.
- TX81Z Programmer's fixed coarse-index documentation (bottom two bits ignored):
  <https://mgregory22.me/tx81z/programmer/frequency.html>.

See the root `MIDI_IMPLEMENTATION.md`, `DX7_REFERENCE.md`, and `PARAMETER_AUDIT.md`
for the editor's independently implemented wire layouts. No reference-site code
was copied into the instrument service.

## Host bindings

- python-rtmidi 1.5.8: <https://github.com/SpotlightKid/python-rtmidi>, MIT, wraps RtMidi.
- sounddevice 0.5.3: <https://github.com/spatialaudio/python-sounddevice>, MIT, wraps PortAudio.
- Their package distributions include their respective license notices; they are
  installed only in `bridge/.venv`, not vendored or bundled in the service image.
