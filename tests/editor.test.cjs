const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
// Minimal DOM fixture: run the actual UI handlers without a browser dependency.
function editor(setup=""){
  const nodes=new Map();
  class Element{
    constructor(){this.children=[];this.attributes={};this.style={setProperty(){}};this.classList={add(){}};}
    set id(v){this._id=v;nodes.set('#'+v,this)}get id(){return this._id}
    append(...children){this.children.push(...children)}
    replaceChildren(...children){this.children=children}
    setAttribute(k,v){this.attributes[k]=v}focus(){}
  }
  const document={querySelector(s){if(!nodes.has(s))nodes.set(s,new Element());return nodes.get(s)},querySelectorAll(){return []},createElement(){return new Element()},addEventListener(){},activeElement:null};
  const context=vm.createContext({document,structuredClone,console});
  vm.runInContext(fs.readFileSync('app/ys200.js','utf8'),context);
  vm.runInContext(fs.readFileSync('app/effects.js','utf8'),context);
  vm.runInContext(fs.readFileSync('app/ys200-profile.js','utf8'),context);
  vm.runInContext(fs.readFileSync('app/synths.js','utf8'),context);
  vm.runInContext(setup,context);
  vm.runInContext(fs.readFileSync('app/editor.js','utf8'),context);
  vm.runInContext(fs.readFileSync('app/effects-ui.js','utf8'),context);
  return {get:s=>document.querySelector(s),run:s=>vm.runInContext(s,context)};
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
  slider.onchange();e.get('#undo').onclick();
  assert.equal(e.run('voice.operators[0].AR'),27);
});
test('waveform preview follows selection, and compare/undo restore it',()=>{
  const e=editor();e.run("change('wave',7,true)");
  assert.match(e.get('#operators').children[0].children[0].innerHTML,/Wave 7: Double positive sine squared/);
  e.get('#compare').onclick();assert.match(e.get('#operators').children[0].children[0].innerHTML,/Wave 0: Sine/);
  e.get('#compare').onclick();e.get('#undo').onclick();assert.equal(e.run('voice.operators[0].wave'),0);
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
 e.get('#undo').onclick();assert.equal(e.get('#fx-time').value,20);assert.equal(e.run('history.length'),0);
 e.get('#fx-programs').children[8].onclick();assert.match(e.get('#fx-summary').textContent,/SIZE 20/);
});

test('snapshots identify the synth and version and do not alias the edit buffer',()=>{
 const e=editor();
 assert.equal(e.run('Synths.snapshot(synth,voice).synthId'),'ys200');
 assert.equal(e.run('Synths.snapshot(synth,voice).version'),1);
 e.run('const saved=Synths.snapshot(synth,voice);saved.voice.operators[0].AR=1');
 assert.equal(e.run('voice.operators[0].AR'),27);
 assert.throws(()=>e.run('Synths.get("dx7")'),/not implemented/);
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
 assert.equal(e.get('#operators').children[5].children[0].children[0].children.length,1);
 assert.match(e.get('#algorithm-diagram').innerHTML,/on operator 6 to operator 5/);
 assert.match(e.get('#operators').children[5].children[2].textContent,/CUSTOM/);
 assert.equal(e.get('#show-effects').hidden,true);
 e.run("selected=5;change('OUT',45,true)");
 assert.equal(e.run('voice.operators[5].OUT'),45);
 e.get('#undo').onclick();assert.equal(e.run('voice.operators[5].OUT'),92);
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
  e.get('#undo').onclick();
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
  e.get('#undo').onclick();
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
  assert.equal(e.get('#undo').disabled,true);
  e.get('#compare').onclick();
  assert.equal(e.get('#compare').attributes['aria-pressed'],'true');
  e.get('#show-voice').onclick();
  assert.equal(e.get('#show-voice').attributes['aria-pressed'],'true');
  assert.equal(e.get('#show-effects').attributes['aria-pressed'],'false');
  assert.equal(e.get('#compare').attributes['aria-pressed'],'false');
  assert.equal(e.get('#seed').disabled,false);
  e.get('#undo').onclick();
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
  e.get('#undo').onclick();assert.equal(e.run('voice.operators[0].AR'),27);
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
  assert.match(e.run('envelope({...voice.operators[0],D1R:0,D1L:8},0)'),/data-key="D1L"/);
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
