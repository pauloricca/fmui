'use strict';
// Visual tribute to the Atari YSEDITOR editing page. Local voice editor; optional profile-specific SysEx codecs.
const $ = s => document.querySelector(s);
let synth=Synths.get("ys200");
let initial=synth.createVoice();
let voice=structuredClone(initial),selected=0,history=[],redoHistory=[],comparing=false;
let envelopeDrag=null;
let {globalSpecs,opSpecs}=synth;
let pitchEditing=false;
const engineBuffers=new Map();
const MAPPINGS_KEY='yseditor-controller-mappings-v1';
let mappingMode=false,mappingAccess=null,learnMapping=null,learnPointerCancelled=false;
let mappings=[];
const mappingInputs=new WeakSet();
try{const saved=JSON.parse(localStorage.getItem(MAPPINGS_KEY)||'[]');if(Array.isArray(saved))mappings=saved.filter(m=>m&&typeof m.target==='string')}catch{}
function saveMappings(){if(typeof Modulations!=='undefined')Modulations.refreshMappings();try{localStorage.setItem(MAPPINGS_KEY,JSON.stringify(mappings))}catch{}}
function mappingKey(key,isOp,index=selected){return `${synth.id}:${isOp?'operator:'+index:'global'}:${key}`}
function mappingFor(key,isOp,index=selected){return mappings.find(m=>m.target===mappingKey(key,isOp,index))}
const midiMappingSources={cc:{label:'CC'},pitch:{label:'PITCH WHEEL'},mod:{label:'MOD WHEEL',cc:1},breath:{label:'BREATH CONTROLLER',cc:2},foot:{label:'FOOT VOLUME PEDAL',cc:4}};
function mappingLabel(mapping){
  if(mapping.source==='xy')return 'X-Y '+mapping.sourceId.toUpperCase();
  if(mapping.source==='lfo')return 'LFO '+(Number(mapping.sourceId)+1);
  if(mapping.source==='macro')return typeof Modulations!=='undefined'?Modulations.getState().macros[mapping.sourceId]?.name||'MACRO':'MACRO';
  return mapping.midiSource&&mapping.midiSource!=='cc'?midiMappingSources[mapping.midiSource]?.label||'MIDI':`CC ${mapping.cc}`;
}
function cancelMappingLearn(message='LEARN CANCELLED'){
  if(!learnMapping)return false;learnMapping=null;
  const learn=$('#mapping-learn');if(learn){learn.textContent='LEARN';learn.setAttribute('aria-pressed','false')}
  const hint=$('#mapping-hint');if(hint)hint.textContent=message;return true;
}
function setMappingMode(active){mappingMode=active;const windowEl=$('.window');if(windowEl.classList.toggle)windowEl.classList.toggle('mapping-active',active);else windowEl.classList[active?'add':'remove']('mapping-active');$('#mappings').setAttribute('aria-pressed',String(active));$('#mappings').title=active?'Exit controller mappings':'Toggle controller mappings';if(!active)learnMapping=null;render();status(active?'MAPPING MODE · HOVER A CONTROL TO MAP':'MAPPING MODE CLOSED')}
function addMappingAction(el,key,isOp,index=selected,actionHost=el,actionClass=''){
  el.classList.add('mapping-target');
  const action=document.createElement('button');action.type='button';action.className='mapping-action'+(actionClass?' '+actionClass:'');
  const mapped=mappingFor(key,isOp,index);action.textContent=mapped?mappingLabel(mapped):'MAP';
  if(mapped)action.classList.add('has-mapping');
  action.setAttribute('aria-label',mapped?`${key} mapped to ${mappingLabel(mapped)}`:`Map ${key}`);
  const activateMapping=e=>{e.preventDefault();e.stopPropagation();openMapping({key,isOp,index});};
  action.onclick=activateMapping;
  el.onclick=e=>{if(mappingMode)activateMapping(e);};
  actionHost.append(action);
}
function modulationTarget(key){return /^mod:(macro:[0-7]:value|lfo:[01]:(wave|speed|depth))$/.test(key)}
function mappingLimits(key,index){return modulationTarget(key)?(key.endsWith(':speed')?[.01,20]:key.endsWith(':wave')?[0,6]:[0,100]):synth.limits(key,voice.operators[index]);}
// Normalize the active portion of a source before scaling to its destination.
function mappingAmount(mapping, value){
  const [min,max]=mapping.sourceRange||[0,1];
  if(max<=min)return value<=min?0:1;
  return Math.max(0,Math.min(1,(value-min)/(max-min)));
}
function mappedChange(mapping,value,maximum=127){
  if(mapping.engine!==synth.id||comparing)return;
  const amount=mappingAmount(mapping,value/maximum);
  if(modulationTarget(mapping.key)){const range=mapping.range||mappingLimits(mapping.key,mapping.index);Modulations.setValue(mapping.key,range[0]+(range[1]-range[0])*amount);return;}
  const [min,max]=mapping.range||synth.limits(mapping.key,voice.operators[mapping.index]||voice.operators[selected]);
  const scaled=Math.round(min+(max-min)*amount);
  const previous=selected; if(mapping.isOp)selected=mapping.index;
  change(mapping.key,scaled,mapping.isOp);selected=previous;if(mapping.isOp)render();
}
function handleMappingMessage(event,input){
  const data=Array.from(event.data||event),type=data[0]&240;
  if(data.length<3||![176,224].includes(type)||!data.slice(1,3).every(v=>Number.isInteger(v)&&v>=0&&v<=127))return;
  const channel=(data[0]&15)+1,cc=type===176?data[1]:null;
  const value=type===224?data[1]+(data[2]<<7):data[2],maximum=type===224?16383:127;
  if(learnMapping&&(!learnMapping.device||learnMapping.device===input?.id)){
    const source=type===224?'pitch':Object.keys(midiMappingSources).find(k=>midiMappingSources[k].cc===cc)||'cc';
    $('#mapping-channel').value=String(channel);
    if(cc!==null)$('#mapping-cc').value=String(cc);
    $('#mapping-midi-source').value=source;$('#mapping-midi-source').onchange();learnMapping=null;
    const learn=$('#mapping-learn');if(learn){learn.textContent='LEARN';learn.setAttribute('aria-pressed','false')}const hint=$('#mapping-hint');if(hint)hint.textContent=`LEARNED CH ${channel} · ${mappingLabel({midiSource:source,cc})}`;return;
  }
  mappings.filter(m=>{
    if((m.source&&m.source!=='midi')||(m.device&&m.device!==input?.id)||m.channel!==channel)return false;
    const source=m.midiSource||'cc';
    return source==='pitch'?type===224:type===176&&cc===(source==='cc'?m.cc:midiMappingSources[source]?.cc);
  }).forEach(m=>mappedChange(m,value,maximum));
}
async function prepareMappingMidi(){
  if(mappingAccess)return mappingAccess;
  if(typeof navigator==='undefined'||!navigator.requestMIDIAccess)throw Error('Web MIDI is unavailable in this browser.');
  mappingAccess=await navigator.requestMIDIAccess();
  const attach=()=>{for(const input of mappingAccess.inputs.values()){if(!mappingInputs.has(input)){input.addEventListener?.('midimessage',e=>handleMappingMessage(e,input));mappingInputs.add(input);}}};
  attach();mappingAccess.onstatechange=attach;return mappingAccess;
}
async function openMapping(target){
  const existing=mappingFor(target.key,target.isOp,target.index);
  let mode=existing?.source||'midi';
  const limits=mappingLimits(target.key,target.index);
  const fractional=modulationTarget(target.key)&&target.key.endsWith(':speed');
  $('#dialog-title').textContent=existing?'EDIT MAPPING':'MAP CONTROL';
  $('#dialog-content').innerHTML=`<div class="mapping-tabs" role="group" aria-label="Mapping source">${['midi','xy','lfo','macro'].map(m=>`<button type="button" id="mapping-tab-${m}" aria-pressed="false">${m==='xy'?'X-Y':m.toUpperCase()}</button>`).join('')}</div>
  <p class="mapping-target-name">${target.isOp?'OP '+(target.index+1)+' / ':''}${target.key}</p>
  <div id="mapping-midi"><div class="mapping-fields"><label class="mapping-device">MIDI DEVICE IN<select id="mapping-device"><option value="">ANY MIDI INPUT</option></select></label></div>
  <div class="mapping-fields"><label class="mapping-device">SOURCE<select id="mapping-midi-source">${Object.entries(midiMappingSources).map(([value,{label}])=>`<option value="${value}">${label}</option>`).join('')}</select></label></div>
  <div class="mapping-midi-row mapping-fields"><label>CHANNEL<input id="mapping-channel" type="number" min="1" max="16" value="${existing?.channel||1}"></label><label id="mapping-cc-field">CC<input id="mapping-cc" type="number" min="0" max="127" value="${existing?.cc??1}"></label><button type="button" class="mapping-learn" id="mapping-learn" aria-pressed="false">LEARN</button></div></div>
  <div id="mapping-virtual" class="mapping-fields"><label class="mapping-device">SOURCE<select id="mapping-source"></select></label></div>
  <div class="mapping-fields"><label>MIN VALUE<input id="mapping-min" type="number" step="${fractional?.01:1}" value="${existing?.range?.[0]??limits[0]}"></label><label>MAX VALUE<input id="mapping-max" type="number" step="${fractional?.01:1}" value="${existing?.range?.[1]??limits[1]}"></label></div>
  <div class="mapping-fields mapping-source-range">${['min','max'].map((name,i)=>`<label for="mapping-source-${name}">SOURCE ${name.toUpperCase()} <output id="mapping-source-${name}-value" for="mapping-source-${name}">${(existing?.sourceRange?.[i]??i).toFixed(2)}</output><input id="mapping-source-${name}" type="range" min="0" max="1" step="0.01" value="${existing?.sourceRange?.[i]??i}"></label>`).join('')}</div>
  <p id="mapping-hint" class="mapping-hint"></p><div class="dialog-actions">${existing?'<button type="button" id="mapping-remove">REMOVE</button>':''}<button type="button" id="mapping-cancel">CANCEL</button><button type="button" id="mapping-save">SAVE</button></div>`;
  for(const name of ['min','max']){
    const input=$('#mapping-source-'+name);
    input.oninput=()=>{
      const other=$('#mapping-source-'+(name==='min'?'max':'min'));
      if(name==='min'&&Number(input.value)>=Number(other.value))input.value=Math.max(0,Number(other.value)-.01);
      if(name==='max'&&Number(input.value)<=Number(other.value))input.value=Math.min(1,Number(other.value)+.01);
      $('#mapping-source-'+name+'-value').textContent=Number(input.value).toFixed(2);
    };
  }
  const midiSource=$('#mapping-midi-source');
  midiSource.value=existing?.midiSource||'cc';
  midiSource.onchange=()=>{
    cancelMappingLearn();
    $('#mapping-cc-field').hidden=midiSource.value!=='cc';
    $('#mapping-learn').hidden=midiSource.value!=='cc';
    if(typeof RetroSelect!=='undefined')RetroSelect.enhance($('#dialog-content'));
  };
  midiSource.onchange();
  const selections={xy:'x',lfo:'0',macro:'0'};
  if(existing?.sourceId!==undefined)selections[mode]=String(existing.sourceId);
  function selectMode(next){
    if(mode!=='midi'&&$('#mapping-source').value)selections[mode]=$('#mapping-source').value;
    cancelMappingLearn();mode=next;
    for(const m of ['midi','xy','lfo','macro'])$('#mapping-tab-'+m).setAttribute('aria-pressed',String(m===mode));
    $('#mapping-midi').hidden=mode!=='midi';$('#mapping-virtual').hidden=mode==='midi';
    const choices=mode==='xy'?[['x','X AXIS'],['y','Y AXIS']]:mode==='lfo'?[['0','LFO 1'],['1','LFO 2']]:mode==='macro'?(typeof Modulations!=='undefined'?Modulations.getState().macros:[]).map((m,i)=>[String(i),m.name]):[];
    $('#mapping-source').replaceChildren(...choices.map(([value,label])=>{const o=document.createElement('option');o.value=value;o.textContent=label;return o;}));
    $('#mapping-source').value=selections[mode]||'';
    $('#mapping-hint').textContent=mode==='midi'?'Choose a source or use LEARN.':'Choose a source and its destination range.';
    if(typeof RetroSelect!=='undefined')RetroSelect.enhance($('#dialog-content'));
  }
  for(const m of ['midi','xy','lfo','macro'])$('#mapping-tab-'+m).onclick=()=>selectMode(m);
  selectMode(mode);
  $('#mapping-learn').onclick=()=>{if(learnPointerCancelled){learnPointerCancelled=false;return;}learnMapping={device:$('#mapping-device').value};$('#mapping-learn').textContent='LISTENING…';$('#mapping-learn').setAttribute('aria-pressed','true');$('#mapping-hint').textContent='Move a controller now.';};
  if(existing)$('#mapping-remove').onclick=()=>{mappings=mappings.filter(m=>m.target!==existing.target);saveMappings();learnMapping=null;$('#dialog').close();render();status(`${target.key} MAPPING REMOVED`);};
  $('#mapping-cancel').onclick=()=>{$('#dialog').close();learnMapping=null};
  $('#mapping-save').onclick=()=>{
    const channel=Number($('#mapping-channel').value),cc=Number($('#mapping-cc').value),min=Number($('#mapping-min').value),max=Number($('#mapping-max').value);
    if((mode==='midi'&&(!Number.isInteger(channel)||channel<1||channel>16||(midiSource.value==='cc'&&(!Number.isInteger(cc)||cc<0||cc>127))))||!(fractional?Number.isFinite(min):Number.isInteger(min))||!(fractional?Number.isFinite(max):Number.isInteger(max))||min<limits[0]||min>limits[1]||max<limits[0]||max>limits[1]){$('#mapping-hint').textContent='CHECK SOURCE AND PARAMETER VALUE RANGE.';return;}
    const sourceMin=Number($('#mapping-source-min').value),sourceMax=Number($('#mapping-source-max').value);
    if(!Number.isFinite(sourceMin)||!Number.isFinite(sourceMax)||sourceMin<0||sourceMax>1||sourceMin>=sourceMax){$('#mapping-hint').textContent='SOURCE MIN MUST BE LOWER THAN SOURCE MAX.';return;}
    const mapping={target:mappingKey(target.key,target.isOp,target.index),engine:synth.id,key:target.key,isOp:target.isOp,index:target.index,source:mode,range:[min,max],sourceRange:[sourceMin,sourceMax]};
    if(mode==='midi')Object.assign(mapping,{device:$('#mapping-device').value,channel,midiSource:midiSource.value,...(midiSource.value==='pitch'?{}:{cc:midiSource.value==='cc'?cc:midiMappingSources[midiSource.value].cc})});
    else mapping.sourceId=mode==='xy'?$('#mapping-source').value:Number($('#mapping-source').value);
    mappings=mappings.filter(m=>m.target!==mapping.target);mappings.push(mapping);saveMappings();learnMapping=null;$('#dialog').close();render();status(`${target.key} MAPPED TO ${mappingLabel(mapping)}`);
  };
  $('#dialog').showModal();
  try{const access=await prepareMappingMidi();if(!$('#dialog').open)return;for(const input of access.inputs.values()){const option=document.createElement('option');option.value=input.id;option.textContent=input.name||input.id;$('#mapping-device').append(option)}if(existing?.device)$('#mapping-device').value=existing.device;}catch(e){if(mode==='midi')$('#mapping-hint').textContent=e.message;}
  if(typeof RetroSelect!=='undefined')RetroSelect.enhance($('#dialog-content'));
}
const DISPLAY_OVERLAY_KEY='yseditor-display-overlay';
function displayOverlayEnabled(){
  try{return localStorage.getItem(DISPLAY_OVERLAY_KEY)==='on';}
  catch{return false;}
}
function setDisplayOverlay(enabled,{announce=false}={}){
  document.documentElement?.setAttribute('data-display-overlay',String(enabled));
  const toggle=$('#display-overlay');
  toggle.setAttribute('aria-pressed',String(enabled));
  toggle.title=enabled?'Disable LCD display colour':'Enable LCD display colour';
  try{localStorage.setItem(DISPLAY_OVERLAY_KEY,enabled?'on':'off');}catch{}
  if(announce)status(enabled?'LCD DISPLAY COLOUR ON':'LCD DISPLAY COLOUR OFF');
}
function lowerSpecs(){return pitchEditing?synth.pitchSpecs:opSpecs;}
// Yamaha TX81Z manual, pp. 15, 18 and 50. UI indices 0–7 = Yamaha W1–W8.
// Sine-derived icon geometry, not an audio emulation or measured wavetable.
function operatorSample(wave,phase){return synth.operatorSample(wave,phase)}
function operatorWave(wave) {
  const points = Array.from({length:57}, (_, x) => [x+3,16-12*operatorSample(wave,x/56)]);
  return `<svg class="wave-preview" viewBox="0 0 62 32" role="img" aria-label="Wave ${wave}: ${synth.waveNames[wave]}"><path class="wave-axis" d="M3 16H59"/><path class="wave-pixels" d="${Waveforms.pixelPath(points)}"/></svg>`;
}
function lfoWave(wave){return synth.lfoWave(wave)}
function shown(){return comparing?initial:typeof Modulations!=='undefined'?Modulations.apply(voice):voice}
function status(text){if(typeof MidiUI!=='undefined'){MidiUI.changed();if(MidiUI.config().live)text=text.replace(/LOCAL EDIT/g,'LIVE MIDI');}$('#status').textContent=text;}
function snapshot(includeEffects=false){return {voice:structuredClone(voice),initial:structuredClone(initial),effects:includeEffects&&synth.effects&&typeof EffectsUI!=='undefined'?EffectsUI.snapshot():null};}
function remember(includeEffects=false){history.push(snapshot(includeEffects));if(history.length>100)history.shift();redoHistory=[];}
function change(key,value,isOp){isOp=synth.scope(key)==='operator';if(comparing||synth.controlReason(key,voice.operators[selected],selected)||!synth.valid(key,value,voice.operators[selected],selected))return;const focused=document.activeElement?.id;remember();(isOp?voice.operators[selected]:voice.global)[key]=value;synth.normalize(voice.operators[selected]);render();if(focused)document.getElementById(focused)?.focus();status(`${isOp?'OP '+(selected+1)+' / ':''}${key} = ${value}  ·  LOCAL EDIT`)}
function control(spec,isOp){let [key,title,min,max]=spec;const operator=shown().operators[selected];const disabledReason=synth.controlReason(key,operator,selected);isOp=synth.scope(key)==='operator';if(!Array.isArray(min)&&synth.ranges[key])[min,max]=synth.limits(key,operator);const value=(isOp?shown().operators[selected]:shown().global)[key]??0;const el=document.createElement('div');el.className='control';el.setAttribute('data-parameter',key);const editable=[];
const label=document.createElement('label');label.className='control-title';label.textContent=key+(synth.numberedLabel(key)?selected+1:'');label.title=disabledReason||title;el.append(label);
const body=document.createElement('div');body.className='slider-body';el.append(body);
el.refreshAvailability=()=>{
  const reason=comparing?'Compare mode shows the original voice.':synth.controlReason(key,shown().operators[selected],selected);
  el.setAttribute('data-disabled',String(!!reason));
  el.title=label.title=reason||title;
  for(const input of editable){input.disabled=!!reason;input.title=reason||input.getAttribute?.('aria-label')||title;}
};
el.refreshAvailability();
if(synth.unsupported[key]){body.className+=' unavailable';body.textContent='N/A';body.title=disabledReason;return el;}
if(Array.isArray(min)){body.classList.add('options');[...min.keys()].reverse().forEach(i=>{const b=document.createElement('button');if(key==='LFW')b.innerHTML=lfoWave(i);else b.textContent=min[i];b.title=title+': '+min[i];b.setAttribute('aria-label',title+': '+min[i]);b.setAttribute('aria-pressed',String(value===i));b.disabled=comparing||!!disabledReason;editable.push(b);b.onclick=()=>change(key,i,isOp);body.append(b)})}
else{const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.value=value;input.id=(isOp?'op-':'global-')+key;input.setAttribute('aria-label',title);input.disabled=comparing||!!disabledReason;editable.push(input);input.title=disabledReason||title;label.htmlFor=input.id;const out=document.createElement('output');out.className='slider-value';out.htmlFor=input.id;
const update=()=>{const min=Number(input.min),max=Number(input.max),position=1-(Number(input.value)-min)/(max-min);out.textContent=synth.formatValue(key,Number(input.value));out.style.setProperty('--position',`calc(${18-36*position}px + ${position*100}%)`)};input.refreshValue=update;update();let editing=false;
input.oninput=()=>{
  if(comparing||synth.controlReason(key,voice.operators[selected],selected)||!synth.valid(key,Number(input.value),voice.operators[selected],selected))return;
  if(!editing){remember();editing=true;}
  (isOp?voice.operators[selected]:voice.global)[key]=Number(input.value);
  synth.normalize(voice.operators[selected]);
  for(const spec of [...globalSpecs,...lowerSpecs()]){const otherKey=spec[0],scope=synth.scope(otherKey);const input=$('#'+(scope==='operator'?'op-':'global-')+otherKey);if(input?.refreshValue){const bounds=synth.limits(otherKey,voice.operators[selected]);if(bounds){input.min=bounds[0];input.max=bounds[1];}input.value=(scope==='operator'?voice.operators[selected]:voice.global)[otherKey];input.refreshValue();}}
  for(const selector of ['#global-controls','#operator-controls'])for(const control of $(selector).children)control.refreshAvailability();
  update();renderOperators();renderPitch();
  status(`${isOp?'OP '+(selected+1)+' / ':''}${title.toUpperCase()} = ${input.value} · LOCAL EDIT`);
};
input.onchange=()=>{editing=false;};input.onblur=()=>{editing=false;};
const arrow=document.createElement('span');arrow.className='down-arrow';arrow.textContent='▼';body.append(input,out,arrow)}addMappingAction(el,key,isOp,selected);el.refreshAvailability();return el}
function envelope(op,i){
const eg=synth.envelopePoints(op,i),line=eg.points.map(([x,y],n)=>`${n?'L':'M'}${x} ${y}`).join(' ');
const guides=comparing?'':(eg.guides||[]).filter(g=>!synth.controlReason(g.key,op,i)).map(g=>{
  const {x,y}=g;
  const path=g.axis==='x'?`M${x} 8V103`:`M3 ${y}H247`;
  return `<g class="env-guide ${envelopeDrag?.index===i&&envelopeDrag.key===g.key?'active':''}" data-key="${g.key}" data-axis="${g.axis}" style="cursor:${g.axis==='x'?'ew':'ns'}-resize"><path class="env-hit" d="${path}"/><path class="env-line" d="${path}"/><rect class="env-anchor" x="${x-3}" y="${y-3}" width="6" height="6"/><text class="env-label" x="${Math.min(222,x+5)}" y="${g.key==='D1L'?Math.min(100,y+13):Math.max(15,y-5)}">${g.key}</text></g>`;
}).join('');
const fillPoints=[...eg.points,[247,103],[3,103]].map(([x,y])=>`${x/250*100}% ${y/108*100}%`).join(',');
return `<div class="envelope-plot"><div class="envelope-fill-mask" style="filter:url(#env-hard-edges-${i})" aria-hidden="true"><div class="envelope-fill ${op.on?'':'envelope-fill-off'}" style="clip-path:polygon(${fillPoints})"></div></div><svg data-operator="${i}" class="envelope ${envelopeDrag?.index===i?'dragging':''}" viewBox="0 0 250 108" preserveAspectRatio="none" role="img" aria-label="Operator ${i+1} envelope, relative time"><defs><filter id="env-hard-edges-${i}" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer></filter></defs><path filter="url(#env-hard-edges-${i})" d="${line} L247 103 L3 103 Z" fill="none" stroke="black" stroke-width="1"/>${eg.keyOffX===undefined?'':`<path d="M${eg.keyOffX} 8V103" fill="none" stroke="black" stroke-dasharray="2 3"/>`}<g class="env-guides">${guides}</g></svg></div>`}
function render(){const current=shown();$('#voice-name').value=current.name;$('#voice-name').disabled=comparing;$('#global-controls').replaceChildren(...globalSpecs.map(s=>control(s,synth.scope(s[0])==='operator')));$('#operator-controls').replaceChildren(...lowerSpecs().map(s=>control(s,true)));renderOperators();renderPitch();$('#compare').setAttribute('aria-pressed',String(comparing));$('#seed').disabled=comparing||$('#modulations-screen')?.hidden===false||$('#effects-screen')?.hidden===false}
function renderAlgorithm(current=shown()){
  const number=current.global.ALG,layout=synth.algorithms[number-1];
  const host=$('#algorithm-diagram');
  const signature=`${synth.id}:${number}:${current.global.FBL}:${selected}`;
  if(host.algorithmSignature===signature)return;
  host.algorithmSignature=signature;
  current.operators.forEach((_,i)=>{
    const top=$('#operators').children[i]?.children[0];
    const role=top&&Array.from(top.children).find(child=>child.className==='operator-role');
    if(role){role.textContent=synth.carriers[number-1].includes(i)?'C':'M';role.setAttribute('aria-label',`Operator ${i+1} ${role.textContent==='C'?'carrier':'modulator'}`);}
  });
  const wires=layout.edges.map(([from,to])=>{
    const [x,y]=layout.positions[from],[tx,ty]=layout.positions[to];
    const mid=(y+10+ty-10)/2;
    return `<path d="M${x} ${y+10}V${mid}H${tx}V${ty-10}"/>`;
  }).join('');
  const outputs=synth.carriers[number-1].map(i=>{const [x,y]=layout.positions[i];return `<path d="M${x} ${y+10}V150H60"/>`;}).join('');
  const feedback=layout.feedback;
  const feedbackWires=feedback.map(([from,to])=>{const [fx,fy]=layout.positions[from],[tx,ty]=layout.positions[to];return `<path class="feedback-wire" d="M${fx+10} ${fy}H${fx+17}V${ty-20}H${tx}V${ty-10}"/>`;}).join("");
  const top=Math.max(0,Math.min(...layout.positions.map(p=>p[1]))-24);
  const nodes=layout.positions.map(([x,y],i)=>`<g id="algorithm-op-${i}" class="algorithm-node ${i===selected?'selected':''}" data-operator="${i}" role="button" tabindex="0" aria-label="Select operator ${i+1}" aria-pressed="${i===selected}"><rect x="${x-10}" y="${y-10}" width="20" height="20"/><text x="${x}" y="${y+5}">${i+1}</text></g>`).join('');
  $('#algorithm-diagram').innerHTML=`<div class="control-title">ALG ${number}</div><svg viewBox="0 ${top} ${synth.diagramWidth||124} ${168-top}" role="group" aria-label="Algorithm ${number}, feedback ${feedback.map(([from,to])=>`on operator ${from+1} to operator ${to+1}`).join(", ")}, level ${current.global.FBL}"><g class="algorithm-wires">${wires}${outputs}<path d="M60 150V160"/>${feedbackWires}</g>${nodes}<text class="algorithm-output" x="66" y="164">OUT</text></svg>`;
}
// Delegate to the persistent container because rendering replaces the SVG nodes.
function selectDiagramOperator(event){
  const node=event.target.closest?.('.algorithm-node');
  if(!node)return;
  const index=Number(node.dataset.operator);
  if(!Number.isInteger(index)||index<0||index>=synth.operatorCount)return;
  if(event.type==='keydown'){
    if(event.key!=='Enter'&&event.key!==' ')return;
    event.preventDefault();
    if(event.repeat)return;
  }
  selected=index;render();
  $('#algorithm-op-'+index).focus();
  status(`OPERATOR ${index+1} SELECTED`);
}
$('#algorithm-diagram').onclick=selectDiagramOperator;
$('#algorithm-diagram').onkeydown=selectDiagramOperator;
function refreshEnvelopeGraphs(current=shown()){
  current.operators.forEach((op,i)=>{
    const card=$('#operators').children[i];
    if(!card||envelopeDrag?.index===i)return;
    const graph=card.children[1],markup=envelope(op,i);
    if(graph.envelopeMarkup!==markup){graph.innerHTML=markup;graph.envelopeMarkup=markup;}
    card.children[2].textContent=synth.operatorSummary(op);
  });
  const pitch=$('#pitch-preview');
  if(pitchEditing&&pitch){
    const signature=JSON.stringify(current.global);
    if(pitch.envelopeSignature!==signature){renderPitch();pitch.envelopeSignature=signature;}
  }
}
function renderOperators(){renderAlgorithm();const current=shown();$('#operators').replaceChildren();
current.operators.forEach((op,i)=>{const card=document.createElement('article');card.className='operator-card'+(selected===i?' selected':'');const top=document.createElement('div');top.className='operator-top';const preview=document.createElement('div');preview.className='operator-wave';preview.innerHTML=operatorWave(op.wave);
const waves=document.createElement('div');waves.className='wave-options';for(let w=0;w<synth.waveNames.length;w++){const b=document.createElement('button');b.textContent=w;b.setAttribute('aria-label',`Operator ${i+1} waveform ${w}`);b.setAttribute('aria-pressed',String(op.wave===w));b.disabled=comparing;b.onclick=()=>{selected=i;change('wave',w,true)};waves.append(b)}addMappingAction(waves,'wave',true,i,top,'wave-map-action');const onHost=document.createElement('div');onHost.className='operator-toggle-host';const on=document.createElement('button');on.className='operator-toggle';on.textContent=op.on?'ON':'OFF';on.setAttribute('aria-label',`Operator ${i+1} enabled`);on.setAttribute('aria-pressed',String(!!op.on));on.disabled=comparing;on.onclick=()=>{selected=i;change('on',op.on?0:1,true)};onHost.append(on);addMappingAction(onHost,'on',true,i,top,'on-map-action');const select=document.createElement('button');select.className='operator-select';select.textContent=i+1;select.setAttribute('aria-label',`Select operator ${i+1}`);select.setAttribute('aria-pressed',String(selected===i));select.onclick=()=>{selected=i;render();status(`OPERATOR ${i+1} SELECTED`)};const role=document.createElement('span');role.className='operator-role';role.textContent=synth.carriers[current.global.ALG-1].includes(i)?'C':'M';role.setAttribute('aria-label',`Operator ${i+1} ${role.textContent==='C'?'carrier':'modulator'}`);top.onclick=e=>{if(!e.target.closest?.('button'))select.onclick()};top.append(select,role,onHost,preview,waves);card.append(top);const graph=document.createElement('div');graph.title=synth.envelopeTitle;graph.innerHTML=envelope(op,i);graph.onclick=e=>{if(!e?.target?.closest?.('.env-guide'))select.onclick()};card.append(graph);const meta=document.createElement('div');meta.className='operator-meta';meta.textContent=synth.operatorSummary(op);card.append(meta);$('#operators').append(card)});}
// Capture on the persistent operator container so live graph rendering never
// interrupts a drag. Values are measured from pointer-down, avoiding drift.
const envelopeHost=$('#operators');
envelopeHost.onpointerdown=e=>{
  const guide=e.target.closest?.('.env-guide'),svg=e.target.closest?.('.envelope');
  if(!guide||!svg||comparing||e.button!==0||envelopeDrag)return;
  const index=Number(svg.dataset.operator),key=guide.dataset.key,op=voice.operators[index];
  if(!op||synth.controlReason(key,op,index))return;
  e.preventDefault();
  envelopeDrag={index,key,axis:guide.dataset.axis,startX:e.clientX,startY:e.clientY,value:op[key],pointerId:e.pointerId,remembered:false};
  selected=index;envelopeHost.style.cursor=guide.dataset.axis==='x'?'var(--cursor-ew-resize,ew-resize)':'var(--cursor-ns-resize,ns-resize)';envelopeHost.setPointerCapture(e.pointerId);render();
};
envelopeHost.onpointermove=e=>{
  const d=envelopeDrag;if(!d||e.pointerId!==d.pointerId||comparing)return;
  const op=voice.operators[d.index],[min,max]=synth.limits(d.key,op);
  const delta=d.axis==='x'?(d.startX-e.clientX):d.startY-e.clientY;
  // Profiles choose whether zero can be reached by a graph drag.
  const dragMin=synth.envelopeDragMin?synth.envelopeDragMin(d.key,min):Math.max(1,min);
  const value=Math.max(dragMin,Math.min(max,d.value+Math.round(delta/(e.shiftKey?12:4))));
  if(value===op[d.key])return;
  if(!d.remembered){remember();d.remembered=true;}
  op[d.key]=value;render();
  status(`OP ${d.index+1} / ${d.key} = ${value} · LOCAL EDIT`);
};
function finishEnvelopeDrag(e){
  if(!envelopeDrag||e.pointerId!==envelopeDrag.pointerId)return;
  envelopeDrag=null;envelopeHost.style.cursor='';
  if(envelopeHost.hasPointerCapture(e.pointerId))envelopeHost.releasePointerCapture(e.pointerId);
  render();
}
envelopeHost.onpointerup=finishEnvelopeDrag;
envelopeHost.onpointercancel=finishEnvelopeDrag;
envelopeHost.onlostpointercapture=finishEnvelopeDrag;
$('#voice-name').onchange=e=>{remember();voice.name=e.target.value.replace(/[^\x20-\x7e]/g,'?').slice(0,synth.nameLength);e.target.value=voice.name;status('VOICE RENAMED · LOCAL EDIT')};
function restoreVoice(saved){({voice,initial}=saved);if(saved.effects&&typeof EffectsUI!=='undefined')EffectsUI.restore(saved.effects);render();}
function undoVoice(){if(comparing||!history.length)return false;redoHistory.push(snapshot(!!history.at(-1).effects));restoreVoice(history.pop());status('LAST EDIT UNDONE');return true;}
function redoVoice(){if(comparing||!redoHistory.length)return false;history.push(snapshot(!!redoHistory.at(-1).effects));restoreVoice(redoHistory.pop());status('LAST EDIT REDONE');return true;}
$('#compare').onclick=()=>{comparing=!comparing;render();status(comparing?'ORIGINAL VOICE · PRESS COMPARE TO RETURN':'EDITED VOICE RESTORED')};
$('#seed').onclick=()=>{
  if($('#seed').disabled)return;
  remember(true);
  const effects=Synths.randomise(synth,voice);
  if(effects&&typeof EffectsUI!=='undefined')EffectsUI.setState(effects,false);
  render();status('VOICE RANDOMISED · ⌘Z TO RESTORE');
};
$('#zoom').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{status('FULLSCREEN IS NOT AVAILABLE IN THIS BROWSER')}};

