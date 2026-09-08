# YS200 editor correctness audit — 8 September 2026

Scope: every control currently displayed in the voice-editor prototype. This is a documentation audit, not a hardware certification or a complete MIDI implementation.

## Parameter ranges and applicability

Source: Yamaha's shared YS100/YS200 MIDI appendix, Attached List 1, Add-11–13, reproduced in the [YS100 manual](https://manualzz.com/doc/55875224/yamaha-ys100-owner-manual). The [YS100/YS200 service manual](https://www.manualslib.com/manual/4213430/Yamaha-Ys100.html) also contains the format.

| UI | Accepted value / disposition |
|---|---|
| AR | 1–31 (corrected minimum) |
| D1R, D2R | 0–31 |
| D1L | 0–15 |
| RR | 1–15 |
| LEVEL, OUT | 0–99 |
| RATE | 0–3 |
| EBS, KVS | 0–7 |
| AME, FIX, SYNC, MONO | Boolean |
| DET | −3…+3; encoded center 3 |
| ALG | 1–8; encoded 0–7 |
| FBL, PMS | 0–7 |
| SPD, DLY, PMD, AMD | 0–99 |
| LFW, AMS | 0–3 |
| TRPS | −24…+24; encoded center 24 |
| CRS | 0–63, encoded index |
| FINE | 0–15; ratio coarse 0–3 restricts fine to 0–7 |
| FIXRG | 0–7; meaningful only in FIX mode |
| wave | 0–7 |
| SHIFT | Off, 48, 24, 12 dB; operator 1 fixed Off |
| REV | Shared voice value 0–7, not per-operator |
| CHrs, pitch EG | Ignored legacy parameters; disabled |
| FIXRM | Not present; reserved slot, disabled |

## Envelope corrections

The old graphic was a visual placeholder: D2R changed a y-coordinate, D1L was inverted, release always started at a predetermined stage, and zero rates had no special treatment.

The new plot implements stage semantics with a fixed key-release position. Higher D1L means a higher level; at 15 there is no first-decay drop. Zero decay rates hold. Increasing D2R steepens decay rather than moving a fixed endpoint. Release starts from the current level, even during attack. SHIFT changes the envelope's vertical range. Coordinates remain bounded at extreme settings.

These semantics are described in Yamaha's [TX81Z manual, printed pp. 18–20](https://www.polynominal.com/site/studio/gear/sold/yamaha_tx81Z/yamaha-tx81z-manual.pdf). The YS-specific range above takes precedence over the TX81Z's AR range.

**The horizontal scale is relative.** The rate-to-duration function is deliberately schematic, not reverse-engineered hardware timing. The logarithmic vertical plot is a normalized envelope, not acoustic loudness. It excludes output gain, velocity, note-dependent scaling, controller modulation, and the shared pseudo-reverb tail. Hovering an envelope explains these limits. “OFF” marks key release; it is not an operator mute indicator.

## Frequency audit

The old `RATIO:6.00` simply formatted raw CRS code 6 as a decimal. That was incorrect: coarse values index a nonlinear frequency mapping and fine also changes frequency. The UI now explicitly displays `RTO CRS:6 FIN:0`, or `FIX CRS:… FIN:…`, until the YS200 physical-frequency mapping is implemented and verified. No raw code is presented as a ratio or Hz frequency.

Fixed-range display uses the conventional range ceilings 255, 510, 1K, 2K, 4K, 8K, 16K, 32K. The fixed-range slider is disabled in ratio mode. Switching modes/coarse values clamps fine when its legal range decreases, in the same undo transaction.

