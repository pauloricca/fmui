'use strict';
// Shared pixel-grid icons; waveform indices remain synth-specific.
const Waveforms = (() => {
  // Rasterize segments in icon coordinates so enlargement retains visible pixels.
  function pixelPath(points) {
    const pixels = new Set();
    for (let i = 1; i < points.length; i++) {
      let [x, y] = points[i - 1].map(Math.round);
      const [endX, endY] = points[i].map(Math.round);
      const dx = Math.abs(endX - x), dy = -Math.abs(endY - y);
      const sx = x < endX ? 1 : -1, sy = y < endY ? 1 : -1;
      let error = dx + dy;
      while (true) {
        pixels.add(`${x},${y}`);
        if (x === endX && y === endY) break;
        const twice = 2 * error;
        if (twice >= dy) { error += dy; x += sx; }
        if (twice <= dx) { error += dx; y += sy; }
      }
    }
    return [...pixels].map(p => `M${p}h1v1h-1z`).join('');
  }
  function curve(a, b, c, d) {
    return Array.from({length:33}, (_, i) => {
      const t = i / 32, u = 1 - t;
      return [0, 1].map(axis => u**3*a[axis]+3*u*u*t*b[axis]+3*u*t*t*c[axis]+t**3*d[axis]);
    });
  }
  const points = {
    'Triangle': [[3,16],[16,5],[42,27],[55,16]],
    'Saw down': [[3,5],[29,27],[29,5],[55,27]],
    'Saw up': [[3,27],[29,5],[29,27],[55,5]],
    'Square': [[3,27],[3,5],[16,5],[16,27],[29,27],[29,5],[42,5],[42,27],[55,27],[55,5]],
    'Sine': [...curve([3,16],[12,0],[20,0],[29,16]), ...curve([29,16],[38,32],[46,32],[55,16])],
    'Sample and hold': [[3,24],[10,24],[10,5],[20,5],[20,17],[30,17],[30,9],[40,9],[40,25],[55,25]],
    'Wander': [...curve([3,20],[8,20],[7,7],[14,7]), ...curve([14,7],[21,7],[20,24],[27,24]), ...curve([27,24],[34,24],[31,15],[37,15]), ...curve([37,15],[43,15],[43,5],[48,5]), ...curve([48,5],[53,5],[51,13],[55,13])]
  };
  const paths = Object.fromEntries(Object.entries(points).map(([name, p]) => [name, pixelPath(p)]));
  function lfo(name) {
    return `<svg class="lfo-wave" viewBox="0 0 58 32" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
  }
  return {lfo, pixelPath};
})();