function openDialog(type){const [title,html]=synth.dialogs[type];$('#dialog-title').textContent=title;$('#dialog-content').innerHTML=html;$('#dialog').showModal();if(type==='file'&&synth.midi.voiceCodec)setupVoiceFiles();if(type==='file')$('#save-json').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(Synths.snapshot(synth,voice),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=(voice.name.replace(/[^a-z0-9_-]/gi,'_')||'voice')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('VOICE SNAPSHOT SAVED')}}
document.querySelectorAll('[data-dialog]').forEach(b=>b.onclick=()=>openDialog(b.dataset.dialog));['receive','transmit'].forEach(id=>$('#'+id).onclick=()=>openDialog('midi'));
function configureProfile(){
document.title=synth.shortName+' · YSEDITOR Tribute';
$('.window-title h1').textContent='YAMAHA '+synth.operatorCount+'-OP EDITOR';
$('#receive').textContent='RECEIVE VOICE';
$('#transmit').textContent='SEND VOICE';
$('#voice-name').maxLength=synth.nameLength;
$('#operators').setAttribute('aria-label',synth.operatorCount+' operators');
$('#operators').style.setProperty('--operator-count',synth.operatorCount);
$('#show-effects').hidden=!synth.effects;
$('#show-pitch').hidden=!synth.pitchSpecs;
$('.window').setAttribute('data-engine',synth.id);
$('#engine-6op').setAttribute('aria-pressed',String(synth.id==='dx7'));
$('#engine-4op').setAttribute('aria-pressed',String(synth.id==='ys200'));
for(const [selector,specs] of [['#global-controls',globalSpecs],['#operator-controls',opSpecs]])$(selector).style.setProperty('--control-count',specs.length);
for(const [selector,groups,count] of [['.group-captions',synth.captions.global,globalSpecs.length],['.bottom-captions',synth.captions.operator,opSpecs.length]]){
  $(selector).style.setProperty('--control-count',count);
  $(selector).replaceChildren(...groups.map(([text,start,end])=>{const el=document.createElement('span');el.textContent=text;el.style.gridColumn=start+'/'+end;return el;}));
}
}
configureProfile();render();
setDisplayOverlay(displayOverlayEnabled());
$('#display-overlay').onclick=()=>setDisplayOverlay(!displayOverlayEnabled(),{announce:true});
$('#mappings').onclick=()=>setMappingMode(!mappingMode);
document.addEventListener('pointerdown',()=>{learnPointerCancelled=cancelMappingLearn()},true);

