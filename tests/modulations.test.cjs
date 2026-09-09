const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(storage={getItem:()=>null,setItem(){}}){
  class Element{
    constructor(tag='DIV'){this.tagName=tag.toUpperCase();this.children=[];this.style={setProperty(){}};this.attributes={};this.classList={add(){}};}
    append(...els){for(const el of els){el.parent=this;this.children.push(el);}}
    get lastChild(){return this.children.at(-1);}
    remove(){this.parent.children.splice(this.parent.children.indexOf(this),1);}
    get firstChild(){return this.children[0];}
    replaceWith(el){const i=this.parent.children.indexOf(this);this.parent.children[i]=el;el.parent=this.parent;}
    setAttribute(k,v){this.attributes[k]=v;}
    querySelectorAll(){return this.children.flatMap(c=>[...(c.tagName==='INPUT'?[c]:[]),...c.querySelectorAll()]);}
    querySelector(){return this.querySelectorAll().find(c=>c.type==='range');}
  }
  const nodes=new Map(),ticks=[];
  const context=vm.createContext({structuredClone,console,Math,performance:{now:()=>0},localStorage:storage,document:{createElement:t=>new Element(t),activeElement:null},$:s=>{if(!nodes.has(s))nodes.set(s,new Element());return nodes.get(s);},setInterval:fn=>ticks.push(fn),requestAnimationFrame(){},cancelAnimationFrame(){},addMappingAction(control,key){const button=new Element('button');button.key=key;control.append(button);},mappings:[],comparing:false,mappingMode:false,envelopeDrag:null,render(){},status(){},EffectsUI:{showVoice(){}}});
  for(const name of ['ys200','effects','waveforms','ys200-profile','dx7','dx7-profile','synths'])vm.runInContext(fs.readFileSync(`app/${name}.js`,'utf8'),context);
  vm.runInContext("let synth=Synths.get('ys200'),voice=synth.createVoice(),initial=structuredClone(voice);",context);
  vm.runInContext(fs.readFileSync('app/storage.js','utf8'),context);
  vm.runInContext(fs.readFileSync('app/modulations.js','utf8'),context);
  return {run:s=>vm.runInContext(s,context),nodes,tick:now=>{context.performance.now=()=>now;ticks.forEach(fn=>fn());}};
}
test('macro mapping scales without mutating voice or losing its source when renamed',()=>{
  const e=setup();
  e.run("mappings=[{engine:'ys200',source:'macro',sourceId:0,key:'FBL',index:0,isOp:false,range:[1,7]}]");
  const macro=e.nodes.get('#mod-macros').children[0],input=macro.querySelector();
  input.value=50;input.oninput();
  const before=e.run('voice.global.FBL');
  assert.equal(e.run('Modulations.apply(voice).global.FBL'),4);
  assert.equal(e.run('voice.global.FBL'),before);
  macro.firstChild.value='BRIGHT';macro.firstChild.oninput({type:'input'});
  assert.equal(e.run('Modulations.getState().macros[0].name'),'BRIGHT');
  assert.equal(e.run('Modulations.apply(voice).global.FBL'),4);
  e.run("synth=Synths.get('dx7');voice=synth.createVoice()");
  assert.equal(e.run('Modulations.apply(voice)===voice'),true);
});
test('X-Y and LFO mappings share destination ranges; MIDI assignments are not virtual',()=>{
  const e=setup();
  e.run("mappings=[{engine:'ys200',source:'xy',sourceId:'x',key:'FBL',index:0,isOp:false,range:[0,6]}]");
  assert.equal(e.run('Modulations.apply(voice).global.FBL'),3);
  e.run("mappings[0].source='lfo';mappings[0].sourceId=0");
  assert.equal(e.run('Modulations.apply(voice).global.FBL'),3);
  e.run("mappings[0].source='midi'");
  assert.equal(e.run('Modulations.apply(voice)===voice'),true);
});
test('bipolar indicators reflect depth while LFOs keep running hidden and unmapped',()=>{
  const e=setup();
  e.run("$('#voice-screen').hidden=true");
  e.nodes.get('#modulations-screen').hidden=true;
  const panels=e.nodes.get('#mod-top').children.slice(1);
  const positions=panels.map(panel=>panel.firstChild.firstChild.firstChild);
  const speed=panels[1].querySelectorAll().find(input=>input.attributes['aria-label']==='LFO 2 speed');
  speed.value=Math.round(Math.log(2/.01)/Math.log(20/.01)*1000);speed.oninput();
  e.tick(250);
  assert.equal(positions[0].style.width,'0%');
  assert.equal(positions[1].style.width,'0%');
  assert.equal(positions[0].style.left,'50%');
  panels.forEach((panel,i)=>{
    const depth=panel.querySelectorAll().find(input=>input.attributes['aria-label']===`LFO ${i+1} depth`);
    depth.value=i?50:100;depth.oninput();
  });
  e.run('comparing=true');
  e.tick(1250);
  assert.equal(positions[0].style.width,'50%');
  assert.equal(positions[0].style.left,'50%');
  e.tick(1375);
  assert.equal(positions[1].style.width,'25%');
  assert.equal(positions[1].style.left,'25%');
  e.tick(1750);
  assert.equal(positions[0].style.width,'50%');
  assert.equal(positions[0].style.left,'0%');
});
test('LFO speed uses a logarithmic range with readable frequency values',()=>{
  const e=setup();
  const speed=e.nodes.get('#mod-top').children[1].querySelectorAll().find(input=>input.attributes['aria-label']==='LFO 1 speed');
  for(const [position,hz] of [[0,.01],[500,.45],[1000,20]]){
    speed.value=position;speed.oninput();
    assert.equal(e.run('Modulations.getState().lfos[0].speed'),hz);
    assert.equal(speed.attributes['aria-valuetext'],`${hz.toFixed(2)} Hz`);
  }
});
test('modulation ticks refresh envelopes with effective values even while an input has focus',()=>{
  const e=setup();
  e.run("let refreshed;function refreshEnvelopeGraphs(value){refreshed=value;}document.activeElement={tagName:'INPUT'};mappings=[{engine:'ys200',source:'macro',sourceId:0,key:'AR',index:0,isOp:true,range:[1,31]}]");
  const macro=e.nodes.get('#mod-macros').children[0].querySelector();
  macro.value=50;macro.oninput();e.tick(50);
  assert.equal(e.run('refreshed.operators[0].AR'),16);
  assert.equal(e.run('voice.operators[0].AR'),27);
  e.run('comparing=true');e.tick(100);
  assert.equal(e.run('refreshed.operators[0].AR'),27);
});
test('Wander stays smooth, bounded and independent across cycles, with depth-scaled mappings',()=>{
  const e=setup();
  e.run("$('#voice-screen').hidden=true");
  const panels=e.nodes.get('#mod-top').children.slice(1);
  const fills=panels.map(panel=>panel.firstChild.firstChild.firstChild);
  const depths=panels.map((panel,i)=>panel.querySelectorAll().find(input=>input.attributes['aria-label']===`LFO ${i+1} depth`));
  panels.forEach((panel,i)=>{
    const waves=panel.children[1].children[0].children[1];
    assert.equal(waves.children.length,7);
    waves.children[6].onclick();
    depths[i].value=100;depths[i].oninput();
  });
  const output=i=>{
    const width=parseFloat(fills[i].style.width);
    return parseFloat(fills[i].style.left)<50?-width:width;
  };
  const values=[];
  for(let now=0;now<=4000;now+=10){
    e.tick(now);
    const value=output(0);
    assert.ok(Number.isFinite(value)&&Math.abs(value)<=50);
    if(values.length)assert.ok(Math.abs(value-values.at(-1))<3);
    values.push(value);
  }
  assert.ok(Math.max(...values)-Math.min(...values)>1);
  assert.notEqual(values[25],values[125]);
  assert.notEqual(output(0),output(1));
  const full=output(0);
  depths[0].value=50;depths[0].oninput();e.tick(4000);
  assert.ok(Math.abs(output(0)-full/2)<1e-10);
  e.run("mappings=[{engine:'ys200',source:'lfo',sourceId:0,key:'FBL',index:0,isOp:false,range:[0,7]}]");
  assert.equal(e.run('Modulations.apply(voice).global.FBL'),Math.round((.5+output(0)/100)*7));
  depths[0].value=0;depths[0].oninput();e.tick(4000);
  assert.equal(parseFloat(fills[0].style.width),0);
});

