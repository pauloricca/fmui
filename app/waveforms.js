'use strict';
// Shared LFO icons, keyed by name so synth-specific waveform indices stay intact.
const Waveforms = (() => {
  const paths = {
    'Triangle': 'M3 16L16 5L42 27L55 16',
    'Saw down': 'M3 5L29 27V5L55 27',
    'Saw up': 'M3 27L29 5V27L55 5',
    'Square': 'M3 27V5H16V27H29V5H42V27H55V5',
    'Sine': 'M3 16C12 0 20 0 29 16S46 32 55 16',
    'Sample and hold': 'M3 24H10V5H20V17H30V9H40V25H55',
    'Wander': 'M3 20C8 20 7 7 14 7S20 24 27 24S31 15 37 15S43 5 48 5S51 13 55 13'
  };
  function lfo(name) {
    return `<svg class="lfo-wave" viewBox="0 0 58 32" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
  }
  return {lfo};
})();
