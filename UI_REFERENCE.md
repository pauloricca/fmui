# YSEDITOR visual direction

The UI is a close Atari ST tribute, as requested on 8 September 2026. The original monochrome editing screen is the primary reference, rather than a contemporary synth dashboard.

References:
- Original project and credits: https://yseditor.martintarenskeen.nl/
- Editing-screen reference: https://www.tinyloops.com/doc/yamaha_tq5/images/steem-yseditor-editpage.gif
- Reference context and control descriptions: https://www.tinyloops.com/doc/yamaha_tq5/YSEDITOR.html

Preserve the top command strip, sixteen-column slider banks, four envelope panels across the middle, abbreviated parameter labels, black selected states, fine checkerboard dithering, and square borders. The application is a single edge-to-edge editor window; there is no surrounding desktop, menu bar, drop shadow, or outer margin. The font is locally bundled VT323 under the SIL Open Font License; it is a pixel-font approximation, not the original Atari system font. The editor keeps its dense layout on small screens with horizontal scrolling.

This is a local UI prototype, not a working YSEDITOR emulator or SysEx implementation. Sliders, operator selection, wave selection, mute states, undo, comparison, envelope seeding, and JSON export change local UI state. Envelope curves are illustrative. MIDI receive/transmit and audition report that the MIDI layer is unavailable. The separate pitch-envelope page is not implemented. Refreshing resets the session; use the top-left diamond > Save JSON to retain a snapshot.

Validation: JavaScript syntax checked; desktop appearance reviewed in browser against the screenshot. Verified repeated keyboard slider increments, undo, compare and operator selection in the rendered UI.


## Waveform and live-edit pass

References checked:
- Yamaha TX81Z Owner's Manual, printed pp. 15, 18 and 50: https://www.polynominal.com/site/studio/gear/sold/yamaha_tx81Z/yamaha-tx81z-manual.pdf
- OPZ implementation cross-check: https://github.com/aaronsgiles/ymfm/blob/main/src/ymfm_opz.cpp

The four LFO choices are indexed saw-up, square, triangle, sample-and-hold (displayed in reverse order, as in YSEDITOR). Operator indices 0–7 correspond to Yamaha W1–W8. Icons depict sine, signed sine-squared, their positive half-wave variants, compressed full cycles followed by silence, and two positive lobes followed by silence. Sine-squared geometry follows the ymfm interpretation; these small, quantized preview diagrams are not measured hardware wave tables or an audio engine.

Range input handlers update voice state, operator labels, carrier indicators, and envelope graphics immediately, without replacing the active slider. Undo groups successive input events into one drag. The top-left diamond retains snapshot saving; F1 opens help; the top-right arrow requests fullscreen.

Layout uses a shared sixteen-column grid for both banks and their captions. Operator panels span the same four-column divisions. Borders and control insets are consistent; the main window fills the viewport, with minimum dimensions for small displays.

Validation: `node --test tests/editor.test.cjs` checks input-before-change updates, slider identity, drag undo grouping, waveform selection/compare/undo, and waveform polarity/silent-half properties. All eight selections were also checked in the browser. At 1280 × 720, the window fits exactly with no vertical overflow and no console errors.

The later YS200-specific correctness audit in PARAMETER_AUDIT.md supersedes earlier assumptions about envelopes, frequency labels, applicability, and the demo patch.
