const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
// Minimal DOM fixture: run the actual UI handlers without a browser dependency.
function editor(setup="",midi=false,storage=null){
  const nodes=new Map();
  class Element{
    constructor(){this.children=[];this.attributes={};this.style={setProperty(){}};this.classList={add(){},remove(){}};}
    set id(v){this._id=v;nodes.set('#'+v,this)}get id(){return this._id}
    append(...children){this.children.push(...children)}
    replaceChildren(...children){this.children=children}
    setAttribute(k,v){this.attributes[k]=v}focus(){}close(){this.open=false}showModal(){this.open=true}
  }
  const document={querySelector(s){if(!nodes.has(s))nodes.set(s,new Element());return nodes.get(s)},querySelectorAll(){return []},createElement(){return new Element()},addEventListener(){},activeElement:null};
  const timers=new Map();let timerId=0;const context=vm.createContext({document,structuredClone,console,TextDecoder,localStorage:storage,setInterval(){},window:{addEventListener(){}},setTimeout(fn,ms){timers.set(++timerId,{fn,ms});return timerId;},clearTimeout(id){timers.delete(id);}});
  vm.runInContext(fs.readFileSync('app/ys200.js','utf8'),context);
  vm.runInContext(fs.readFileSync('app/effects.js','utf8'),context);
  vm.runInContext(fs.readFileSync('app/waveforms.js','utf8'),context);
  vm.runInContext(fs.readFileSync('app/ys200-profile.js','utf8'),context);
  vm.runInContext(fs.readFileSync('app/dx7.js','utf8'),context);
  vm.runInContext(fs.readFileSync('app/dx7-profile.js','utf8'),context);
  vm.runInContext(fs.readFileSync('app/synths.js','utf8'),context);
  if(storage)vm.runInContext(fs.readFileSync('app/storage.js','utf8'),context);
  vm.runInContext(setup,context);
  vm.runInContext(fs.readFileSync('app/editor.js','utf8'),context);
  vm.runInContext(fs.readFileSync('app/effects-ui.js','utf8'),context);
  if(midi)for(const name of ['midi-protocol','midi-transport','midi-ui'])vm.runInContext(fs.readFileSync('app/'+name+'.js','utf8'),context);
  return {get:s=>document.querySelector(s),run:s=>vm.runInContext(s,context),timers};
}
test('input updates voice, graph and labels before change; a drag is one undo step',()=>{
  const e=editor(),slider=e.get('#op-AR');
  const before=e.get('#operators').children[0].children[1].innerHTML;
  slider.value='15';slider.oninput();
  assert.equal(e.run('voice.operators[0].AR'),15);
  assert.notEqual(e.get('#operators').children[0].children[1].innerHTML,before);
  assert.match(e.get('#operators').children[0].children[2].textContent,/EG:15 /);
  slider.value='8';slider.oninput();
  assert.equal(e.run('voice.operators[0].AR'),8);
  assert.equal(e.get('#op-AR'),slider,'the active slider must not be replaced');
  assert.equal(e.run('history.length'),1);
  slider.onchange();e.run('undoVoice()');
  assert.equal(e.run('voice.operators[0].AR'),27);
});
test('live envelope refresh uses effective values without replacing controls or changing the base voice',()=>{
  const e=editor(),slider=e.get('#op-AR'),card=e.get('#operators').children[0];
  const before=card.children[1].innerHTML;
  e.run('const effective=structuredClone(voice);effective.operators[0].AR=8;refreshEnvelopeGraphs(effective)');
  assert.notEqual(card.children[1].innerHTML,before);
  assert.match(card.children[2].textContent,/EG:8 /);
  assert.equal(e.get('#operators').children[0],card);
  assert.equal(e.get('#op-AR'),slider);
  assert.equal(e.run('voice.operators[0].AR'),27);
  e.run('refreshEnvelopeGraphs()');
  assert.equal(card.children[1].innerHTML,before);
});
test('waveform preview follows selection, and compare/undo restore it',()=>{
  const e=editor();e.run("change('wave',7,true)");
  assert.match(e.get('#operators').children[0].children[0].children.find(c=>c.className==='operator-wave').innerHTML,/Wave 7: Double positive sine squared/);
  e.get('#compare').onclick();assert.match(e.get('#operators').children[0].children[0].children.find(c=>c.className==='operator-wave').innerHTML,/Wave 0: Sine/);
  e.get('#compare').onclick();e.run('undoVoice()');assert.equal(e.run('voice.operators[0].wave'),0);
});
test('Yamaha waveform families preserve polarity and silent half cycles',()=>{
  const e=editor();
  assert.ok(e.run('operatorSample(0,.75)')<0);
  for(let w=2;w<8;w++)assert.equal(e.run(`operatorSample(${w},.75)`),0);
  assert.ok(e.run('operatorSample(4,.375)')<0);
  assert.ok(e.run('operatorSample(6,.375)')>0);
  assert.equal(e.run('new Set(Array.from({length:8},(_,w)=>operatorWave(w))).size'),8);
});
test('YS200 ranges reject invalid edits and legacy-only controls',()=>{
  const e=editor();
  for(const [key,value] of [['AR',0],['AR',32],['RR',0],['D2R',32],['D2R',1.5],['CHrs',1],['FIXRM',1],['SHIFT',1]]){
    const before=e.run('JSON.stringify(voice)');e.run(`change('${key}',${value},true)`);
    assert.equal(e.run('JSON.stringify(voice)'),before,`${key}=${value}`);
  }
  e.run("change('D2R',31,true)");assert.equal(e.run('voice.operators[0].D2R'),31);
});
test('zero decay holds, D1L=15 bypasses first decay, and faster D2R decays sooner',()=>{
  const e=editor();
  e.run('voice.operators[0].AR=31;voice.operators[0].D1L=15;voice.operators[0].D2R=0');
  assert.equal(e.run('YS200.envelopePoints(voice.operators[0]).offLevel'),1);
  e.run('voice.operators[0].D2R=31');assert.equal(e.run('YS200.envelopePoints(voice.operators[0]).offLevel'),.5);
  e.run('voice.operators[0].D1L=4;voice.operators[0].D1R=0');
  assert.equal(e.run('YS200.envelopePoints(voice.operators[0]).offLevel'),1);
  e.run('voice.operators[0].D1R=31;voice.operators[0].D1L=0');
  assert.equal(e.run('YS200.envelopePoints(voice.operators[0]).offLevel'),0);
});
test('envelope remains bounded and monotonic in time across extremes',()=>{
  const e=editor();
  for(const ar of [1,31])for(const d1r of [0,31])for(const d1l of [0,15])for(const d2r of [0,31])for(const rr of [1,15]){
    const points=e.run(`YS200.envelopePoints({...voice.operators[0],AR:${ar},D1R:${d1r},D1L:${d1l},D2R:${d2r},RR:${rr}}).points`);
    for(let i=0;i<points.length;i++){
      assert.ok(points[i][1]>=8&&points[i][1]<=103);
      if(i)assert.ok(points[i][0]>=points[i-1][0]);
    }
  }
});
test('fine range follows coarse/mode and reverb is shared by all operators',()=>{
  const e=editor();e.run("change('FINE',15,true);change('CRS',0,true)");
  assert.equal(e.run('voice.operators[0].FINE'),7);
  e.run("change('FIX',1,true);change('FINE',15,true)");
  assert.equal(e.run('voice.operators[0].FINE'),15);
  const reverb=e.get('#global-REV');reverb.value='5';reverb.oninput();
  assert.equal(e.run('voice.global.REV'),5);
  e.run('selected=2;render()');assert.equal(e.get('#global-REV').value,5);
});

