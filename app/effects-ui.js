'use strict';
const EffectsUI=(()=>{
if(!synth.effects){$('#show-voice').onclick=()=>setPitch(false);return {showVoice:()=>setPitch(false)};}
const effects=synth.effects.codec;
let effectsVisible=false;
const voiceCompare=$('#compare').onclick;
let effectInitial=synth.effects.createState();
let effectState=structuredClone(effectInitial),effectHistory=[],effectRedoHistory=[],effectCompare=false;
function effectShown(){return effectCompare?effectInitial:effectState;}
function effectRemember(){effectHistory.push(structuredClone(effectState));if(effectHistory.length>100)effectHistory.shift();effectRedoHistory=[];}
function effectStatus(message){$('#status').textContent=message;$('#edit-state').textContent=effectCompare?'EFFECTS / ORIGINAL':effectHistory.length?'EFFECT BUFFER *':'EFFECT BUFFER';}
function effectReadout(){const e=effectShown();$('#fx-name').textContent=(effects.names[e.preset]||'UNDOCUMENTED PRESET '+e.preset);$('#fx-summary').textContent=`${e.preset} / ${(effects.names[e.preset]||'UNDOCUMENTED PRESET '+e.preset)} · ${e.preset>=8?'SIZE':'TIME'} ${e.time} · BALANCE ${e.balance}${e.balance===0?' / OFF':''}`;$('#fx-description').textContent=e.preset>=8?'ROOM SIZE CONTROLS THE GATED REVERB.':[3,4,5,7].includes(e.preset)?'TIME CONTROLS THE DELAY / ECHO INTERVAL.':'TIME CONTROLS THE REVERB DURATION.';if(effectsVisible)$('#compare').setAttribute('aria-pressed',String(effectCompare));if(typeof MidiUI!=='undefined')MidiUI.changed();effectStatus('EFFECTS · '+(typeof MidiUI!=='undefined'&&MidiUI.transport.output&&MidiUI.transport.output.state!=='disconnected'?'LIVE MIDI':'LOCAL EDIT'));}
function renderEffects(){const e=effectShown();$('#fx-programs').replaceChildren(...effects.names.map((name,i)=>{const b=document.createElement('button');b.textContent=`${i}  ${name}`;b.setAttribute('aria-pressed',String(e.preset===i));b.disabled=effectCompare;b.onclick=()=>{effectRemember();effectState.preset=i;renderEffects();};return b;}));
$('#fx-controls').replaceChildren(...[['time',e.preset>=8?'ROOM SIZE':'TIME',40],['balance','BALANCE',99]].map(([key,title,max])=>{const el=document.createElement('div');el.className='control';el.setAttribute('data-disabled',String(effectCompare));if(effectCompare)el.title='Compare mode shows the original effects.';const label=document.createElement('label');label.className='control-title';label.textContent=title;label.htmlFor='fx-'+key;const body=document.createElement('div');body.className='slider-body';const input=document.createElement('input');input.type='range';input.id='fx-'+key;input.min=0;input.max=max;input.step=1;input.value=e[key];input.disabled=effectCompare;input.setAttribute('aria-label',title+(key==='time'?' (MIDI index)':''));const output=document.createElement('output');output.className='slider-value';output.htmlFor=input.id;const update=()=>{const fraction=1-Number(input.value)/max;output.textContent=input.value;output.style.setProperty('--position',`calc(${18-36*fraction}px + ${fraction*100}%)`);};update();let dragging=false;input.oninput=()=>{if(effectCompare)return;const next={...effectState,[key]:Number(input.value)};try{effects.validate(next);}catch{return;}if(!dragging){effectRemember();dragging=true;}effectState=next;update();effectReadout();};input.onchange=input.onblur=()=>{dragging=false;};const arrow=document.createElement('span');arrow.className='down-arrow';body.append(input,output,arrow);el.append(label,body);return el;}));effectReadout();}
function showView(effectsTab){
  effectsTab=effectsTab&&!!synth.effects;
  if(!effectsTab)setPitch(false);
  effectsVisible=effectsTab;
  $('.editor-screen').hidden=effectsTab;$('#effects-screen').hidden=!effectsTab;
  $('#show-voice').setAttribute('aria-pressed',String(!effectsTab));
  $('#show-effects').setAttribute('aria-pressed',String(effectsTab));
  if(effectsTab){$('#seed').disabled=true;renderEffects();}
  else{render();status('VOICE EDITOR · LOCAL EDIT');}
}
$('#show-effects').onclick=()=>showView(true);
$('#show-voice').onclick=()=>showView(false);
const compareEffects=()=>{effectCompare=!effectCompare;renderEffects();};
const undoEffects=()=>{if(effectCompare||!effectHistory.length)return false;effectRedoHistory.push(structuredClone(effectState));effectState=effectHistory.pop();renderEffects();effectStatus('LAST EFFECT EDIT UNDONE');return true;};
const redoEffects=()=>{if(effectCompare||!effectRedoHistory.length)return false;effectHistory.push(structuredClone(effectState));effectState=effectRedoHistory.pop();renderEffects();effectStatus('LAST EFFECT EDIT REDONE');return true;};
$('#compare').onclick=()=>effectsVisible?compareEffects():voiceCompare();

return {showVoice:()=>showView(false),isVisible:()=>effectsVisible,undo:undoEffects,redo:redoEffects,getState:()=>structuredClone(effectShown()),snapshot:()=>structuredClone({effectState,effectInitial,effectHistory,effectRedoHistory,effectCompare}),restore(saved){({effectState,effectInitial,effectHistory,effectRedoHistory=[],effectCompare}=structuredClone(saved));if(effectsVisible)renderEffects();},setState(state,baseline=true){effects.validate(state);effectState=structuredClone(state);if(baseline){effectInitial=structuredClone(state);effectHistory=[];effectRedoHistory=[];}effectCompare=false;if(effectsVisible)renderEffects();}};
})();
