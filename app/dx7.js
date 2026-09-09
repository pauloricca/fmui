'use strict';
// Original DX7 voice model. Sources and schematic limitations: DX7_REFERENCE.md.
const DX7 = (() => {
const operatorKeys=['R1','R2','R3','R4','L1','L2','L3','L4','BP','LD','RD','LC','RC','RATE','AMS','KVS','OUT','FIX','CRS','FINE','DET'];
const globalKeys=['PR1','PR2','PR3','PR4','PL1','PL2','PL3','PL4','ALG','FBL','OKS','SPD','DLY','PMD','AMD','SYNC','LFW','PMS','TRPS'];
const ranges=Object.fromEntries([...operatorKeys,...globalKeys].map(k=>[k,[0,99]]));
Object.assign(ranges,{ALG:[1,32],FBL:[0,7],OKS:[0,1],SYNC:[0,1],LFW:[0,5],PMS:[0,7],TRPS:[-24,24],LC:[0,3],RC:[0,3],RATE:[0,7],AMS:[0,3],KVS:[0,7],FIX:[0,1],CRS:[0,31],DET:[-7,7],wave:[0,0],on:[0,1]});
const valid=(key,value)=>!!ranges[key]&&Number.isInteger(value)&&value>=ranges[key][0]&&value<=ranges[key][1];
function createVoice(){return {name:'INIT VOICE',global:{PR1:99,PR2:99,PR3:99,PR4:99,PL1:50,PL2:50,PL3:50,PL4:50,ALG:1,FBL:0,OKS:1,SPD:35,DLY:0,PMD:0,AMD:0,SYNC:1,LFW:0,PMS:3,TRPS:0},operators:Array.from({length:6},(_,i)=>({R1:99,R2:99,R3:99,R4:99,L1:99,L2:99,L3:99,L4:0,BP:39,LD:0,RD:0,LC:0,RC:0,RATE:0,AMS:0,KVS:0,OUT:i===0?99:0,FIX:0,CRS:1,FINE:0,DET:0,wave:0,on:1}))};}
function validate(v){if(!v||v.operators?.length!==6||!v.global||typeof v.name!=='string'||v.name.length>10||/[^\x00-\x7f]/.test(v.name))throw new RangeError('Invalid DX7 voice');for(const op of v.operators)for(const k of [...operatorKeys,'wave','on'])if(!valid(k,op[k]))throw new RangeError('Invalid DX7 operator '+k);for(const k of globalKeys)if(!valid(k,v.global[k]))throw new RangeError('Invalid DX7 global '+k);return v;}
function frequencyLabel(op){return op.FIX?`${(10**((op.CRS%4)+op.FINE/100)).toFixed(2)} Hz`:`RATIO ${((op.CRS||.5)*(1+op.FINE/100)).toFixed(2)}`;}
// Relative stage sketch: L4 -> L1 -> L2 -> L3, held until key-off, then L4.
// Rates are nonlinear; this is deliberately not a hardware-time simulation.
function envelopePoints(op){
  const levels=[op.L4,op.L1,op.L2,op.L3,op.L4];
  const times=[1,2,3,4].map((n,i)=>Math.abs(levels[i+1]-levels[i])/99*2**((99-op['R'+n])/8));
  const total=32+times.reduce((a,b)=>a+b,0),finite=times.filter(t=>t>0).length;
  const width=t=>t===0?0:1+(244-finite)*t/total;
  const y=l=>103-95*l/99;
  let x=3,keyOffX;const points=[[x,y(op.L4)]],guides=[];
  for(let i=0;i<4;i++){
    if(i===3){x+=(244-finite)*32/total;keyOffX=x;points.push([x,y(op.L3)]);}
    x+=width(times[i]);points.push([x,y(levels[i+1])]);
    if(times[i]>0)guides.push({key:'R'+(i+1),axis:'x',x,y:y(levels[i+1])});
    guides.push({key:'L'+(i+1),axis:'y',x,y:y(levels[i+1])});
  }
  return {points,guides,hold:'L3 HOLD',keyOffX};
}
// Yamaha algorithm topology, OP numbers are one-based here for auditability.
const routes=[
['65 54 43 21',6,6],['65 54 43 21',2,2],['65 54 32 21',6,6],['65 54 32 21',4,6],
['65 43 21',6,6],['65 43 21',5,6],['65 53 43 21',6,6],['65 53 43 21',4,4],['65 53 43 21',2,2],
['64 54 32 21',3,3],
['64 54 32 21',6,6],['63 53 43 21',2,2],['63 53 43 21',6,6],
['64 54 43 21',6,6],['64 54 43 21',2,2],['65 51 43 31 21',6,6],['65 51 43 31 21',2,2],['65 54 41 31 21',3,3],
['65 64 32 21',6,6],['64 54 32 31',3,3],['65 64 32 31',3,3],['65 64 63 21',6,6],['65 64 32',6,6],['65 64 63',6,6],['65 64',6,6],['64 54 32',6,6],['64 54 32',3,3],['54 43 21',5,5],['65 43',6,6],['54 43',5,5],['65',6,6],['',6,6]
];
const algorithms=routes.map(([route,from,to])=>{const edges=route?route.split(' ').map(s=>[Number(s[0])-1,Number(s[1])-1]):[];const carriers=Array.from({length:6},(_,i)=>i).filter(i=>!edges.some(e=>e[0]===i));const depth=i=>Math.max(0,...edges.filter(e=>e[0]===i).map(e=>1+depth(e[1])));const positions=Array(6);for(let d=0;d<=3;d++){const row=Array.from({length:6},(_,i)=>i).filter(i=>depth(i)===d);row.forEach((i,n)=>positions[i]=[14+(n+.5)*160/row.length,128-d*32]);}return {edges,positions,feedback:[[from-1,to-1]],carriers};});
return {operatorKeys,globalKeys,ranges,valid,validate,createVoice,frequencyLabel,envelopePoints,algorithms,carriers:algorithms.map(a=>a.carriers),limits:k=>ranges[k],unsupported:{},reason:()=>'',controlReason:()=>'',normalize:()=>{}};
})();