test('Fine readout stays on its thumb when CRS changes the live range in either direction',()=>{
  for(const initialCoarse of [0,8]){
    const e=editor();
    e.run(`voice.operators[0].CRS=${initialCoarse};voice.operators[0].FINE=7;render()`);
    const coarse=e.get('#op-CRS'),fine=e.get('#op-FINE');
    const control=e.get('#operator-controls').children.find(c=>c.attributes['data-parameter']==='FINE');
    const output=control.children[1].children[1];
    let position;
    output.style.setProperty=(key,value)=>{if(key==='--position')position=value;};
    for(const value of [0,8,0,8]){
      coarse.value=String(value);coarse.oninput();
      assert.equal(e.get('#op-FINE'),fine);
      assert.equal(Number(fine.max),value===0?7:15);
      assert.equal(Number(output.textContent),7);
      const fraction=1-7/Number(fine.max);
      assert.equal(position,`calc(${18-36*fraction}px + ${fraction*100}%)`);
    }
  }
});

test('full relative envelope fits even the slowest attack and release',()=>{
  const e=editor();
  for(const ar of [1,31])for(const rr of [1,15]){
    const points=e.run(`YS200.envelopePoints({...voice.operators[0],AR:${ar},RR:${rr},D1L:8,D1R:10,D2R:10}).points`);
    assert.equal(points[0][0],3);assert.equal(points.at(-1)[0],247);
    assert.equal(points.at(-1)[1],103);assert.ok(points.some(p=>p[1]===8));
    for(let i=1;i<points.length;i++)assert.ok((ar===31&&i===1&&points[i][0]===points[i-1][0])||points[i][0]-points[i-1][0]>=1-1e-8);
  }
});
test('algorithm diagram follows live ALG changes and includes four nodes and feedback',()=>{
  const e=editor(),slider=e.get('#global-ALG');
  for(let alg=1;alg<=8;alg++){
    slider.value=String(alg);slider.oninput();
    const html=e.get('#algorithm-diagram').innerHTML;
    assert.match(html,new RegExp(`Algorithm ${alg}, feedback on operator 4`));
    assert.equal((html.match(/<rect /g)||[]).length,4);
    assert.match(html,/feedback-wire/);
  }
});

test('maximum attack is vertical, while 30 still has a finite attack',()=>{
  const e=editor();
  const instant=e.run('YS200.envelopePoints({...voice.operators[0],AR:31})');
  assert.equal(instant.attack,0);assert.equal(instant.points[0][0],instant.points[1][0]);
  assert.equal(instant.points[1][1],8);
  const slower=e.run('YS200.envelopePoints({...voice.operators[0],AR:30})');
  assert.ok(slower.attack>0);assert.ok(slower.points[1][0]>slower.points[0][0]);
});
test('D1R zero makes later decay settings unreachable except at D1L 15',()=>{
  const e=editor();
  const held=e.run('YS200.envelopePoints({...voice.operators[0],D1R:0,D1L:4,D2R:31})');
  assert.equal(held.hold,'D1 HOLD');assert.equal(held.offLevel,1);
  const changed=e.run('YS200.envelopePoints({...voice.operators[0],D1R:0,D1L:12,D2R:1})');
  assert.equal(JSON.stringify(held.points),JSON.stringify(changed.points));
  const decay=e.run('YS200.envelopePoints({...voice.operators[0],D1R:1,D1L:4,D2R:31})');
  assert.ok(decay.offLevel<1);
  const bypass=e.run('YS200.envelopePoints({...voice.operators[0],D1R:0,D1L:15,D2R:31})');
  assert.notEqual(bypass.hold,'D1 HOLD');assert.ok(bypass.offLevel<1);
});
test('every envelope value and shift produces finite, fully bounded geometry',()=>{
  const e=editor();let cases=0;
  for(const [key,min,max] of [['AR',1,31],['D1R',0,31],['D1L',0,15],['D2R',0,31],['RR',1,15]]){
    for(let v=min;v<=max;v++)for(let shift=0;shift<4;shift++){
      const points=e.run(`YS200.envelopePoints({...voice.operators[1],${key}:${v},SHIFT:${shift}},1).points`);
      assert.equal(points[0][0],3);assert.equal(points.at(-1)[0],247);
      for(let i=0;i<points.length;i++){
        assert.ok(points[i].every(Number.isFinite));assert.ok(points[i][1]>=8&&points[i][1]<=103);
        if(i)assert.ok(points[i][0]>=points[i-1][0]);
      }cases++;
    }
  }assert.equal(cases,504);
});
test('all algorithm edges terminate in the documented carriers and have no modulation cycles',()=>{
  const e=editor();
  for(let alg=0;alg<8;alg++){
    const layout=e.run(`YS200.algorithms[${alg}]`),carriers=e.run(`YS200.carriers[${alg}]`);
    const sources=new Set(layout.edges.map(x=>x[0]));
    assert.equal(JSON.stringify([0,1,2,3].filter(x=>!sources.has(x))),JSON.stringify(carriers));
    const walk=(node,visited=new Set())=>{
      assert.ok(!visited.has(node));const next=new Set(visited);next.add(node);
      for(const [from,to] of layout.edges)if(from===node)walk(to,next);
    };for(let i=0;i<4;i++)walk(i);
  }
});
test('all declared parameter boundaries accept legal integers and reject out-of-range data',()=>{
  const e=editor();
  const ranges=e.run('YS200.ranges');
  for(const [key,[min,max]] of Object.entries(ranges)){
    const check=value=>e.run(`YS200.valid('${key}',${value},{...voice.operators[1],CRS:8,FIX:1},1)`);
    assert.equal(check(min),true,key+' minimum');assert.equal(check(max),true,key+' maximum');
    assert.equal(check(min-1),false,key+' below minimum');assert.equal(check(max+1),false,key+' above maximum');
    assert.equal(check(min+.5),false,key+' fractional');
  }
});

test('fast attack and release are not padded into long ramps',()=>{
  const e=editor();
  const fast=e.run('YS200.envelopePoints({...voice.operators[0],AR:30,RR:15,D1R:1,D1L:8,D2R:0}).points');
  assert.ok(fast[1][0]-fast[0][0]<10);
  const release=fast.at(-1)[0]-fast.at(-2)[0];
  assert.ok(release>0&&release<10);
  const slow=e.run('YS200.envelopePoints({...voice.operators[0],AR:30,RR:1,D1R:1,D1L:8,D2R:0}).points');
  assert.ok(slow.at(-1)[0]-slow.at(-2)[0]>release);
});

test('effects export uses EFEDS header, payload size and Yamaha checksum',()=>{
 const e=editor();
 const bytes=Array.from(e.run('Effects.bulk({preset:9,time:40,balance:99},16)'));
 assert.equal(bytes.length,21);
 assert.deepEqual(bytes.slice(0,6),[240,67,15,126,0,13]);
 assert.equal(String.fromCharCode(...bytes.slice(6,16)),'LM  8036EF');
 assert.deepEqual(bytes.slice(16,19),[9,40,99]);
 assert.equal(bytes.slice(6,20).reduce((a,b)=>a+b,0)%128,0);
 assert.equal(bytes[20],247);
 assert.deepEqual(Array.from(e.run('Effects.changes({preset:0,time:40,balance:99},1)')),[240,67,16,36,4,0,247,240,67,16,36,5,40,247,240,67,16,36,6,99,247]);
 for(const expr of ['Effects.bulk({preset:11,time:0,balance:0})','Effects.bulk({preset:0,time:41,balance:0})','Effects.bulk({preset:0,time:0,balance:100})','Effects.bulk({preset:0,time:0,balance:0},0)','Effects.bulk({preset:0,time:0,balance:0},17)'])assert.throws(()=>e.run(expr));
});
test('effects live drag, undo, compare and navigation retain independent buffers',()=>{
 const e=editor();e.get('#show-effects').onclick();
 const slider=e.get('#fx-time');slider.value='30';slider.oninput();slider.value='40';slider.oninput();
 assert.equal(e.get('#fx-time').value,'40');
 assert.match(e.get('#fx-summary').textContent,/TIME 40/);assert.equal(e.get('#fx-time'),slider);
 e.get('#compare').onclick();assert.equal(e.get('#fx-time').value,20);assert.equal(e.get('#fx-time').disabled,true);
 e.get('#compare').onclick();e.get('#show-voice').onclick();e.get('#show-effects').onclick();assert.equal(e.get('#fx-time').value,40);
 e.run('EffectsUI.undo()');assert.equal(e.get('#fx-time').value,20);assert.equal(e.run('history.length'),0);
 e.get('#fx-programs').children[8].onclick();assert.match(e.get('#fx-summary').textContent,/SIZE 20/);
});

