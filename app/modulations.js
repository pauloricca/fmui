'use strict';
// Virtual sources use stable numeric slots, independent of their display names.
const Modulations = (() => {
  const state = {
    macros: Array.from({length: 8}, (_, i) => ({name: `MACRO ${i + 1}`, value: 0})),
    xy: {x: 50, y: 50, latch: false},
    lfos: Array.from({length: 2}, () => ({wave: 4, speed: 1, depth: 0})),
  };
  try {
    const names=JSON.parse(localStorage.getItem('yseditor-macro-names')||'[]');
    state.macros.forEach((m,i)=>{if(typeof names[i]==='string'&&names[i].trim())m.name=names[i].slice(0,16);});
  } catch {}
  if (typeof SessionStorage !== 'undefined') {
    const restored = SessionStorage.merge(state, SessionStorage.saved.modulations);
    restored.macros.forEach(m => {m.value = Math.max(0, Math.min(100, m.value)); m.name = m.name.slice(0,16);});
    for (const axis of ['x','y']) restored.xy[axis] = Math.max(0, Math.min(100, restored.xy[axis]));
    restored.lfos.forEach(l => {
      l.wave = Math.max(0, Math.min(6, Math.round(l.wave)));
      l.speed = Math.max(.01, Math.min(20, l.speed));
      l.depth = Math.max(0, Math.min(100, l.depth));
    });
    Object.assign(state, restored);
  }
  const screen = $('#modulations-screen');
  const make = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  };
  const targets = new Map();
  function bind(control, key, update) {
    targets.set(key, {control, update});
    addMappingAction(control, key, false, 0);
  }
  function refreshMappings() {
    for (const [key, {control}] of targets) {
      control.lastChild.remove();
      addMappingAction(control, key, false, 0);
    }
  }
  function setValue(key, value) {
    const target = targets.get(key);
    if (!target || !Number.isFinite(value)) return;
    const [,kind,index,param] = key.split(':');
    const bounds = param === 'speed' ? [.01,20] : param === 'wave' ? [0,6] : [0,100];
    const precision = param === 'speed' ? 100 : 1;
    value = Math.max(bounds[0], Math.min(bounds[1], Math.round(value * precision) / precision));
    state[kind === 'macro' ? 'macros' : 'lfos'][index][param] = value;
    target.update(value);
  }
  function slider(title, value, min, max, step, onInput, format = v => String(v), logarithmic = false) {
    const control = make('div', 'control');
    if(logarithmic)control.classList.add('mod-speed');
    const label = make('div', 'control-title', title);
    const body = make('div', 'slider-body');
    const input = make('input');
    const decode = raw => logarithmic ? Math.round(min * (max / min) ** (raw / 1000) * 100) / 100 : raw;
    Object.assign(input, logarithmic
      ? {type: 'range', min: 0, max: 1000, step: 1, value: Math.round(Math.log(value / min) / Math.log(max / min) * 1000)}
      : {type: 'range', min, max, step, value});
    input.setAttribute('aria-label', title);
    const output = make('output', 'slider-value');
    const update = () => {
      const fraction = logarithmic ? 1 - Number(input.value) / 1000 : 1 - (Number(input.value) - min) / (max - min);
      output.textContent = format(decode(Number(input.value)));
      input.setAttribute('aria-valuetext', output.textContent);
      output.style.setProperty('--position', `calc(${18 - 36 * fraction}px + ${fraction * 100}%)`);
    };
    input.oninput = () => {onInput(decode(Number(input.value))); update();};
    control.setValue = value => {
      input.value = logarithmic ? Math.round(Math.log(value / min) / Math.log(max / min) * 1000) : value;
      update();
    };
    update();
    body.append(input, output, make('span', 'down-arrow'));
    control.append(label, body);
    return control;
  }
  state.macros.forEach((macro, i) => {
    const control = slider(macro.name, macro.value, 0, 100, 1, v => macro.value = v);
    const name = make('input', 'mod-name');
    name.value = macro.name;
    name.maxLength = 16;
    name.setAttribute('aria-label', `Macro ${i + 1} name`);
    name.oninput = name.onchange = event => {
      macro.name = name.value.trim() || `MACRO ${i + 1}`;
      if(event.type==='change')name.value = macro.name;
      try {localStorage.setItem('yseditor-macro-names',JSON.stringify(state.macros.map(m=>m.name)));} catch {}
      control.querySelector('input[type=range]').setAttribute('aria-label', macro.name);
    };
    control.firstChild.replaceWith(name);
    bind(control, `mod:macro:${i}:value`, control.setValue);
    $('#mod-macros').append(control);
  });
  const xy = make('section', 'mod-panel');
  xy.append(make('h2', '', 'X–Y PAD'));
  const pad = make('div', 'mod-xy');
  const dot = make('span', 'mod-dot');
  pad.append(dot);
  xy.append(pad);
  const latch = make('button', 'mod-latch', 'LATCH');
  latch.setAttribute('aria-pressed', String(state.xy.latch));
  xy.append(latch);
  let pointer = null, returnFrame = null;
  function updatePad() {
    dot.style.left = `${state.xy.x}%`;
    dot.style.top = `${100 - state.xy.y}%`;
  }
  function stopReturn() {
    if (returnFrame !== null) cancelAnimationFrame(returnFrame);
    returnFrame = null;
  }
  function centerPad() {
    stopReturn();
    const {x, y} = state.xy;
    const start = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - start) / 300);
      // Ease out with a small overshoot for a spring-like release.
      const u = t - 1;
      const eased = 1 + 2.70158 * u * u * u + 1.70158 * u * u;
      state.xy.x = t === 1 ? 50 : x + (50 - x) * eased;
      state.xy.y = t === 1 ? 50 : y + (50 - y) * eased;
      updatePad();
      returnFrame = t < 1 ? requestAnimationFrame(frame) : null;
    }
    returnFrame = requestAnimationFrame(frame);
  }
  latch.onclick = () => {
    state.xy.latch = !state.xy.latch;
    latch.setAttribute('aria-pressed', String(state.xy.latch));
    if (state.xy.latch) stopReturn();
    else if (pointer === null) centerPad();
  };
  const move = e => {
    const rect = pad.getBoundingClientRect();
    state.xy.x = Math.round(Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100)));
    state.xy.y = Math.round(Math.max(0, Math.min(100, 100 - (e.clientY - rect.top) / rect.height * 100)));
    updatePad();
  };
  pad.onpointerdown = e => {
    if (pointer !== null || e.button !== 0) return;
    stopReturn();
    pointer = e.pointerId;
    pad.setPointerCapture(pointer);
    move(e);
  };
  pad.onpointermove = e => {if (e.pointerId === pointer) move(e);};
  pad.onpointerup = pad.onpointercancel = e => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    if (!state.xy.latch) centerPad();
    if (pad.hasPointerCapture(e.pointerId)) pad.releasePointerCapture(e.pointerId);
  };
  pad.onlostpointercapture = () => {
    if (pointer === null) return;
    pointer = null;
    if (!state.xy.latch) centerPad();
  };
  updatePad();
  $('#mod-top').append(xy);
  const waveNames = ['Triangle', 'Saw down', 'Saw up', 'Square', 'Sine', 'Sample and hold', 'Wander'];
  const phaseIndicators = [];
  state.lfos.forEach((lfo, i) => {
    const panel = make('section', 'mod-panel');
    const heading = make('h2', 'mod-lfo-heading', `LFO ${i + 1}`);
    const indicator = make('span', 'mod-lfo-phase');
    indicator.setAttribute('aria-hidden', 'true');
    heading.title = `LFO ${i + 1} · Bipolar output, scaled by depth`;
    indicator.append(make('span', 'mod-lfo-fill'));
    phaseIndicators.push(indicator.firstChild);
    heading.append(indicator);
    panel.append(heading);
    const controls = make('div', 'mod-lfo-controls');
    const waveControl = make('div', 'control');
    waveControl.append(make('div', 'control-title', 'LFW'));
    const waves = make('div', 'slider-body options mod-waves');
    waveNames.forEach((name, wave) => {
      const button = make('button');
      button.innerHTML = Waveforms.lfo(name);
      button.title = wave === 6 ? 'Wander · Smooth random motion' : name;
      button.setAttribute('aria-label', `LFO ${i + 1} ${name}`);
      button.setAttribute('aria-pressed', String(lfo.wave === wave));
      button.onclick = () => {
        lfo.wave = wave;
        [...waves.children].forEach((b, w) => b.setAttribute('aria-pressed', String(w === wave)));
      };
      waves.append(button);
    });
    waveControl.append(waves);
    controls.append(waveControl,
      slider(`SPEED`, lfo.speed, .01, 20, .01, v => lfo.speed = v, v => `${v.toFixed(2)} Hz`, true),
      slider('DEPTH', lfo.depth, 0, 100, 1, v => lfo.depth = v, v => `${v}%`));
    bind(waveControl, `mod:lfo:${i}:wave`, value => [...waves.children].forEach((b,w) => b.setAttribute('aria-pressed', String(w === value))));
    ['speed','depth'].forEach((key,n) => bind(controls.children[n+1], `mod:lfo:${i}:${key}`, controls.children[n+1].setValue));
    controls.querySelectorAll('input').forEach((input, n) => input.setAttribute('aria-label', `LFO ${i + 1} ${n ? 'depth' : 'speed'}`));
    panel.append(controls);
    $('#mod-top').append(panel);
  });
  function leave() {
    screen.hidden = true;
    $('#show-modulations').setAttribute('aria-pressed', 'false');
    $('#compare').disabled = false;
    $('#mappings').disabled = false;
  }
  for (const id of ['show-voice', 'show-effects', 'show-pitch', 'engine-4op', 'engine-6op']) {
    const button = $('#' + id);
    const previous = button.onclick;
    button.onclick = e => {
      const wasVisible = !screen.hidden;
      leave();
      if (wasVisible) EffectsUI.showVoice();
      if (previous) previous(e);
    };
  }
  $('#show-modulations').onclick = () => {
    EffectsUI.showVoice();
    $('#voice-screen').hidden = true;
    $('#effects-screen').hidden = true;
    screen.hidden = false;
    for (const id of ['show-voice', 'show-effects', 'show-pitch']) $('#' + id).setAttribute('aria-pressed', 'false');
    $('#show-modulations').setAttribute('aria-pressed', 'true');
    $('#seed').disabled = true;
    $('#compare').disabled = true;
    $('#mappings').disabled = false;
    refreshMappings();
    status('VIRTUAL MODULATIONS · LOCAL CONTROLS');
  };
  const phases=[0,0], held=[Math.random(),Math.random()];
  const cycles=[0,0], noiseSeeds=state.lfos.map(()=>Math.floor(Math.random()*0x100000000));
  // Smooth value noise: stable random lattice points, joined with a quintic
  // fade. Unwrapped time avoids restarting the wander at each LFO cycle.
  function noise(time,seed) {
    const point=n=>{
      let h=(n^seed)>>>0;
      h=Math.imul(h^(h>>>16),0x21f0aaad);
      h=Math.imul(h^(h>>>15),0x735a2d97);
      return ((h^(h>>>15))>>>0)/0xffffffff*2-1;
    };
    const cell=Math.floor(time),t=time-cell;
    const fade=t*t*t*(t*(t*6-15)+10);
    const a=point(cell),b=point(cell+1);
    return a+(b-a)*fade;
  }
  function wander(index) {
    const time=cycles[index]+phases[index],seed=noiseSeeds[index];
    return (noise(time,seed)+.35*noise(time*2,seed^0x9e3779b9))/1.35;
  }
  let previousTime=performance.now(), previousOutput='';
  function sample(index) {
    const lfo=state.lfos[index], p=phases[index];
    const value=lfo.wave===6? wander(index) : [1-4*Math.abs(p-.5),1-2*p,2*p-1,p<.5?1:-1,Math.sin(2*Math.PI*p),held[index]*2-1][lfo.wave];
    return .5 + value * lfo.depth / 200;
  }
  function apply(base) {
    const active=mappings.filter(m=>!targets.has(m.key)&&m.engine===synth.id&&['xy','lfo','macro'].includes(m.source));
    if(!active.length)return base;
    const result=structuredClone(base);
    for(const m of active){
      const op=result.operators[m.index];
      if(!op||synth.controlReason(m.key,op,m.index))continue;
      const amount=m.source==='xy'?state.xy[m.sourceId]/100:m.source==='macro'?state.macros[m.sourceId]?.value/100:state.lfos[m.sourceId]?sample(m.sourceId):NaN;
      if(!Number.isFinite(amount))continue;
      const bounds=synth.limits(m.key,op),range=m.range||bounds;
      const value=Math.max(bounds[0],Math.min(bounds[1],Math.round(range[0]+(range[1]-range[0])*mappingAmount(m,amount))));
      if(!synth.valid(m.key,value,op,m.index))continue;
      (m.isOp?op:result.global)[m.key]=value;
      synth.normalize(op);
    }
    return result;
  }
  // 20 Hz caps parameter traffic; transport coalesces pending changes by address.
  setInterval(()=>{
    const now=performance.now(), elapsed=(now-previousTime)/1000;previousTime=now;
    // Advance even when hidden, unmapped, comparing, or at zero depth.
    state.lfos.forEach((lfo,i)=>{
      const phase=phases[i]+elapsed*lfo.speed;
      if(phase>=1)held[i]=Math.random();
      cycles[i]+=Math.floor(phase);
      phases[i]=phase%1;
      const offset=(sample(i)-.5)*100;
      phaseIndicators[i].style.left=`${50+Math.min(0,offset)}%`;
      phaseIndicators[i].style.width=`${Math.abs(offset)}%`;
    });
    if(!comparing){
      // Snapshot sources before applying destinations so routing order cannot create recursion.
      const values = mappings.filter(m=>m.engine===synth.id&&targets.has(m.key)&&['xy','macro','lfo'].includes(m.source)).map(m=>{
        const amount=m.source==='xy'?state.xy[m.sourceId]/100:m.source==='macro'?state.macros[m.sourceId]?.value/100:state.lfos[m.sourceId]?sample(m.sourceId):NaN;
        const range=m.range||mappingLimits(m.key,m.index);
        return [m.key,range[0]+(range[1]-range[0])*mappingAmount(m,amount)];
      });
      values.forEach(([key,value])=>setValue(key,value));
    }
    const displayed=comparing?initial:apply(voice);
    if(!$('#voice-screen').hidden&&typeof renderAlgorithm==='function')renderAlgorithm(displayed);
    if(!$('#voice-screen').hidden&&typeof refreshEnvelopeGraphs==='function')refreshEnvelopeGraphs(displayed);
    const output=JSON.stringify(displayed);
    if(output===previousOutput)return;
    previousOutput=output;
    if(!$('#voice-screen').hidden&&!mappingMode&&!envelopeDrag&&document.activeElement?.tagName!=='INPUT'){
      for(const host of ['#global-controls','#operator-controls'])for(const control of $(host).children){
        const key=control.getAttribute('data-parameter');
        const value=(synth.scope(key)==='operator'?displayed.operators[selected]:displayed.global)[key];
        const input=control.querySelector('input[type=range]');
        if(input&&value!==undefined){input.value=value;input.refreshValue?.();}
      }
    }
    if(typeof MidiUI!=='undefined')MidiUI.changed();
  },50);
  return {getState: () => structuredClone(state),apply,setValue,refreshMappings};
})();
