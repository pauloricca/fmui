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
  const points = Array.from({length:57}, (_, x) => `${x+3},${Math.round(16-12*operatorSample(wave,x/56))}`).join(' ');
  return `<svg class="wave-preview" viewBox="0 0 62 32" role="img" aria-label="Wave ${wave}: ${synth.waveNames[wave]}"><path class="wave-axis" d="M3 16H59"/><polyline points="${points}"/></svg>`;
}
function lfoWave(wave){return synth.lfoWave(wave)}
function shown(){return comparing?initial:voice}
function status(text){if(typeof MidiUI!=='undefined'){MidiUI.changed();if(MidiUI.config().live)text=text.replace(/LOCAL EDIT/g,'LIVE MIDI');}$('#status').textContent=text;$('#edit-state').textContent=comparing?'COMPARE / ORIGINAL':history.length?'EDIT BUFFER *':'EDIT BUFFER'}
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
const update=()=>{out.textContent=synth.formatValue(key,Number(input.value));out.style.setProperty('--position',`calc(${18-36*(1-(Number(input.value)-min)/(max-min))}px + ${(1-(Number(input.value)-min)/(max-min))*100}%)`)};input.refreshValue=update;update();let editing=false;
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
const arrow=document.createElement('span');arrow.className='down-arrow';arrow.textContent='▼';body.append(input,out,arrow)}el.refreshAvailability();return el}
function envelope(op,i){
const eg=synth.envelopePoints(op,i),line=eg.points.map(([x,y],n)=>`${n?'L':'M'}${x} ${y}`).join(' ');
const guides=comparing?'':(eg.guides||[]).filter(g=>!synth.controlReason(g.key,op,i)).map(g=>{
  const {x,y}=g;
  const path=g.axis==='x'?`M${x} 8V103`:`M3 ${y}H247`;
  return `<g class="env-guide ${envelopeDrag?.index===i&&envelopeDrag.key===g.key?'active':''}" data-key="${g.key}" data-axis="${g.axis}" style="cursor:${g.axis==='x'?'ew':'ns'}-resize"><path class="env-hit" d="${path}"/><path class="env-line" d="${path}"/><rect class="env-anchor" x="${x-3}" y="${y-3}" width="6" height="6"/><text class="env-label" x="${Math.min(222,x+5)}" y="${g.key==='D1L'?Math.min(100,y+13):Math.max(15,y-5)}">${g.key}</text></g>`;
}).join('');
return `<svg data-operator="${i}" class="envelope ${envelopeDrag?.index===i?'dragging':''}" viewBox="0 0 250 108" preserveAspectRatio="none" role="img" aria-label="Operator ${i+1} envelope, relative time"><defs><pattern id="dither${i}" width="2" height="2" patternUnits="userSpaceOnUse"><path d="M0 0h1v1H0z M1 1h1v1H1z" fill="black"/></pattern></defs><path d="${line} L247 103 L3 103 Z" fill="url(#dither${i})" stroke="black" stroke-width="1"/>${eg.keyOffX===undefined?'':`<path d="M${eg.keyOffX} 8V103" fill="none" stroke="black" stroke-dasharray="2 3"/>`}<text x="236" y="15" font-family="Atari" font-size="15">${i+1}</text><g class="env-guides">${guides}</g></svg>`}
function render(){const current=shown();$('#voice-name').value=current.name;$('#voice-name').disabled=comparing;$('#global-controls').replaceChildren(...globalSpecs.map(s=>control(s,synth.scope(s[0])==='operator')));$('#operator-controls').replaceChildren(...lowerSpecs().map(s=>control(s,true)));renderOperators();renderPitch();$('#compare').setAttribute('aria-pressed',String(comparing));$('#seed').disabled=comparing}
function renderAlgorithm(){
  const current=shown(),number=current.global.ALG,layout=synth.algorithms[number-1];
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
function renderOperators(){renderAlgorithm();const current=shown();$('#operators').replaceChildren();
current.operators.forEach((op,i)=>{const card=document.createElement('article');card.className='operator-card'+(selected===i?' selected':'');const top=document.createElement('div');top.className='operator-top';top.innerHTML=operatorWave(op.wave);
const waves=document.createElement('div');waves.className='wave-options';for(let w=0;w<synth.waveNames.length;w++){const b=document.createElement('button');b.textContent=w;b.setAttribute('aria-label',`Operator ${i+1} waveform ${w}`);b.setAttribute('aria-pressed',String(op.wave===w));b.disabled=comparing;b.onclick=()=>{selected=i;change('wave',w,true)};waves.append(b)}top.append(waves);const on=document.createElement('button');on.className='operator-toggle';on.innerHTML='OPER<br>-ON/<br>OFF-';on.setAttribute('aria-label',`Operator ${i+1} enabled`);on.setAttribute('aria-pressed',String(!!op.on));on.disabled=comparing;on.onclick=()=>{selected=i;change('on',op.on?0:1,true)};top.append(on);const select=document.createElement('button');select.className='operator-select';select.textContent=synth.carriers[current.global.ALG-1].includes(i)?'C':'M';select.setAttribute('aria-label',`Select operator ${i+1}`);select.setAttribute('aria-pressed',String(selected===i));select.onclick=()=>{selected=i;render();status(`OPERATOR ${i+1} SELECTED`)};top.append(select);card.append(top);const graph=document.createElement('div');graph.title=synth.envelopeTitle;graph.innerHTML=envelope(op,i);graph.onclick=e=>{if(!e?.target?.closest?.('.env-guide'))select.onclick()};card.append(graph);const meta=document.createElement('div');meta.className='operator-meta';meta.textContent=synth.operatorSummary(op);card.append(meta);$('#operators').append(card)});}
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
  selected=index;envelopeHost.style.cursor=guide.dataset.axis==='x'?'ew-resize':'ns-resize';envelopeHost.setPointerCapture(e.pointerId);render();
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
function undoVoice(){if(comparing||!history.length)return false;redoHistory.push(snapshot());restoreVoice(history.pop());status('LAST EDIT UNDONE');return true;}
function redoVoice(){if(comparing||!redoHistory.length)return false;history.push(snapshot());restoreVoice(redoHistory.pop());status('LAST EDIT REDONE');return true;}
$('#compare').onclick=()=>{comparing=!comparing;render();status(comparing?'ORIGINAL VOICE · PRESS COMPARE TO RETURN':'EDITED VOICE RESTORED')};
$('#seed').onclick=()=>{remember();synth.seed(voice);render();status('ENVELOPES RANDOMISED · ⌘Z TO RESTORE')};
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

document.addEventListener('keydown',e=>{if(e.key==='F1'){e.preventDefault();if(!$('#dialog').open)openDialog('help');return;}if((e.metaKey||e.ctrlKey)&&!e.altKey&&e.key.toLowerCase()==='z'&&!$('#dialog').open){e.preventDefault();const redo=e.shiftKey;const handled=typeof EffectsUI!=='undefined'&&EffectsUI.isVisible()?redo?EffectsUI.redo():EffectsUI.undo():redo?redoVoice():undoVoice();if(!handled)status(redo?'NOTHING TO REDO':'NOTHING TO UNDO');}});

function setPitch(active){pitchEditing=active&&!!synth.pitchSpecs;$('#show-pitch').setAttribute('aria-pressed',String(pitchEditing));$('#show-voice').setAttribute('aria-pressed',String(!pitchEditing));const specs=lowerSpecs();$('#operator-controls').setAttribute('aria-label',pitchEditing?'Global pitch envelope parameters':'Selected operator parameters');$('#operator-controls').style.setProperty('--control-count',specs.length);$('.bottom-captions').hidden=pitchEditing;render();}
function renderPitch(){let host=$('#pitch-preview');if(!host)return;host.hidden=!pitchEditing;if(!pitchEditing)return;const g=shown().global,op=Object.fromEntries(['R1','R2','R3','R4','L1','L2','L3','L4'].map(k=>[k,g['P'+k]]));const points=synth.envelopePoints(op).points.map(p=>p.join(',')).join(' ');host.innerHTML=`<span>PITCH EG · LEVEL 50 = NEUTRAL · L3 HOLD → KEY OFF → L4</span><svg viewBox="0 0 250 108" preserveAspectRatio="none" role="img" aria-label="Pitch envelope, relative time and level indices"><path d="M3 55H247" stroke="black" stroke-dasharray="2 3"/><polyline points="${points}" fill="none" stroke="black"/></svg>`;}
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