test('snapshots identify the synth and version and do not alias the edit buffer',()=>{
 const e=editor();
 assert.equal(e.run('Synths.snapshot(synth,voice).synthId'),'ys200');
 assert.equal(e.run('Synths.snapshot(synth,voice).version'),1);
 e.run('const saved=Synths.snapshot(synth,voice);saved.voice.operators[0].AR=1');
 assert.equal(e.run('voice.operators[0].AR'),27);
 assert.equal(e.run('Synths.get("dx7").operatorCount'),6);
 assert.throws(()=>e.run('Synths.get("unknown")'),/Unknown/);
 assert.throws(()=>e.run('Synths.snapshot(synth,{operators:[]})'),/operator count/);
});
test('shared editor renders six operators, profile feedback and no effects without YS200 control assumptions',()=>{
 const e=editor(`
 const make=YS200Profile.createVoice;
 YS200Profile.operatorCount=6;
 YS200Profile.effects=null;
 YS200Profile.waveNames=['Sine'];
 YS200Profile.createVoice=()=>{const v=make();v.operators.push({...v.operators[0]},{...v.operators[0]});return v};
 YS200Profile.algorithms=YS200Profile.algorithms.map(a=>({...a,positions:[...a.positions,[20,30],[100,30]],feedback:[[5,4]]}));
 YS200Profile.operatorSummary=op=>'CUSTOM '+op.OUT;
 `);
 assert.equal(e.get('#operators').children.length,6);
 assert.equal(e.get('#operators').attributes['aria-label'],'6 operators');
 assert.equal(e.get('#operators').children[5].children[0].children.find(c=>c.className==='wave-options').children.length,1);
 assert.match(e.get('#algorithm-diagram').innerHTML,/on operator 6 to operator 5/);
 assert.match(e.get('#operators').children[5].children[2].textContent,/CUSTOM/);
 assert.equal(e.get('#show-effects').hidden,true);
 e.run("selected=5;change('OUT',45,true)");
 assert.equal(e.run('voice.operators[5].OUT'),45);
 e.run('undoVoice()');assert.equal(e.run('voice.operators[5].OUT'),92);
});
test('parameter scope belongs to the profile even when a caller supplies the wrong scope',()=>{
 const e=editor();
 e.run("change('REV',3,true);change('AR',12,false)");
 assert.equal(e.run('voice.global.REV'),3);
 assert.equal(e.run('voice.operators[0].AR'),12);
 assert.equal(e.run('voice.global.AR'),undefined);
});

test('FIX range and operator shift availability follow mode, selection, undo and compare',()=>{
  const e=editor();
  const control=key=>e.get('#operator-controls').children.find(c=>c.children[0].textContent===key);
  assert.equal(e.get('#op-FIXRG').disabled,true);
  assert.equal(control('FIXRG').attributes['data-disabled'],'true');
  assert.equal(control('SHIFT').attributes['data-disabled'],'true');
  e.run("change('FIX',1,true);change('FIXRG',4,true);change('FIX',0,true)");
  assert.equal(e.run('voice.operators[0].FIXRG'),4);
  assert.equal(e.get('#op-FIXRG').disabled,true);
  e.run('undoVoice()');
  assert.equal(e.get('#op-FIXRG').disabled,false);
  assert.equal(control('FIXRG').attributes['data-disabled'],'false');
  e.get('#compare').onclick();
  assert.equal(e.get('#op-FIXRG').disabled,true);
  assert.equal(control('AR').attributes['data-disabled'],'true');
  e.get('#compare').onclick();
  assert.equal(e.get('#op-FIXRG').disabled,false);
  e.run('selected=1;render()');
  assert.equal(control('SHIFT').attributes['data-disabled'],'false');
  assert.equal(e.get('#op-FIXRG').disabled,true);
});

test('decay availability updates during a drag without replacing controls or losing values',()=>{
  const e=editor(),d1l=e.get('#op-D1L'),d1r=e.get('#op-D1R'),d2r=e.get('#op-D2R');
  const set=(input,value)=>{input.value=String(value);input.oninput();input.onchange();};
  set(d1l,15);
  assert.equal(e.get('#op-D1L'),d1l);
  assert.equal(d1r.disabled,true);
  assert.equal(d2r.disabled,false);
  e.run("change('D1R',0,true)");
  assert.equal(e.run('voice.operators[0].D1R'),9,'unavailable edits are blocked');
  set(d1l,8);set(d1r,0);
  assert.equal(d1r.disabled,false);
  assert.equal(d2r.disabled,true);
  set(d1l,15);
  assert.equal(d2r.disabled,false,'D1L 15 bypasses a zero first-decay rate');
  set(d1l,0);set(d1r,10);
  assert.equal(d2r.disabled,true);
  set(d1l,8);
  assert.equal(d2r.disabled,false);
  assert.equal(e.run('voice.operators[0].D2R'),0);
  e.run('undoVoice()');
  assert.equal(e.get('#op-D2R').disabled,true);
});

test('diagram nodes select operators with pointer and keyboard, including Compare',()=>{
  const e=editor(),diagram=e.get('#algorithm-diagram');
  const activate=(index,key)=>{
    let prevented=false;
    const event={type:key?'keydown':'click',key,target:{closest:()=>({dataset:{operator:String(index)}})},preventDefault(){prevented=true;}};
    (key?diagram.onkeydown:diagram.onclick)(event);
    return prevented;
  };
  for(let i=0;i<4;i++){
    activate(i);
    assert.equal(e.run('selected'),i);
    assert.equal(e.get('#op-AR').value,e.run(`voice.operators[${i}].AR`));
    assert.match(diagram.innerHTML,new RegExp(`id="algorithm-op-${i}"[^>]*aria-pressed="true"`));
    assert.equal(e.get('#operators').children[i].className,'operator-card selected');
  }
  assert.equal(activate(1,'Enter'),true);
  assert.equal(e.run('selected'),1);
  assert.equal(activate(2,' '),true);
  assert.equal(e.run('selected'),2);
  assert.equal(activate(0,'ArrowDown'),false);
  assert.equal(e.run('selected'),2);
  diagram.onclick({type:'click',target:{closest:()=>null}});
  assert.equal(e.run('selected'),2);
  assert.equal(e.run('history.length'),0,'selection must not edit the voice');
  e.get('#compare').onclick();activate(1);
  assert.equal(e.run('selected'),1);
  assert.equal(e.get('#op-AR').disabled,true);
  assert.equal(e.run('comparing'),true);
});