Cross-check: the original [TX81Z Programmer frequency documentation](https://mgregory22.me/tx81z/programmer/frequency.html) and its [frequency tables](https://github.com/mgregory22/tx81z-programmer/blob/master/src/freqratios.c). Those tables were inspected; implementation code was not copied.

## Other displayed behavior

- C/M roles agree with the eight Yamaha routing diagrams. Operators producing direct output are: 1 for algorithms 1–4; 1 and 3 for 5; 1, 2 and 3 for 6–7; all four for 8. Selection changes the bottom controls, not the role. [Reference diagrams attributed to YSEDITOR's author](https://www.tinyloops.com/doc/yamaha_tq5/algorithms.html).
- Operator waveform previews remain sine-derived schematic icons; their earlier mapping audit is in UI_REFERENCE.md. They are not hardware captures.
- On/off affects local state; no audio engine exists. Feedback, LFO, controller sensitivities, transpose and level edits likewise do not produce sound yet.
- The initial voice is now named DemoVoice. The previous FloatChime label incorrectly implied that the illustrative parameter values were a verified factory preset.
- SEED and MOUSE are prototype-local actions (envelope randomization and fine keyboard editing), not claims of emulating the original application's behavior. TEST/RX/TX explain the unavailable MIDI layer. CONTROL is informational. EXIT opens credits. File saves JSON, not SysEx; import and persistence are not implemented.
- This page is not a complete YS200 editor. Dedicated effects, performance/multi settings, full controller editing, codecs and MIDI transport remain future work.

## Validation

`node --test tests/editor.test.cjs`: seven passing tests, including invalid ranges, unsupported writes, fine constraints, shared reverb, all envelope extrema, zero decay, live input before release, drag undo, and waveform selection/compare. Browser inspection verifies the new controls and live envelope render without console errors. No physical YS200 has been tested.


## Complete envelope overview and routing diagram

The later relative-view update supersedes the fixed key-release visualization above. The entire attack/decay/hold/release outline is fitted into the graph. Log-compressed stage widths with a minimum visible width prevent a slow stage from crowding out the others. This is a stage-relative overview, not a common time scale between operators. A nonzero second decay uses a representative midpoint before release; zero decay rates show a hold and skip unreachable stages. The dotted OFF marker was removed.

A live diagram to the left of ALG shows all four numbered operators, modulation connections, carrier outputs, and feedback around operator 4. It follows ALG and selected-operator changes. The nine regression tests now also cover complete envelope fitting and all eight diagram states.

## Maximum attack and hold review

AR 31 previously occupied a forced minimum stage width, which was an implementation error. It now produces a vertical key-on attack. Evidence: the [ymfm OPZ rate cache](https://github.com/aaronsgiles/ymfm/blob/main/src/ymfm_opz.cpp) maps AR to doubled effective rate; its [FM envelope implementation](https://github.com/aaronsgiles/ymfm/blob/main/src/ymfm_fm.ipp) handles effective attack rates 62 and above immediately at key-on. This is emulator evidence, not a YS200 hardware measurement. The Yamaha TX81Z manual calls 31 the fastest attack. Lower AR can also become effectively instantaneous under key-rate scaling; the normalized overview does not model a particular played key.

D1R=0 holds at the peak when D1L is below 15. It is not merely a slightly slower D1R=1. D1L=15 bypasses first decay even at D1R=0. D2R=0 holds at D1L once that stage is reached. The plot now identifies D1 HOLD and D2 HOLD. Its finite stage fitting exaggerates the visual difference between a hold and an arbitrarily slow but finite decay. It must not be used as a duration comparison. No interpolation was added to disguise the special zero-rate behavior.

Fourteen passing regression tests include 504 value/SHIFT geometry cases, every declared parameter's lower/upper/fractional bounds, maximum attack versus AR 30, zero-decay stage reachability, routing graph topology, live editing and undo. Browser checks confirm the AR 31/D1R 0 result without console errors.

**Unresolved hardware equivalence:** the stage timing formula, compressed horizontal axis, representative release point, normalized gain, and schematic waveform icons are not exact synth output. Physical frequency conversion, key-rate scaling, velocity/controller gain, pseudo-reverb interaction, real-time retrigger behavior, MIDI transport and synth audio are not implemented. Exact certification requires controlled YS200 measurements (known patch dump, MIDI note/velocity and gate duration, output recording), or an independently validated device model, followed by comparison tests. Passing the UI tests is not that certification.


## Fast-stage proportions and section labels

Removed logarithmic width compression and the 24-pixel minimum. Finite stage durations now share a uniformly fitted relative axis with just a one-pixel visibility allowance. AR 31 retains its vertical attack; RR 15 is the fastest finite release, not an instantaneous key-on shortcut. Timing remains schematic. The footer now separates ENVELOPE GENERATOR (SHIFT through RR), REV, KBD SCALING (RATE and LEVEL), and OUT. The envelope’s final slope is release, not reverb or keyboard scaling. The Tinyloops page describes the grouping, but its REV effect-preset list conflicts with Yamaha’s ACED REV definition; the latter remains authoritative.

## State-dependent control availability

The UI now fades the whole unavailable control (label, slider/options, value and arrows), with a hover explanation and native disabled inputs. FIXRG follows FIX; SHIFT remains unavailable on operator 1; CHrs and FIXRM remain N/A. Voice and effects controls fade in their respective Compare modes.

Presentation rules also follow the existing envelope model: D1R is unavailable at D1L=15; D2R is unavailable when D1R=0 and D1L<15, or when D1L=0. Availability refreshes during slider input without replacing the active slider. Stored values survive these transitions, and undo, operator selection and Compare restore the appropriate state. Legal stored ranges remain separate from presentation availability.

Other candidates remain editable: muted operators and zero-output operators can be prepared before enabling them; modulation depths and sensitivities can be configured independently, including for controller input; effect time remains editable at zero balance. RR remains applicable because note-off can occur during attack or first decay. FINE already changes its legal range with CRS/FIX rather than becoming unavailable.

Validation: 22 passing Node tests, including live decay availability, blocked edits, retained values, FIX toggling, selection, undo and Compare.