const DX7Codec=(()=>{
const wire=(k,v)=>k==='DET'?v+7:k==='TRPS'?v+24:k==='ALG'?v-1:v;
const native=(k,v)=>k==='DET'?v-7:k==='TRPS'?v-24:k==='ALG'?v+1:v;
function bytes(data,length){const a=Array.from(data);if(a.length!==length||a.some(v=>!Number.isInteger(v)||v<0||v>127))throw new RangeError('Invalid DX7 data length or non-seven-bit byte');return a;}
function encode(v){DX7.validate(v);return Uint8Array.from([...v.operators.slice().reverse().flatMap(op=>DX7.operatorKeys.map(k=>wire(k,op[k]))),...DX7.globalKeys.map(k=>wire(k,v.global[k])),...v.name.padEnd(10,' ').split('').map(c=>c.charCodeAt(0))]);}
function decode(data){const a=bytes(data,155),v=DX7.createVoice();for(let n=0;n<6;n++)DX7.operatorKeys.forEach((k,j)=>v.operators[5-n][k]=native(k,a[n*21+j]));DX7.globalKeys.forEach((k,j)=>v.global[k]=native(k,a[126+j]));v.name=String.fromCharCode(...a.slice(145)).trimEnd();return DX7.validate(v);}
function pack(v){const a=encode(v),p=[];for(let n=0;n<6;n++){const o=a.slice(n*21,n*21+21);p.push(...o.slice(0,11),o[11]|o[12]<<2,o[13]|o[20]<<3,o[14]|o[15]<<2,o[16],o[17]|o[18]<<1,o[19]);}p.push(...a.slice(126,134),a[134],a[135]|a[136]<<3,...a.slice(137,141),a[141]|a[142]<<1|a[143]<<4,a[144],...a.slice(145));return Uint8Array.from(p);}
function unpack(data){const p=bytes(data,128),a=[];for(let n=0;n<6;n++){const o=p.slice(n*17,n*17+17);if(o[11]>15||o[13]>31||o[15]>63)throw new RangeError('Reserved DX7 bits set');a.push(...o.slice(0,11),o[11]&3,o[11]>>2,o[12]&7,o[13]&3,o[13]>>2,o[14],o[15]&1,o[15]>>1,o[16],o[12]>>3);}if(p[110]>31||p[111]>15)throw new RangeError('Reserved DX7 bits set');a.push(...p.slice(102,110),p[110],p[111]&7,p[111]>>3,...p.slice(112,116),p[116]&1,(p[116]>>1)&7,p[116]>>4,p[117],...p.slice(118));return decode(a);}
function channel(c){if(!Number.isInteger(c)||c<1||c>16)throw new RangeError('MIDI channel must be 1–16');return c-1;}
const checksum=a=>(-Array.from(a).reduce((s,b)=>s+b,0))&127;
function bulk(v,c=1){const data=Array.isArray(v)?(v.length===32?Uint8Array.from(v.flatMap(x=>Array.from(pack(x)))):(()=>{throw new RangeError('A DX7 bank needs 32 voices')})()):encode(v);return Uint8Array.from([240,67,channel(c),data.length===155?0:9,data.length>>7,data.length&127,...data,checksum(data),247]);}
function parse(data){const a=Array.from(data);if(a[0]!==240||a[1]!==67||a.at(-1)!==247||a[2]>15||a[2]<0)throw new RangeError('Not a DX7 bulk dump');const length=a[3]===0?155:a[3]===9?4096:0;if(!length||a.length!==length+8||a[4]*128+a[5]!==length)throw new RangeError('Invalid DX7 format or length');bytes(a.slice(2,-1),length+5);const payload=a.slice(6,-2);if(checksum(payload)!==a.at(-2))throw new RangeError('DX7 checksum mismatch');return {channel:a[2]+1,voices:length===155?[decode(payload)]:Array.from({length:32},(_,i)=>unpack(payload.slice(i*128,(i+1)*128)))};}
function parameter(v,key,index=0,c=1){DX7.validate(v);let address,value;if(key==='on'){address=155;value=v.operators.reduce((mask,op,i)=>mask|(op.on<<(5-i)),0);}else if(DX7.operatorKeys.includes(key)){if(!Number.isInteger(index)||index<0||index>5)throw new RangeError('Invalid operator');address=(5-index)*21+DX7.operatorKeys.indexOf(key);value=wire(key,v.operators[index][key]);}else{const i=DX7.globalKeys.indexOf(key);if(i<0)throw new RangeError('Unknown voice parameter');address=126+i;value=wire(key,v.global[key]);}return Uint8Array.from([240,67,16+channel(c),address>>7,address&127,value,247]);}
return {encode,decode,pack,unpack,bulk,parse,parameter,checksum};
})();