test('persistent header tabs reflect the active view and restore view-specific actions',()=>{
  const e=editor();
  e.run("change('AR',15,true)");
  e.get('#show-effects').onclick();
  assert.equal(e.get('#show-effects').attributes['aria-pressed'],'true');
  assert.equal(e.get('#show-voice').attributes['aria-pressed'],'false');
  assert.equal(e.get('.editor-screen').hidden,true);
  assert.equal(e.get('#effects-screen').hidden,false);
  assert.equal(e.get('#seed').disabled,true);
  e.get('#compare').onclick();
  assert.equal(e.get('#compare').attributes['aria-pressed'],'true');
  e.get('#show-voice').onclick();
  assert.equal(e.get('#show-voice').attributes['aria-pressed'],'true');
  assert.equal(e.get('#show-effects').attributes['aria-pressed'],'false');
  assert.equal(e.get('#compare').attributes['aria-pressed'],'false');
  assert.equal(e.get('#seed').disabled,false);
  e.run('undoVoice()');
  assert.equal(e.run('voice.operators[0].AR'),27);
  e.get('#show-effects').onclick();
  assert.equal(e.get('#compare').attributes['aria-pressed'],'true');
});

test('envelope guide drags update the selected operator live with one undo transaction',()=>{
  const e=editor(),host=e.get('#operators');
  host.setPointerCapture=()=>{};host.hasPointerCapture=()=>true;host.releasePointerCapture=()=>{};
  const begin=(key,axis,index=0)=>host.onpointerdown({button:0,pointerId:1,clientX:100,clientY:100,preventDefault(){},target:{closest:s=>s==='.env-guide'?{dataset:{key,axis}}:{dataset:{operator:String(index)}}}});
  begin('AR','x');
  host.onpointermove({pointerId:1,clientX:124,clientY:100});
  assert.equal(e.run('voice.operators[0].AR'),21);
  assert.equal(e.get('#op-AR').value,21);
  host.onpointermove({pointerId:1,clientX:140,clientY:100});
  assert.equal(e.run('voice.operators[0].AR'),17);
  assert.equal(e.run('history.length'),1);
  host.onpointerup({pointerId:1});
  e.run('undoVoice()');assert.equal(e.run('voice.operators[0].AR'),27);
  begin('D1L','y',2);
  host.onpointermove({pointerId:1,clientX:100,clientY:132});
  assert.equal(e.run('selected'),2);
  assert.equal(e.run('voice.operators[2].D1L'),7);
  host.onpointermove({pointerId:1,clientX:100,clientY:1000});
  assert.equal(e.run('voice.operators[2].D1L'),1);
  host.onpointercancel({pointerId:1});assert.equal(e.run('envelopeDrag'),null);
  e.get('#compare').onclick();begin('AR','x');
  assert.equal(e.run('envelopeDrag'),null);
});

test('envelope guides identify reachable stages and omit unavailable parameters',()=>{
  const e=editor();
  assert.match(e.run('envelope(voice.operators[0],0)'),/data-key="D1R"/);
  assert.doesNotMatch(e.run('envelope({...voice.operators[0],D1L:15},0)'),/data-key="D1R"/);
  assert.doesNotMatch(e.run('envelope({...voice.operators[0],D1R:0,D1L:8},0)'),/data-key="D2R"/);
  assert.doesNotMatch(e.run('envelope({...voice.operators[0],D1R:0,D1L:8},0)'),/data-key="D1L"/);
});


test('envelope drags keep decay rates above zero while sliders still allow zero',()=>{
  const e=editor(),host=e.get('#operators');
  host.setPointerCapture=()=>{};host.hasPointerCapture=()=>true;host.releasePointerCapture=()=>{};
  for(const key of ['D1R','D2R']){
    e.run(`voice.operators[0].${key}=5;render()`);
    host.onpointerdown({button:0,pointerId:1,clientX:100,clientY:100,preventDefault(){},target:{closest:s=>s==='.env-guide'?{dataset:{key,axis:'x'}}:{dataset:{operator:'0'}}}});
    host.onpointermove({pointerId:1,clientX:1000,clientY:100});
    host.onpointerup({pointerId:1});
    assert.equal(e.run(`voice.operators[0].${key}`),1);
  }
  for(const key of ['D2R','D1R','D1L']){
    const slider=e.get('#op-'+key);slider.value='0';slider.oninput();slider.onchange();
    assert.equal(e.run(`voice.operators[0].${key}`),0);
  }
});


test('every envelope anchor lies exactly on its corresponding stage corner',()=>{
  const e=editor();
  for(const d1r of [0,9,31])for(const d1l of [0,8,15])for(const ar of [1,31]){
    const eg=e.run(`synth.envelopePoints({...voice.operators[0],AR:${ar},D1R:${d1r},D1L:${d1l}},0)`);
    for(const guide of eg.guides)assert.ok(eg.points.some(([x,y])=>x===guide.x&&y===guide.y),guide.key);
    const attack=eg.guides.find(g=>g.key==='AR');
    assert.equal(attack.x,eg.points[1][0]);assert.equal(attack.y,eg.points[1][1]);
    const release=eg.guides.find(g=>g.key==='RR');
    if(release){assert.equal(release.x,eg.points.at(-1)[0]);assert.equal(release.y,eg.points.at(-1)[1]);}
  }
});

