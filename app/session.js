'use strict';
const Session = (() => {
  const saved = SessionStorage.saved;
  function buffer() { return {voice, initial, selected, history, redoHistory, comparing}; }
  function validVoice(id, value) {
    if (id === 'dx7') DX7.validate(value);
    else YS200Codec.encode(value);
    return structuredClone(value);
  }
  function restoreBuffer(id, value) {
    const profile = Synths.get(id);
    const entry = item => ({voice: validVoice(id, item.voice), initial: validVoice(id, item.initial), effects: item.effects || null});
    const stack = items => (Array.isArray(items) ? items.slice(-100) : []).flatMap(item => {
      try {return [entry(item)];} catch {return [];}
    });
    return {...entry(value), selected: Number.isInteger(value.selected) ? Math.max(0, Math.min(profile.operatorCount - 1, value.selected)) : 0,
      history: stack(value.history), redoHistory: stack(value.redoHistory), comparing: value.comparing === true};
  }
  for (const id of ['ys200','dx7']) {
    try {if (saved.buffers?.[id]) engineBuffers.set(id, restoreBuffer(id, saved.buffers[id]));} catch {}
  }
  // Effects must initialize on the default 4-op profile before selecting DX7.
  try {
    if (saved.effects) {
      const effect = saved.effects;
      Effects.validate(effect.effectState);
      Effects.validate(effect.effectInitial);
      for (const item of [...effect.effectHistory, ...effect.effectRedoHistory]) Effects.validate(item);
      EffectsUI.restore(effect);
    }
  } catch {}
  if (saved.engine === 'dx7') synth = Synths.get('dx7');
  const active = engineBuffers.get(synth.id);
  if (active) ({voice, initial, selected, history, redoHistory, comparing} = active);
  else {initial = synth.createVoice(); voice = structuredClone(initial);}
  ({globalSpecs, opSpecs} = synth);
  configureProfile();
  EffectsUI.showVoice();
  if (saved.view === 'modulations') $('#show-modulations').onclick();
  else if (saved.view === 'effects' && synth.effects) $('#show-effects').onclick();
  else setPitch(saved.view === 'pitch');
  if (saved.mappingMode && saved.view !== 'modulations') setMappingMode(true);
  MidiUI.restore(saved.midi);
  render();
  function snapshot() {
    return {
      engine: synth.id,
      buffers: {...Object.fromEntries(engineBuffers), [synth.id]: buffer()},
      effects: EffectsUI.snapshot(),
      modulations: Modulations.getState(),
      midi: MidiUI.snapshot(),
      view: !$('#modulations-screen').hidden ? 'modulations' : EffectsUI.isVisible() ? 'effects' : pitchEditing ? 'pitch' : 'voice',
      mappingMode,
    };
  }
  let failed = false;
  function save() {
    const ok = SessionStorage.write(snapshot());
    if (!ok && !failed) $('#status').textContent = 'SESSION COULD NOT BE SAVED · CHECK BROWSER STORAGE SPACE / PERMISSIONS';
    failed = !ok;
  }
  // Save after handlers finish, and catch asynchronous MIDI/keyboard edits too.
  let timer;
  const schedule = () => {clearTimeout(timer); timer = setTimeout(save, 0);};
  for (const event of ['input','change','click','pointerup','keyup']) document.addEventListener(event, schedule);
  setInterval(save, 1000);
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => {if (document.hidden) save();});
  return {save, snapshot};
})();
