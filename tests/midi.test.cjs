const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
function model() {
  const c = vm.createContext({
    structuredClone,
    setTimeout,
    clearTimeout,
    console,
  });
  for (const f of [
    "ys200",
    "effects",
    "ys200-profile",
    "dx7",
    "midi-protocol",
    "midi-transport",
  ])
    vm.runInContext(fs.readFileSync("app/" + f + ".js", "utf8"), c);
  return (s) => vm.runInContext(s, c);
}
const plain = (x) => JSON.parse(JSON.stringify(x));
test("YS200 documented VCED/ACED wire order, sizes, offsets and request", () => {
  const run = model();
  run(
    `var v=YS200Profile.createVoice();v.operators[3].AR=12;v.operators[1].AR=14;v.operators[2].AR=16;v.operators[0].AR=18;var b=YS200Codec.encode(v);`,
  );
  assert.deepEqual(
    plain(run("[b.vced[0],b.vced[13],b.vced[26],b.vced[39]]")),
    [12, 14, 16, 18],
  );
  assert.deepEqual(
    plain(run("[b.vced[52],b.vced[62],b.vced[12],b.aced[19]]")),
    [4, 24, 6, 0],
  );
  assert.deepEqual(
    plain(run("MidiProtocol.split(YS200Codec.bulk(v,16)).map(a=>a.length)")),
    [21, 28, 41, 101],
  );
  assert.deepEqual(
    Array.from(run("YS200Codec.request(16,true)")),
    [240, 67, 47, 4, 247],
  );
  assert.deepEqual(
    Array.from(run('YS200Codec.parameter(v,"AR",1,16)')),
    [240, 67, 31, 18, 13, 14, 247],
  );
  assert.deepEqual(
    Array.from(run('YS200Codec.parameter(v,"wave",2)')),
    [240, 67, 16, 19, 13, 0, 247],
  );
});
test("YS200 single and bank round trips retain native fields, effects and hidden controller data", () => {
  const run = model();
  run(
    `var v=YS200Profile.createVoice();v.effects={preset:9,time:40,balance:99};var b=YS200Codec.encode(v);b.vced[71]=89;b.aced[21]=77;b.aced2[0]=66;v=YS200Codec.decode(b.vced,b);var single=YS200Codec.parse(YS200Codec.bulk(v)).voices[0];var packed=YS200Codec.unpack(YS200Codec.pack(v));`,
  );
  assert.deepEqual(
    plain(run("YS200Codec.encode(single)")),
    plain(run("YS200Codec.encode(v)")),
  );
  assert.deepEqual(
    plain(run("YS200Codec.encode(packed)")),
    plain(run("YS200Codec.encode(v)")),
  );
  assert.deepEqual(plain(run("packed.effects")), {
    preset: 9,
    time: 40,
    balance: 99,
  });
  run("var bank=YS200Codec.bulk(Array.from({length:32},()=>v),16)");
  assert.equal(run("bank.length"), 4104);
  assert.equal(run("YS200Codec.parse(bank).voices.length"), 32);
  assert.equal(run("YS200Codec.parse(bank).channel"), 16);
});
test("YS200 packed bytes agree with independent bit-field examples", () => {
  const run = model();
  run(
    `var v=YS200Profile.createVoice();Object.assign(v.operators[3],{AME:1,EBS:5,KVS:3,RATE:2,DET:-2,FIX:1,FIXRG:6,SHIFT:3,FINE:12,wave:5});Object.assign(v.global,{ALG:8,FBL:6,SYNC:1,LFW:2,AMS:3,PMS:5,MONO:1});var p=YS200Codec.pack(v);`,
  );
  assert.equal(run("p[6]"), 107);
  assert.equal(run("p[9]"), 17);
  assert.equal(run("p[40]"), 119);
  assert.equal(run("p[45]"), 94);
  assert.equal(run("p[73]"), 62);
  assert.equal(run("p[74]"), 92);
  assert.equal(run("p[48]"), 8);
});
test("incoming parameters, operator mask and DX7 names decode without mutating original", () => {
  const run = model();
  run(
    `var v=YS200Profile.createVoice();var n=YS200Codec.apply(v,MidiProtocol.parameter(19,3,7));`,
  );
  assert.equal(run("n.operators[3].wave"), 7);
  assert.equal(run("v.operators[3].wave"), 0);
  assert.equal(
    run("YS200Codec.apply(v,MidiProtocol.parameter(18,93,8)).operators[0].on"),
    1,
  );
  assert.equal(
    run("YS200Codec.apply(v,MidiProtocol.parameter(18,93,8)).operators[3].on"),
    0,
  );
  run(
    "var d=DX7.createVoice();var n=DX7Midi.apply(d,MidiProtocol.parameter(1,17,65))",
  );
  assert.equal(run("n.name[0]"), "A");
  assert.throws(() => run("DX7Midi.apply(d,MidiProtocol.parameter(1,27,64))"));
});
test("strict framing, checksums, channels and incomplete extensions reject atomically", () => {
  const run = model();
  run(
    "var v=YS200Profile.createVoice();var b=YS200Codec.bulk(v);var bad=b.slice();bad[17]^=1",
  );
  for (const expr of [
    "YS200Codec.parse(bad)",
    "YS200Codec.parse(b.slice(0,-1))",
    "YS200Codec.parse(b.slice(0,21))",
    "YS200Codec.bulk(v,0)",
    "YS200Codec.bulk([v])",
    "YS200Codec.apply(v,MidiProtocol.parameter(18,0,32))",
    "MidiProtocol.split([240,67,240,247])",
  ])
    assert.throws(() => run(expr), expr);
  assert.equal(run("YS200Codec.parse(b).voices.length"), 1);
  run("var d=DX7Codec.bulk(DX7.createVoice());");
  assert.equal(run("DX7Midi.parse([...d,...d]).voices.length"), 2);
  assert.throws(() => run("YS200Codec.parse(d)"));
  assert.throws(() => run("DX7Midi.parse(b)"));
});
test("transport asks for SysEx, receives selected input and suppresses loopback", async () => {
  const run = model();
  await run(
    `var sent=[],incoming=[],input={id:'i',state:'connected',open:async()=>{}},output={id:'o',state:'connected',open:async()=>{},send:b=>sent.push(Array.from(b)),clear(){}};var requested;var t=new MidiTransport({navigator:{requestMIDIAccess:async options=>{requested=options;return {sysexEnabled:true,inputs:new Map([['i',input]]),outputs:new Map([['o',output]])}}},onMessage:m=>incoming.push(Array.from(m)),delay:async()=>{}});t.connect().then(()=>t.select('i','o'));`,
  );
  assert.equal(run("requested.sysex"), true);
  run("t.enqueue([[240,67,16,0,0,12,247]])");
  await new Promise((r) => setImmediate(r));
  run(
    "input.onmidimessage({data:[240,67,16,0,0,12,247]});input.onmidimessage({data:[240,67,16,0,0,13,247]})",
  );
  assert.equal(run("incoming.length"), 1);
});
test("queued parameter coalescing and cancellation prevent stale sends", async () => {
  const run = model();
  run(
    `var sent=[],release;var t=new MidiTransport({delay:()=>new Promise(r=>release=r)});t.output={state:'connected',send:b=>sent.push(Array.from(b)),clear(){}};t.enqueue([[240,67,16,0,0,1,247]]);t.enqueue([[240,67,16,0,1,2,247]],{key:'x'});t.enqueue([[240,67,16,0,1,3,247]],{key:'x'});`,
  );
  assert.equal(run("t.queue.length"), 1);
  run("release()");
  await new Promise((r) => setImmediate(r));
  assert.equal(run("sent[1][5]"), 3);
  run("t.enqueue([[240,67,16,0,2,4,247]]);t.cancel();release()");
  await new Promise((r) => setImmediate(r));
  assert.equal(run("sent.filter(b=>b[0]===240).length"), 2);
});
test("audition emits DX7-compatible zero-velocity note-off; denied/unavailable MIDI fails clearly", async () => {
  const run = model();
  run(
    `var sent=[];var t=new MidiTransport();t.output={state:'connected',send:b=>sent.push(Array.from(b))};t.noteOn(60,100,16);t.noteOff(60,16);`,
  );
  assert.deepEqual(plain(run("sent")), [
    [159, 60, 100],
    [159, 60, 0],
  ]);
  assert.equal(run("t.notes.size"), 0);
  await assert.rejects(
    run("new MidiTransport({navigator:{}}).connect()"),
    /unavailable/,
  );
  await assert.rejects(
    run(
      "new MidiTransport({navigator:{requestMIDIAccess:async()=>({sysexEnabled:false})}}).connect()",
    ),
    /permission/,
  );
});

test("immediate send errors propagate, cancel clears queued data and releases held notes", () => {
  const run = model();
  run(
    "var t=new MidiTransport();t.output={state:'connected',send(){throw Error('device failed')},clear(){}};",
  );
  assert.throws(
    () => run("t.enqueue([[240,67,16,0,0,1,247]])"),
    /device failed/,
  );
  run(
    "var sent=[];t.output={state:'connected',send:b=>sent.push(Array.from(b)),clear(){}};t.noteOn(60,100,1);t.cancel();",
  );
  assert.equal(run("t.notes.size"), 0);
  assert.equal(run("sent.some(b=>b[0]===144&&b[1]===60&&b[2]===0)"), true);
});