document.addEventListener('keydown',e=>{if(e.key==='F1'){e.preventDefault();if(!$('#dialog').open)openDialog('help');return;}if((e.metaKey||e.ctrlKey)&&!e.altKey&&e.key.toLowerCase()==='z'&&!$('#dialog').open){e.preventDefault();const redo=e.shiftKey;const handled=typeof EffectsUI!=='undefined'&&EffectsUI.isVisible()?redo?EffectsUI.redo():EffectsUI.undo():redo?redoVoice():undoVoice();if(!handled)status(redo?'NOTHING TO REDO':'NOTHING TO UNDO');}});

function setPitch(active){pitchEditing=active&&!!synth.pitchSpecs;$('#show-pitch').setAttribute('aria-pressed',String(pitchEditing));$('#show-voice').setAttribute('aria-pressed',String(!pitchEditing));const specs=lowerSpecs();$('#operator-controls').setAttribute('aria-label',pitchEditing?'Global pitch envelope parameters':'Selected operator parameters');$('#operator-controls').style.setProperty('--control-count',specs.length);$('.bottom-captions').hidden=pitchEditing;render();}
function renderPitch(){let host=$('#pitch-preview');if(!host)return;host.hidden=!pitchEditing;if(!pitchEditing)return;const g=shown().global;host.envelopeSignature=JSON.stringify(g);const op=Object.fromEntries(['R1','R2','R3','R4','L1','L2','L3','L4'].map(k=>[k,g['P'+k]]));const points=synth.envelopePoints(op).points.map(p=>p.join(',')).join(' ');host.innerHTML=`<span>PITCH EG · LEVEL 50 = NEUTRAL · L3 HOLD → KEY OFF → L4</span><svg viewBox="0 0 250 108" preserveAspectRatio="none" role="img" aria-label="Pitch envelope, relative time and level indices"><path d="M3 55H247" stroke="black" stroke-dasharray="2 3"/><polyline points="${points}" fill="none" stroke="black"/></svg>`;}
function switchEngine(id){if(id===synth.id||envelopeDrag)return;if(typeof EffectsUI!=='undefined')EffectsUI.showVoice();engineBuffers.set(synth.id,{voice,initial,selected,history,redoHistory,comparing});synth=Synths.get(id);const saved=engineBuffers.get(id)||{initial:synth.createVoice(),voice:synth.createVoice(),selected:0,history:[],redoHistory:[],comparing:false};({voice,initial,selected,history,redoHistory,comparing}=saved);({globalSpecs,opSpecs}=synth);pitchEditing=false;configureProfile();setPitch(false);status(synth.shortName+' · LOCAL EDIT BUFFER RESTORED');}
$('#engine-6op').onclick=()=>switchEngine('dx7');
$('#engine-4op').onclick=()=>switchEngine('ys200');
$('#show-pitch').onclick=()=>setPitch(!pitchEditing);
function downloadVoice(bytes,extension){const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));const a=document.createElement('a');a.href=url;a.download=(voice.name.replace(/[^a-z0-9_-]/gi,'_')||'voice')+extension;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function setupVoiceFiles(){const profile=synth;for(let n=1;n<=16;n++){const o=document.createElement('option');o.value=n;o.textContent=n;$('#syx-channel').append(o);}$('#save-syx').onclick=()=>{downloadVoice(profile.midi.voiceCodec.bulk(shown(),Number($('#syx-channel').value)),'.syx');$('#file-result').textContent='Voice exported. Operator mutes are temporary and are not stored in SysEx.';};$('#load-syx').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const result=profile.midi.voiceCodec.parse(new Uint8Array(await file.arrayBuffer()));if(synth!==profile)return;const load=v=>{remember();voice=structuredClone(v);initial=structuredClone(v);comparing=false;selected=0;render();$('#dialog').close();status('DX7 VOICE IMPORTED · ⌘Z TO RESTORE PREVIOUS EDIT');};if(result.voices.length===1)load(result.voices[0]);else{const list=$('#bank-voices');list.replaceChildren(...result.voices.map((v,i)=>{const b=document.createElement('button');b.type='button';b.textContent=(i+1)+'. '+v.name;b.onclick=()=>load(v);return b;}));$('#file-result').textContent='32-voice bank validated. Choose a voice to edit.';}}catch(error){$('#file-result').textContent=error.message;}};}