test('engine switching preserves voice, selection, compare, undo and YS200 effects',()=>{
 const e=editor();e.run("change('AR',14)");e.get('#show-effects').onclick();e.get('#fx-programs').children[4].onclick();
 e.get('#engine-6op').onclick();assert.equal(e.run('synth.id'),'dx7');assert.equal(e.get('#operators').children.length,6);assert.equal(e.get('#show-effects').hidden,true);
 e.run("selected=5;change('R1',23);change('DET',-7)");e.get('#compare').onclick();
 e.get('#engine-4op').onclick();assert.equal(e.run('voice.operators[0].AR'),14);e.get('#show-effects').onclick();assert.match(e.get('#fx-summary').textContent,/^4 /);
 e.get('#engine-6op').onclick();assert.equal(e.run('comparing'),true);assert.equal(e.run('selected'),5);e.get('#compare').onclick();assert.equal(e.run('voice.operators[5].R1'),23);e.run('undoVoice()');assert.equal(e.run('voice.operators[5].DET'),0);
});
test('DX7 pitch uses global parameters and shares undo and compare',()=>{
 const e=editor();e.get('#engine-6op').onclick();e.get('#show-pitch').onclick();assert.equal(e.get('#operator-controls').children.length,8);
 const slider=e.get('#global-PL1');slider.value='80';slider.oninput();slider.onchange();assert.equal(e.run('voice.global.PL1'),80);assert.equal(e.run('voice.operators[0].PL1'),undefined);
 e.get('#compare').onclick();assert.equal(e.get('#global-PL1').value,50);e.get('#compare').onclick();e.run('undoVoice()');assert.equal(e.run('voice.global.PL1'),50);
 e.get('#show-voice').onclick();assert.equal(e.run('pitchEditing'),false);assert.equal(e.get('#operator-controls').children.length,18);
});
test('DX7 frequency, stage order, release level, bounds and native ranges',()=>{
 const e=editor();assert.equal(e.run('DX7.frequencyLabel({...DX7.createVoice().operators[0],CRS:0,FINE:50})'),'RATIO 0.75');assert.equal(e.run('DX7.frequencyLabel({...DX7.createVoice().operators[0],FIX:1,CRS:7,FINE:0})'),'1000.00 Hz');
 for(const rate of [0,50,99]){const p=e.run(`DX7.envelopePoints({R1:${rate},R2:${rate},R3:${rate},R4:${rate},L1:10,L2:90,L3:20,L4:70}).points`);assert.equal(p[0][1],p.at(-1)[1]);assert.ok(p[1][1]>p[0][1]);assert.ok(p[2][1]<p[1][1]);for(let i=0;i<p.length;i++){assert.ok(p[i].every(Number.isFinite));assert.ok(p[i][0]>=3&&p[i][0]<=247.00001);if(i)assert.ok(p[i][0]>=p[i-1][0]);}}
 assert.equal(e.run('DX7.valid("R1",0)'),true);assert.equal(e.run('DX7.valid("CRS",32)'),false);assert.equal(e.run('DX7.valid("AR",31)'),false);
});
test('DX7 all 32 algorithms match Yamaha routing and feedback bus definitions',()=>{
 const e=editor();
 // Independent bus representation, OP6 first. Factual topology cross-check
 // against the Yamaha chart and MSFA fm_core.cc (see DX7_REFERENCE.md).
 const rows=['c1 11 11 14 01 14','01 11 11 14 c1 14','c1 11 14 01 11 14','c1 11 94 01 11 14','c1 14 01 14 01 14','c1 94 01 14 01 14','c1 11 05 14 01 14','01 11 c5 14 01 14','01 11 05 14 c1 14','01 05 14 c1 11 14','c1 05 14 01 11 14','01 05 05 14 c1 14','c1 05 05 14 01 14','c1 05 11 14 01 14','01 05 11 14 c1 14','c1 11 02 25 05 14','01 11 02 25 c5 14','01 11 11 c5 05 14','c1 14 14 01 11 14','01 05 14 c1 14 14','01 14 14 c1 14 14','c1 14 14 14 01 14','c1 14 14 01 14 04','c1 14 14 14 04 04','c1 14 14 04 04 04','c1 05 14 01 14 04','01 05 14 c1 14 04','04 c1 11 14 01 14','c1 14 01 14 04 04','04 c1 11 14 04 04','c1 14 04 04 04 04','c4 04 04 04 04 04'];
 rows.forEach((row,n)=>{const buses=[[],[],[]],edges=[],carriers=[];let fbIn,fbOut;row.split(' ').map(x=>parseInt(x,16)).forEach((f,i)=>{const op=5-i,input=(f>>4)&3,output=f&3;if(input)for(const source of buses[input])edges.push([source,op]);if(!output)carriers.push(op);if(f&64)fbIn=op;if(f&128)fbOut=op;if(f&4)buses[output].push(op);else buses[output]=[op];});const a=JSON.parse(e.run(`JSON.stringify(DX7.algorithms[${n}])`));assert.deepEqual(a.edges.sort(),edges.sort(),'algorithm '+(n+1));assert.deepEqual(a.carriers.sort(),carriers.sort());assert.deepEqual(a.feedback,[[fbOut,fbIn]]);assert.equal(new Set(a.positions.map(p=>p.join(','))).size,6);});
});
test('DX7 wire format uses OP6 first, signed offsets and temporary mute mask',()=>{
 const e=editor();e.run('var v=DX7.createVoice();v.operators[5].R1=17;v.operators[5].DET=-7;v.global.ALG=32;v.global.TRPS=-24;var b=DX7Codec.encode(v)');assert.equal(e.run('b.length'),155);assert.equal(e.run('b[0]'),17);assert.equal(e.run('b[20]'),0);assert.equal(e.run('b[134]'),31);assert.equal(e.run('b[144]'),0);
 assert.equal(e.run('JSON.stringify(DX7Codec.decode(b))===JSON.stringify(v)'),true);
 assert.equal(e.run('Array.from(DX7Codec.parameter(v,"ALG",0,16)).join(",")'),'240,67,31,1,6,31,247');e.run('v.operators[0].on=0');assert.equal(e.run('Array.from(DX7Codec.parameter(v,"on")).join(",")'),'240,67,16,1,27,31,247');assert.equal(e.run('DX7Codec.decode(DX7Codec.encode(v)).operators[0].on'),1);
});
test('DX7 single and packed bank dumps round-trip and reject corrupt inputs',()=>{
 const e=editor();e.run(`var voices=Array.from({length:32},(_,n)=>{const v=DX7.createVoice();v.name='TEST '+n;for(const op of v.operators)for(const k of DX7.operatorKeys){const [lo,hi]=DX7.ranges[k];op[k]=lo+(n*7)%(hi-lo+1);}for(const k of DX7.globalKeys){const [lo,hi]=DX7.ranges[k];v.global[k]=lo+n%(hi-lo+1);}return v;});var bank=DX7Codec.bulk(voices,16);`);
 assert.equal(e.run('bank.length'),4104);assert.equal(e.run('DX7Codec.parse(bank).channel'),16);assert.equal(e.run('JSON.stringify(DX7Codec.parse(bank).voices)===JSON.stringify(voices)'),true);
 assert.equal(e.run('DX7Codec.bulk(voices[0]).length'),163);assert.equal(e.run('DX7Codec.parse(DX7Codec.bulk(voices[0])).voices[0].name'),'TEST 0');
 assert.throws(()=>e.run('var bad=bank.slice();bad[10]^=1;DX7Codec.parse(bad)'),/checksum/);assert.throws(()=>e.run('DX7Codec.parse(bank.slice(1))'),/dump/);assert.throws(()=>e.run('DX7Codec.bulk(voices.slice(1))'),/32/);assert.throws(()=>e.run('DX7Codec.bulk(voices[0],0)'),/channel/);assert.throws(()=>e.run('var bad=DX7Codec.encode(voices[0]);bad[0]=100;DX7Codec.decode(bad)'),/R1/);
});

test('DX7 file import validates before applying and undo restores the old compare baseline',async()=>{
 const e=editor();e.get('#dialog').close=()=>{};e.get('#engine-6op').onclick();e.run("change('R1',22);setupVoiceFiles();var imported=DX7.createVoice();imported.name='IMPORTED';imported.operators[0].R1=55;var fileBytes=DX7Codec.bulk(imported)");
 await e.get('#load-syx').onchange({target:{files:[{arrayBuffer:async()=>e.run('fileBytes.buffer')}]}});assert.equal(e.run('voice.name'),'IMPORTED');assert.equal(e.run('initial.name'),'IMPORTED');e.run('undoVoice()');assert.equal(e.run('voice.operators[0].R1'),22);assert.equal(e.run('initial.operators[0].R1'),99);
 e.run('fileBytes[12]^=1');await e.get('#load-syx').onchange({target:{files:[{arrayBuffer:async()=>e.run('fileBytes.buffer')}]}});assert.match(e.get('#file-result').textContent,/checksum/);assert.equal(e.run('voice.operators[0].R1'),22);
 e.run('fileBytes=DX7Codec.bulk(Array.from({length:32},()=>imported))');await e.get('#load-syx').onchange({target:{files:[{arrayBuffer:async()=>e.run('fileBytes.buffer')}]}});assert.equal(e.get('#bank-voices').children.length,32);assert.equal(e.run('voice.operators[0].R1'),22);e.get('#bank-voices').children[31].onclick();assert.equal(e.run('voice.name'),'IMPORTED');
});


