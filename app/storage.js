'use strict';
// One versioned session; legacy mapping/name/display keys remain compatible.
const SessionStorage = (() => {
  const key = 'yseditor-session-v1';
  let saved = {};
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (value?.version === 1) saved = value;
  } catch {}
  // Restore known fields only, keeping defaults for malformed values.
  function merge(defaults, value) {
    if (Array.isArray(defaults)) return defaults.map((v, i) => merge(v, value?.[i]));
    if (defaults && typeof defaults === 'object') return Object.fromEntries(
      Object.entries(defaults).map(([k, v]) => [k, merge(v, value?.[k])]),
    );
    return typeof value === typeof defaults && (typeof value !== 'number' || Number.isFinite(value)) ? value : defaults;
  }
  let previous = '';
  function write(value) {
    try {
      const json = JSON.stringify({version: 1, ...value});
      if (json !== previous) { localStorage.setItem(key, json); previous = json; }
      return true;
    } catch { return false; }
  }
  return {saved, merge, write};
})();
