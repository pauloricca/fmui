'use strict';
// YS200 presentation and defaults; the shared editor does not interpret these fields.
const YS200Profile = (() => {
const initial = {name:'DemoVoice',global:{ALG:5,FBL:7,SPD:31,DLY:1,LFW:2,PMD:20,AMD:0,SYNC:0,PMS:5,AMS:0,MONO:0,TRPS:0,CHrs:0,REV:0},operators:[
{wave:0,on:1,AME:0,EBS:0,KVS:1,FIX:0,FIXRG:0,CRS:6,FINE:0,DET:-3,SHIFT:0,AR:27,D1R:9,D1L:11,D2R:0,RR:4,RATE:0,LEVEL:20,OUT:92},
{wave:0,on:1,AME:0,EBS:0,KVS:1,FIX:0,FIXRG:0,CRS:3,FINE:0,DET:-1,SHIFT:0,AR:7,D1R:15,D1L:15,D2R:0,RR:4,RATE:0,LEVEL:20,OUT:81},
{wave:0,on:1,AME:0,EBS:0,KVS:1,FIX:0,FIXRG:0,CRS:3,FINE:0,DET:1,SHIFT:0,AR:16,D1R:31,D1L:15,D2R:0,RR:4,RATE:0,LEVEL:20,OUT:96},
{wave:0,on:1,AME:0,EBS:0,KVS:1,FIX:0,FIXRG:0,CRS:6,FINE:0,DET:3,SHIFT:0,AR:4,D1R:15,D1L:15,D2R:0,RR:4,RATE:0,LEVEL:20,OUT:62}]};
const globalSpecs=[['ALG','Algorithm',1,8],['FBL','Feedback level',0,7],['SPD','LFO speed',0,99],['DLY','LFO delay',0,99],['LFW','LFO waveform',['Saw up','Square','Triangle','Sample and hold']],['PMD','Pitch modulation depth',0,99],['AMD','Amplitude modulation depth',0,99],['SYNC','LFO sync',['OFF','ON']],['PMS','Pitch modulation sensitivity',0,7],['AMS','Amplitude modulation sensitivity',['0','1','2','3']],['AME','Operator amplitude modulation',['OFF','ON']],['EBS','Envelope bias sensitivity',0,7],['KVS','Key velocity sensitivity',0,7],['MONO','Voice mode',['POLY','MONO']],['TRPS','Transpose',-24,24]];
const opSpecs=[['FIX','Fixed frequency mode',['OFF','ON']],['FIXRG','Fixed frequency range',0,7],['CRS','Coarse frequency',0,63],['FINE','Fine frequency',0,15],['DET','Detune',-3,3],['SHIFT','Envelope shift',['Off','48','24','12']],['AR','Attack rate (31: immediate at key-on)',1,31],['D1R','Decay 1 rate (0: hold at peak)',0,31],['D1L','Decay 1 level',0,15],['D2R','Decay 2 rate (0: hold at D1L)',0,31],['RR','Release rate (15: fastest, finite release)',1,15],['REV','Reverb rate',0,7],['RATE','Keyboard rate scaling',['0','1','2','3']],['LEVEL','Keyboard level scaling',0,99],['OUT','Output level',0,99]];
const opKeys=new Set(['AME','EBS','KVS']);
const waveNames = ['Sine','Sine squared','Half sine','Half sine squared',
  'Compressed sine','Compressed sine squared','Double positive sine','Double positive sine squared'];
function operatorSample(wave, phase) {
  if (wave >= 2 && phase >= .5) return 0;
  let value = Math.sin(2 * Math.PI * phase * (wave >= 4 ? 2 : 1));
  if (wave >= 6) value = Math.abs(value);
  return wave % 2 ? Math.sign(value) * value * value : value;
}
const dialogs={about:['YSEDITOR / TRIBUTE','<p>A monochrome tribute to the Atari ST YSEDITOR by Joost Overmars and Martin Tarenskeen.</p><p>Recreated for the Yamaha YS200. This is a local interface prototype; MIDI and sound synthesis are not connected.</p><p><a href="https://yseditor.martintarenskeen.nl/" target="_blank" rel="noopener">Original YSEDITOR website</a></p>'],midi:['MIDI CONNECTION','<p>No MIDI transport is connected in this prototype.</p><p>Your edits stay in the browser. Receive, transmit and audition will become available when the MIDI layer is implemented.</p>'],help:['YSEDITOR HELP','<p>Drag a vertical slider to edit. Arrow keys make precise adjustments. Hover a label for its full parameter name.</p><p>Select the operator number above an envelope to edit that operator. The bottom row follows your selection.</p><p>COMPARE recalls the original voice. ⌘Z undoes and ⇧⌘Z redoes edits. RANDOMISE creates a playable voice for a randomly chosen algorithm, with controlled tuning, levels, envelopes and effects.</p><p>Envelope plots fit the full shape using a uniformly fitted relative time axis. Zero-rate decay is shown as a hold, followed by release. CRS and FIN are encoded frequency indices, not a ratio or Hz reading. The top-left diamond opens snapshot saving. Press F1 for help.</p>'],edit:['EDIT BUFFER','<p>Use ⌘Z to step back through your edits, ⇧⌘Z to redo, and COMPARE to view the original values.</p><p>RANDOMISE creates a playable voice for a randomly chosen algorithm. Carrier and modulator settings follow their routing; controller attenuation is reset and effects stay subtle. The voice name is preserved. All changes are local to this session.</p>'],control:['VOICE CONTROL','<p>Voice controls are available in the top row: LFO, modulation sensitivity, poly / mono and transpose. Chorus and pitch EG are ignored by the YS200.</p><p>Select an operator to access its AME, EBS and KVS controls.</p>'],pitch:['PITCH ENVELOPE','<p>The YS200 ignores the legacy DX pitch-envelope parameters.</p><p>The four amplitude envelopes remain editable on the main screen. Their time scale is relative, not calibrated to hardware.</p>'],file:['SAVE VOICE SNAPSHOT','<p>Save the current local voice as JSON. This is a prototype snapshot, not a synthesizer SysEx file.</p><div class="dialog-actions"><button type="button" id="save-json">SAVE JSON</button></div>']};

function lfoWave(wave) {return Waveforms.lfo(globalSpecs.find(spec=>spec[0]==='LFW')[2][wave]);}

return {
  lfoWave, ...YS200, id:'ys200', label:'Yamaha YS200', shortName:'YS200', status:'ready',
  operatorCount:4, nameLength:10, globalSpecs, opSpecs, waveNames, operatorSample, dialogs,
  scope:key=>opKeys.has(key)||opSpecs.some(s=>s[0]===key)&&key!=='REV'||key==='wave'||key==='on'?'operator':'global',
  // Presentation availability is separate from legal stored parameter values.
  controlReason(key,op,index){
    return YS200.reason(key,op,index)||
      (key==='D1R'&&op.D1L===15?'First decay is bypassed when D1L is 15.':
       key==='D2R'&&op.D1R===0&&op.D1L<15?'Second decay is not reached while first decay holds (D1R = 0).':
       key==='D2R'&&op.D1L===0?'Second decay has no level to decay when D1L is 0.':'');
  },
  numberedLabel:key=>opKeys.has(key),
  createVoice:()=>structuredClone(initial),
  effects:{codec:Effects, createState:()=>({preset:0,time:20,balance:50})},
  midi:{voiceCodec:null, transport:null},
  formatValue:(key,value)=>key==='FIXRG'?['255','510','1K','2K','4K','8K','16K','32K'][value]:key==='REV'&&value===0?'Off':String(value),
  operatorSummary:op=>`${YS200.frequencyLabel(op)} DET:${op.DET>=0?'+':''}${op.DET}
EG:${op.AR} ${op.D1R} ${op.D1L} ${op.D2R} ${op.RR} KLS:${op.LEVEL}
SENS:${op.EBS} ${op.KVS}  OUT LEVEL:${op.OUT}`,
  envelopeTitle:'Complete stage-relative envelope, not measured milliseconds. The full relative duration fits the width; finite stages have a one-pixel minimum. Release follows a representative held-note interval. Excludes output level, key scaling, velocity and reverb tail.',
  captions:{global:[['',1,3],['LOW FREQUENCY OSCILLATOR',3,9],['SENSITIVITY',9,14],['',14,16]],operator:[['OSCILLATOR',1,6],['ENVELOPE GENERATOR',6,12],['REV',12,13],['KBD SCALING',13,15],['OUT',15,16]]},
};
})();