test('live MIDI emits parameter edits, compare and undo and cancels across engines',async()=>{
 const e=editor('',true);e.run("var sent=[];MidiUI.transport.output={state:'connected',send:b=>sent.push(Array.from(b)),clear(){}};MidiUI.transport.delay=async()=>{};change('AR',15)");
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(Array.from(e.run('sent[0]')),[240,67,16,18,39,15,247]);
 e.get('#compare').onclick();await new Promise(r=>setImmediate(r));assert.equal(e.run('sent.at(-1)[5]'),27);
 e.get('#compare').onclick();e.run('undoVoice()');await new Promise(r=>setImmediate(r));assert.equal(e.run('sent.at(-1)[5]'),27);
 e.get('#engine-6op').onclick();
 e.run('sent=[]');e.run("change('R1',50)");await new Promise(r=>setImmediate(r));assert.ok(e.run('sent.length')>0);
});
test('armed YS200 receive commits all extensions atomically and undo restores effects',()=>{
 const e=editor('',true);e.run("MidiUI.transport.input={state:'connected'};MidiUI.transport.output={state:'connected',send(){},clear(){}};var imported=YS200Profile.createVoice();imported.name='RECEIVED';imported.effects={preset:9,time:40,balance:99};var frames=MidiProtocol.split(YS200Codec.bulk(imported));MidiUI.arm();");
 for(let n=0;n<3;n++){e.run(`MidiUI.receive(frames[${n}])`);assert.equal(e.run('voice.name'),'DemoVoice');}
 e.run('MidiUI.receive(frames[3])');assert.equal(e.run('voice.name'),'RECEIVED');assert.equal(e.run('EffectsUI.getState().balance'),99);
 e.run('undoVoice()');assert.equal(e.run('voice.name'),'DemoVoice');assert.equal(e.run('EffectsUI.getState().balance'),50);
});
test('incoming MIDI is filtered by engine and channel and never echoed',()=>{
 const e=editor('',true);e.run("var sent=[];MidiUI.transport.output={state:'connected',send:b=>sent.push(Array.from(b)),clear(){}};MidiUI.receive(MidiProtocol.parameter(18,39,12,2));");assert.equal(e.run('voice.operators[0].AR'),27);
 e.run('MidiUI.receive(MidiProtocol.parameter(0,0,12,1))');assert.equal(e.run('voice.operators[0].AR'),27);
 e.run('MidiUI.receive(MidiProtocol.parameter(18,39,12,1))');assert.equal(e.run('voice.operators[0].AR'),12);assert.equal(e.run('sent.length'),0);
});
test('live effects emit EFEDS addresses and incoming voice parameters preserve current effects',async()=>{
 const e=editor('',true);e.run("var sent=[];MidiUI.transport.output={state:'connected',send:b=>sent.push(Array.from(b)),clear(){}};MidiUI.transport.delay=async()=>{};");e.get('#show-effects').onclick();const input=e.get('#fx-time');input.value='35';input.oninput();await new Promise(r=>setImmediate(r));assert.deepEqual(Array.from(e.run('sent.at(-1)')),[240,67,16,36,5,35,247]);
 e.run('MidiUI.receive(MidiProtocol.parameter(18,39,12))');assert.equal(e.run('EffectsUI.getState().time'),35);
});
test('receive timeout and corrupt dumps leave the existing voice unchanged',()=>{
 const e=editor('',true);e.run("MidiUI.transport.input={state:'connected'};MidiUI.transport.output={state:'connected',send(){},clear(){}};MidiUI.arm();var bytes=YS200Codec.bulk(YS200Profile.createVoice());bytes[17]^=1;MidiUI.receive(MidiProtocol.split(bytes)[0]);");assert.equal(e.run('voice.name'),'DemoVoice');assert.match(e.get('#status').textContent,/checksum/);
 e.run("MidiUI.arm()");const timeout=[...e.timers.values()].find(t=>t.ms===30000);timeout.fn();assert.match(e.get('#status').textContent,/No complete dump/);assert.equal(e.run('history.length'),0);
});

test('native file workflow imports standalone effects and matching JSON, rejects another engine',async()=>{
 const e=editor('',true);e.run("MidiUI.files();var bytes=Effects.bulk({preset:10,time:40,balance:99})");
 await e.get('#load-syx').onchange({target:{files:[{name:'effects.syx',arrayBuffer:async()=>e.run('bytes.buffer')}]}});assert.equal(e.run('EffectsUI.getState().preset'),10);
 e.run("var exportedSnapshot=Synths.snapshot(synth,voice);exportedSnapshot.voice.name='SNAPSHOT';exportedSnapshot.voice.operators[0].on=0;");
 const json=Buffer.from(e.run('JSON.stringify(exportedSnapshot)'));await e.get('#load-syx').onchange({target:{files:[{name:'voice.json',arrayBuffer:async()=>json}]}});assert.equal(e.run('voice.name'),'SNAPSHOT');assert.equal(e.run('voice.operators[0].on'),0);
 const wrong=Buffer.from(e.run("exportedSnapshot.synthId='dx7';JSON.stringify(exportedSnapshot)"));await e.get('#load-syx').onchange({target:{files:[{name:'wrong.json',arrayBuffer:async()=>wrong}]}});assert.match(e.get('#file-result').textContent,/selected synth/);assert.equal(e.run('voice.name'),'SNAPSHOT');
});

test('YS200 Config assignments use native destination amounts and support undo',async()=>{
 const e=editor('',true);e.run("openDialog('control')");
 assert.equal(e.get('#dialog-title').textContent,'YS200 CONFIG');
 const mod=e.get('#config-vced-71-enabled');mod.checked=true;await mod.onchange();
 assert.equal(e.run('YS200Codec.encode(voice).vced[71]'),1);
 mod.checked=false;await mod.onchange();assert.equal(e.run('YS200Codec.encode(voice).vced[71]'),0);
 e.run('undoVoice()');assert.equal(e.run('YS200Codec.encode(voice).vced[71]'),1);
 const aftertouch=e.get('#config-aced2-1-enabled');aftertouch.checked=true;await aftertouch.onchange();
 assert.equal(e.run('YS200Codec.encode(voice).aced2[1]'),1);
 assert.equal(e.run('YS200Codec.encode(voice).aced2[0]'),0);
 e.run('undoVoice()');assert.equal(e.run('YS200Codec.encode(voice).aced2[1]'),0);
});

