// Generate reference messages with the actual editor codecs, independently of Rust.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const context = vm.createContext({structuredClone});
for (const name of ['ys200.js', 'dx7.js', 'effects.js', 'ys200-profile.js', 'midi-protocol.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'app', name), 'utf8'), context);
}
const dir = path.join(__dirname, 'fixtures');
fs.mkdirSync(dir, {recursive:true});
for (const model of ['dx7','ys200']) {
  const fixtures = vm.runInContext(`(() => {
    const model = '${model}', dx = model === 'dx7';
    const codec = dx ? DX7Codec : YS200Codec;
    const voice = dx ? DX7.createVoice() : YS200Profile.createVoice();
    if (!dx) voice.effects = {preset:3,time:13,balance:0};
    const original = Array.from(codec.bulk(voice));
    const messages = [];
    const ranges = dx ? DX7.ranges : YS200.ranges;
    for (let i=0; i<voice.operators.length; i++) {
      for (const key of Object.keys(voice.operators[i])) {
        if (key === 'on' || !ranges[key] || (!dx && key === 'SHIFT' && i === 0)) continue;
        const [lo,hi] = ranges[key];
        voice.operators[i][key] = key === 'FINE' && !dx ? 5 : lo + Math.floor((hi-lo)*.61);
        if (key === 'wave' && dx) continue;
        messages.push(Array.from(codec.parameter(voice,key,i)));
      }
    }
    for (const key of Object.keys(voice.global)) {
      if (!ranges[key] || ['CHrs'].includes(key)) continue;
      const [lo,hi] = ranges[key];voice.global[key]=lo+Math.floor((hi-lo)*.43);
      messages.push(Array.from(codec.parameter(voice,key)));
    }
    if (!dx) {
      // Hidden controller bytes and the extended aftertouch bytes must survive.
      const blocks=YS200Codec.encode(voice); blocks.vced[71]=57;blocks.aced2[7]=79;
      const withHidden=YS200Codec.decode(blocks.vced,blocks);
      Object.assign(voice,withHidden);
      messages.push(...MidiProtocol.split(YS200Codec.bulk(voice)).map(m=>Array.from(m)));
    }
    const final=Array.from(codec.bulk(voice));
    const bank=Array.from({length:32},(_,i)=>{
      const v=structuredClone(voice);v.name='RUST '+String(i).padStart(2,'0');
      v.global.ALG=1+(i%(dx?32:8));
      return v;
    });
    return {original,messages,final,bank:Array.from(codec.bulk(bank))};
  })()`, context);
  for (const key of ['original','final','bank']) fs.writeFileSync(path.join(dir,`${model}-${key}.syx`),Buffer.from(fixtures[key]));
  fs.writeFileSync(path.join(dir,`${model}-edits.syx`),Buffer.from(fixtures.messages.flat()));
}
console.log('Editor fixtures written to',dir);