test('modulation settings round trip through storage and restore visible controls',()=>{
  const data=new Map(),storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
  const a=setup(storage),panels=a.nodes.get('#mod-top').children.slice(1);
  panels.forEach((panel,i)=>{
    const depth=panel.querySelectorAll().find(el=>el.attributes['aria-label']===`LFO ${i+1} depth`);
    depth.value=60+i;depth.oninput();
    const speed=panel.querySelectorAll().find(el=>el.attributes['aria-label']===`LFO ${i+1} speed`);
    speed.value=700+i*100;speed.oninput();
    panel.children[1].children[0].children[1].children[i+2].onclick();
  });
  const macro=a.nodes.get('#mod-macros').children[0];macro.querySelector().value=73;macro.querySelector().oninput();
  a.nodes.get('#mod-top').children[0].children[2].onclick();
  a.run('SessionStorage.write({modulations:Modulations.getState()})');
  const b=setup(storage);
  assert.equal(b.run('JSON.stringify(Modulations.getState())'),a.run('JSON.stringify(Modulations.getState())'));
  assert.equal(b.nodes.get('#mod-macros').children[0].querySelector().value,73);
  assert.equal(b.nodes.get('#mod-top').children[0].children[2].attributes['aria-pressed'],'true');
});

test('modulation destinations update sliders and wave buttons with clamped precision',()=>{
  const e=setup();
  e.run("Modulations.setValue('mod:macro:7:value',73.4);Modulations.setValue('mod:lfo:0:speed',2.345);Modulations.setValue('mod:lfo:1:depth',150);Modulations.setValue('mod:lfo:0:wave',6)");
  assert.equal(e.run('Modulations.getState().macros[7].value'),73);
  assert.equal(e.nodes.get('#mod-macros').children[7].querySelector().value,73);
  assert.equal(e.run('Modulations.getState().lfos[0].speed'),2.35);
  assert.equal(e.run('Modulations.getState().lfos[1].depth'),100);
  const waves=e.nodes.get('#mod-top').children[1].children[1].children[0].children[1];
  assert.equal(waves.children[6].attributes['aria-pressed'],'true');
  e.nodes.get('#show-modulations').onclick();
  assert.equal(e.nodes.get('#mappings').disabled,false);
  assert.equal(e.nodes.get('#mod-macros').children[0].lastChild.key,'mod:macro:0:value');
});
test('virtual sources drive modulation destinations and then synth destinations',()=>{
  const e=setup();
  e.run("$('#voice-screen').hidden=true;mappings=[{engine:'ys200',source:'xy',sourceId:'x',key:'mod:macro:0:value',range:[0,100]},{engine:'ys200',source:'macro',sourceId:0,key:'FBL',index:0,isOp:false,range:[0,6]}]");
  e.tick(50);
  assert.equal(e.run('Modulations.getState().macros[0].value'),50);
  assert.equal(e.run('Modulations.apply(voice).global.FBL'),3);
  e.run("comparing=true;Modulations.setValue('mod:macro:0:value',0)");e.tick(100);
  assert.equal(e.run('Modulations.getState().macros[0].value'),0);
});