function sessionEditor(storage) {
  const e = editor('', true, storage);
  e.run("const Modulations={getState:()=>({macros:[],xy:{x:50,y:50,latch:false},lfos:[]})}; $('#modulations-screen').hidden=true;");
  e.run(fs.readFileSync('app/session.js','utf8'));
  return e;
}
test('session reload restores both engines, histories, effects, MIDI settings and pitch view',()=>{
  const data = new Map(), storage = {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
  const a = sessionEditor(storage);
  a.run("change('AR',8,true); EffectsUI.setState({preset:7,time:33,balance:66}); MidiUI.config().tx=5; MidiUI.config().input='saved-port'; switchEngine('dx7'); change('R1',42,true); selected=3; setPitch(true); MidiUI.config().rx=9;  Session.save()");
  const b = sessionEditor(storage);
  assert.equal(b.run('synth.id'),'dx7');
  assert.equal(b.run('voice.operators[0].R1'),42);
  assert.equal(b.run('selected'),3);
  assert.equal(b.run('pitchEditing'),true);
  assert.equal(b.run('MidiUI.config().rx'),9);
  assert.equal(b.run('MidiUI.config().rx'),9);
  assert.equal(b.run('EffectsUI.getState().balance'),66);
  b.run("undoVoice()");assert.notEqual(b.run('voice.operators[0].R1'),42);
  b.run("redoVoice()");assert.equal(b.run('voice.operators[0].R1'),42);
  b.run("switchEngine('ys200')");
  assert.equal(b.run('voice.operators[0].AR'),8);
  assert.equal(b.run('MidiUI.config().tx'),5);
  assert.equal(b.run('MidiUI.config().input'),'saved-port');
  b.run('undoVoice()');assert.equal(b.run('voice.operators[0].AR'),27);
});
test('invalid session data and unavailable storage do not prevent editing',()=>{
  for(const value of ['{broken', JSON.stringify({version:1,engine:'dx7',buffers:{dx7:{voice:null}},effects:{},midi:{settings:{dx7:{tx:999}}}})]) {
    const e=sessionEditor({getItem:key=>key==='yseditor-session-v1'?value:null,setItem(){throw Error('quota');}});
    e.run('Session.save()');
    assert.match(e.get('#status').textContent,/COULD NOT BE SAVED/);
    assert.equal(e.run('voice.operators.length'),e.run('synth.operatorCount'));
  }
});

test('MIDI mappings route modulation controls with fractional speed ranges',()=>{
  const e=editor("let received;const Modulations={apply:voice=>voice,setValue:(key,value)=>received={key,value},refreshMappings(){},getState:()=>({macros:[]})};");
  e.run("mappedChange({engine:synth.id,key:'mod:lfo:0:speed',range:[.01,20]},127)");
  assert.equal(e.run('received.value'),20);
  e.run("openMapping({key:'mod:lfo:0:speed',isOp:false,index:0})");
  e.get('#mapping-channel').value='1';e.get('#mapping-cc').value='74';
  e.get('#mapping-source-min').value='0.5';e.get('#mapping-source-max').value='1';
  e.get('#mapping-min').value='.05';e.get('#mapping-max').value='3.75';
  e.get('#mapping-save').onclick();
  assert.equal(e.run('mappings[0].range[0]'),.05);
  assert.equal(e.run('mappings[0].range[1]'),3.75);
  assert.equal(e.run('mappings[0].sourceRange[0]'),.5);
  e.run('mappedChange(mappings[0],0)');assert.equal(e.run('received.value'),.05);
  e.run('mappedChange(mappings[0],127)');assert.equal(e.run('received.value'),3.75);
});

test('mapping toggles preserve Randomise availability for the active view',()=>{
  const e=editor();
  e.get('#effects-screen').hidden=true;
  e.get('#modulations-screen').hidden=false;
  e.run('setMappingMode(true)');
  assert.equal(e.get('#seed').disabled,true);
  e.run('setMappingMode(false)');
  assert.equal(e.get('#seed').disabled,true);
  e.get('#modulations-screen').hidden=true;
  e.run('render()');
  assert.equal(e.get('#seed').disabled,false);
});
test('live algorithm refresh updates routing and roles without replacing controls or base voice',()=>{
  for(const engine of ['ys200','dx7']){
    const e=editor();if(engine==='dx7')e.run("switchEngine('dx7')");
    const slider=e.get('#global-ALG'),card=e.get('#operators').children[0];
    const base=e.run('voice.global.ALG');
    e.run('const effective=structuredClone(voice);effective.global.ALG=synth.algorithms.length;renderAlgorithm(effective)');
    assert.match(e.get('#algorithm-diagram').innerHTML,new RegExp(`ALG ${engine==='dx7'?32:8}`));
    assert.equal(card.children[0].children.find(c=>c.className==='operator-role').textContent,'C');
    assert.equal(e.get('#global-ALG'),slider);
    assert.equal(e.run('voice.global.ALG'),base);
    e.get('#algorithm-diagram').innerHTML='unchanged';
    e.run('renderAlgorithm(effective)');
    assert.equal(e.get('#algorithm-diagram').innerHTML,'unchanged');
    e.run('renderAlgorithm()');
    assert.match(e.get('#algorithm-diagram').innerHTML,new RegExp(`ALG ${base}`));
  }
});

test('voice files round trip both engines, restore effects, and support undo',async()=>{
  const e=editor('',true);
  e.run("downloadVoice=(bytes,extension)=>{globalThis.downloaded={bytes,extension};};voice.name='Saved';voice.operators[0].on=0;EffectsUI.setState({preset:2,time:12,balance:34});");
  e.get('#save-voice').onclick();
  const saved=e.run('downloaded.bytes');
  assert.equal(e.run('downloaded.extension'),'.json');
  e.run("voice.name='Previous';EffectsUI.setState({preset:0,time:0,balance:0});");
  await e.get('#voice-file').onchange({target:{files:[{text:async()=>saved}]}});
  assert.equal(e.run('voice.name'),'Saved');
  assert.equal(e.run('voice.operators[0].on'),0);
  assert.equal(e.run('EffectsUI.getState().balance'),34);
  e.run('undoVoice()');
  assert.equal(e.run('voice.name'),'Previous');
  assert.equal(e.run('EffectsUI.getState().balance'),0);
  e.run("switchEngine('dx7');voice.name='Six';");
  e.get('#save-voice').onclick();
  const six=e.run('downloaded.bytes');
  e.run("switchEngine('ys200')");
  await e.get('#voice-file').onchange({target:{files:[{text:async()=>six}]}});
  assert.equal(e.run('synth.id'),'dx7');
  assert.equal(e.run('voice.name'),'Six');
});
test('invalid voice uploads leave the buffer and history intact',async()=>{
  const e=editor('',true),before=e.run('JSON.stringify(snapshot())');
  for(const text of ['{',JSON.stringify({format:'fm-editor-voice',version:2}),e.run("JSON.stringify({...Synths.snapshot(synth,voice),voice:{...voice,operators:[]}})")]){
    const target={files:[{text:async()=>text}],value:'voice.json'};
    await e.get('#voice-file').onchange({target});
    assert.equal(target.value,'');
    assert.match(e.get('#status').textContent,/LOAD FAILED/);
    assert.equal(e.run('JSON.stringify(snapshot())'),before);
    assert.equal(e.run('history.length'),0);
  }
});

test('Randomise covers both voices and effects within legal ranges, with atomic undo and redo',()=>{
  for(const engine of ['ys200','dx7'])for(const random of [0,.5,.999999]){
    const e=editor('',true);
    if(engine==='dx7')e.run("switchEngine('dx7')");
    e.run(`Math.random=()=>${random}`);
    const before=e.run('JSON.stringify(voice)'),fxBefore=e.run('JSON.stringify(EffectsUI.snapshot())');
    e.get('#seed').onclick();
    const after=e.run('JSON.stringify(voice)'),fxAfter=e.run('JSON.stringify(EffectsUI.snapshot())');
    assert.notEqual(after,before);
    assert.equal(e.run('voice.name'),JSON.parse(before).name);
    e.run(`if(synth.id==='ys200'){YS200Codec.encode(voice);Effects.validate(EffectsUI.getState());}
    else DX7.validate(voice);`);
    if(engine==='ys200')assert.notEqual(fxAfter,fxBefore);
    else assert.equal(fxAfter,fxBefore);
    assert.equal(e.get('#status').textContent,'VOICE RANDOMISED · ⌘Z TO RESTORE');
    e.run('undoVoice()');
    assert.equal(e.run('JSON.stringify(voice)'),before);
    assert.equal(e.run('JSON.stringify(EffectsUI.snapshot())'),fxBefore);
    e.run('redoVoice()');
    assert.equal(e.run('JSON.stringify(voice)'),after);
    assert.equal(e.run('JSON.stringify(EffectsUI.snapshot())'),fxAfter);
  }
});

test('controlled Randomise protects carriers and clears stale controller attenuation across every algorithm',()=>{
  const e=editor('',true);
  e.run(`let randomSeed=9231;const rng=()=>{randomSeed=(Math.imul(randomSeed,1664525)+1013904223)>>>0;return randomSeed/4294967296;};`);
  for(const engine of ['ys200','dx7']){
    const count=engine==='ys200'?8:32;
    for(let alg=1;alg<=count;alg++){
      e.run(`{
        const profile=Synths.get('${engine}');
        for(let trial=0;trial<25;trial++){
          const v=profile.createVoice();v.global.ALG=${alg}%profile.algorithms.length+1;
          for(const op of v.operators){op.on=0;op.OUT=0;op.FIX=1;}
          if(profile.id==='ys200'){
            const b=YS200Codec.encode(v);b.vced[67]=99;b.vced[76]=99;b.aced2[3]=99;
            v.sysex={vced:b.vced,aced:b.aced,aced2:b.aced2};
          }
          let firstDraw=true;
          const effects=Synths.randomise(profile,v,()=>{
            if(firstDraw){firstDraw=false;return (${alg}-.5)/profile.algorithms.length;}
            return rng();
          });
          if(v.global.ALG!==${alg}||v.name!==profile.createVoice().name)throw Error('Algorithm was not chosen first or voice name changed');
          const carriers=profile.carriers[v.global.ALG-1];
          for(const i of carriers){
            const op=v.operators[i];
            if(!op.on||op.FIX||op.OUT<82||op.KVS>2||op.RATE>1)throw Error('Inaudible carrier');
            if(profile.id==='ys200'){
              if(op.EBS||op.AME||op.SHIFT||op.LEVEL>8||op.AR<19||op.D1L<7)throw Error('YS200 carrier attenuation');
            }else if(op.L4!==0||op.L1!==99||op.L3<40||op.R1<55||op.LD>5||op.RD>10)throw Error('DX7 carrier attenuation');
          }
          const root=v.operators[carriers[0]];
          if(root.CRS!==(profile.id==='ys200'?4:1)||root.FINE!==0)throw Error('No fundamental');
          if(profile.id==='ys200'){
            const b=YS200Codec.encode(v);Effects.validate(effects);
            if(b.vced[67]||b.vced[76]||b.aced2[3]||b.vced[75]!==50||b.aced2[2]!==50)throw Error('Controller attenuation remains');
            if(effects.balance>30)throw Error('Effects dominate dry signal');
          }else DX7.validate(v);
          for(const [key,range] of Object.entries(profile.ranges)){
            const values=profile.scope(key)==='operator'?v.operators.map(op=>op[key]):[v.global[key]];
            if(values.some(value=>!Number.isInteger(value)||value<range[0]||value>range[1]))throw Error('Invalid '+key);
          }
        }
      }`);
    }
  }
});

test('Randomise mixes operator envelope contours even at random-source extremes',()=>{
  const e=editor('',true);
  for(const engine of ['ys200','dx7'])for(const draw of [0,.5,.999999]){
    e.run(`{
      const p=Synths.get('${engine}'),v=p.createVoice();
      Synths.randomise(p,v,()=>${draw});
      const root=p.carriers[v.global.ALG-1][0],other=(root+1)%v.operators.length;
      const shape=op=>p.id==='ys200'?(op.D2R>0?'pluck':op.AR<25?'soft':'sustain'):
        op.L3<=60?'pluck':op.R1<85?'soft':'sustain';
      if(shape(v.operators[root])===shape(v.operators[other]))throw Error('No contrasting envelope layer');
      if(p.id==='ys200')YS200Codec.encode(v);else DX7.validate(v);
    }`);
  }
});

test('MIDI source windows clamp and rescale synth destinations',()=>{
  const e=editor();
  e.run("const mapping={engine:synth.id,key:'AR',isOp:true,index:0,range:[1,31],sourceRange:[.5,.75]}");
  for(const [input,expected] of [[0,1],[63,1],[79.375,16],[95.25,31],[127,31]]){
    e.run(`mappedChange(mapping,${input})`);
    assert.equal(e.run('voice.operators[0].AR'),expected);
  }
});


test('mapping dialog saves inverted ranges and validates both endpoints',()=>{
  const e=editor();
  e.run("openMapping({key:'AR',isOp:true,index:0})");
  e.get('#mapping-channel').value='1';e.get('#mapping-cc').value='74';
  e.get('#mapping-source-min').value='0.25';e.get('#mapping-source-max').value='0.75';
  for(const [min,max] of [[32,1],[31,-1],[-1,31],[1,32]]){
    e.get('#mapping-min').value=String(min);e.get('#mapping-max').value=String(max);
    e.get('#mapping-save').onclick();
    assert.equal(e.run('mappings.length'),0);
  }
  e.get('#mapping-min').value='31';e.get('#mapping-max').value='1';
  e.get('#mapping-save').onclick();
  assert.deepEqual(Array.from(e.run('mappings[0].range')),[31,1]);
  for(const [input,expected] of [[0,31],[31.75,31],[63.5,16],[95.25,1],[127,1]]){
    e.run(`mappedChange(mappings[0],${input})`);
    assert.equal(e.run('voice.operators[0].AR'),expected);
  }
});

test('MIDI source messages and 14-bit pitch mapping are identical for both engines',()=>{
  for(const engine of ['ys200','dx7']){
    const e=editor();
    e.run(`synth=Synths.get('${engine}');voice=synth.createVoice();const received=[];mappedChange=(m,v,max)=>received.push([m.key,v,max]);`);
    for(const [source,cc] of [['cc',74],['mod',1],['breath',2],['foot',4],['pitch',null]]){
      e.run(`mappings=[{engine:synth.id,key:'${source}',source:'midi',midiSource:'${source}',channel:3,device:'pedal',cc:${cc}}];received.length=0`);
      const bytes=source==='pitch'?[226,1,64]:[178,cc,100];
      e.run(`handleMappingMessage(${JSON.stringify(bytes)},{id:'other'})`);
      assert.equal(e.run('received.length'),0);
      e.run(`handleMappingMessage(${JSON.stringify(bytes)},{id:'pedal'})`);
      assert.deepEqual(JSON.parse(e.run('JSON.stringify(received[0])')),[source,source==='pitch'?8193:100,source==='pitch'?16383:127]);
    }
    e.run("mappings=[{key:'legacy',channel:1,cc:74}];received.length=0;handleMappingMessage([176,74,127]);handleMappingMessage([224,74,127])");
    assert.equal(e.run('received.length'),1);
  }
  const e=editor("const received=[];const Modulations={apply:v=>v,setValue:(k,v)=>received.push(v)}");
  for(const value of [0,8192,8193,16383])e.run(`mappedChange({engine:synth.id,key:'mod:lfo:0:speed',range:[0,1]},${value},16383)`);
  assert.deepEqual(Array.from(e.run('received')),[0,8192/16383,8193/16383,1]);
});

test('MIDI source dropdown hides CC, saves named sources and learns pitch and controllers',()=>{
  const e=editor();
  e.run("openMapping({key:'AR',isOp:true,index:0})");
  for(const [source,cc] of [['mod',1],['breath',2],['foot',4],['pitch',null],['cc',74]]){
    e.get('#mapping-midi-source').value=source;e.get('#mapping-midi-source').onchange();
    assert.equal(e.get('#mapping-cc-field').hidden,source!=='cc');
    e.get('#mapping-channel').value='1';e.get('#mapping-cc').value='74';
    e.get('#mapping-min').value='1';e.get('#mapping-max').value='31';
    e.get('#mapping-source-min').value='0';e.get('#mapping-source-max').value='1';
    e.get('#mapping-save').onclick();
    assert.equal(e.run('mappings[0].midiSource'),source);
    assert.equal(e.run('mappings[0].cc'),cc===null?undefined:cc);
    e.run("openMapping({key:'AR',isOp:true,index:0})");
    assert.equal(e.get('#mapping-midi-source').value,source);
    e.run(`learnMapping={};handleMappingMessage(${JSON.stringify(source==='pitch'?[224,0,64]:[176,cc,90])})`);
    assert.equal(e.get('#mapping-midi-source').value,source);
    assert.equal(e.run('learnMapping'),null);
  }
});