// Close only a click that starts and ends on the backdrop, not a drag from a control.
const modal=$('#dialog');
const outsideModal=e=>{const r=modal.getBoundingClientRect();return e.target===modal&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom);};
let backdropPressed=false;
modal.onpointerdown=e=>{backdropPressed=outsideModal(e);};
modal.onpointerup=e=>{if(backdropPressed&&outsideModal(e))modal.close();backdropPressed=false;};
modal.onpointercancel=()=>{backdropPressed=false;};
$('#dialog-close').onclick=()=>modal.close();
modal.onclose=()=>{learnMapping=null};

// Portable voice snapshots keep all stored parameters, including operator mutes.
$('#save-voice').onclick=()=>{
  const data=Synths.snapshot(synth,comparing?initial:voice);
  if(synth.effects)data.effects=EffectsUI.getState();
  downloadVoice(JSON.stringify(data,null,2),'.json');
  status('VOICE FILE SAVED');
};
$('#load-voice').onclick=()=>$('#voice-file').click();
$('#voice-file').onchange=async e=>{
  const file=e.target.files[0];
  e.target.value='';
  if(!file)return;
  try{
    if(file.size>1024*1024)throw Error('Voice file is too large');
    const data=JSON.parse(await file.text());
    if(data.format!=='fm-editor-voice'||data.version!==1)throw Error('Unsupported voice file format');
    const profile=Synths.get(data.synthId);
    if(profile.id==='dx7')DX7.validate(data.voice);else YS200Codec.validate(data.voice);
    if(data.effects!==undefined){if(!profile.effects)throw Error('Effects are unsupported for this voice');Effects.validate(data.effects);}
    const loaded=structuredClone(data.voice);
    switchEngine(profile.id);
    remember(true);
    voice=loaded;initial=structuredClone(loaded);comparing=false;selected=0;
    if(data.effects!==undefined)EffectsUI.setState(data.effects);
    render();
    status('VOICE FILE LOADED · ⌘Z TO RESTORE PREVIOUS EDIT');
  }catch(error){$('#status').textContent='LOAD FAILED · '+error.message;}
};
