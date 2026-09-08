'use strict';
// Yamaha YS100/200 MIDI appendix, EFEDS and parameter-change lists.
const Effects = (() => {
  const names=['REVERB HALL','REVERB ROOM','REVERB PLATE','DELAY','DELAY LEFT / RIGHT','STEREO ECHO','DISTORTION + REVERB','DISTORTION + ECHO','GATE REVERB','REVERSE GATE'];
  const limits={preset:10,time:40,balance:99};
  function validate(state){for(const [key,max] of Object.entries(limits))if(!Number.isInteger(state[key])||state[key]<0||state[key]>max)throw new RangeError('Invalid effect '+key);}
  function channel(n){if(!Number.isInteger(n)||n<1||n>16)throw new RangeError('MIDI channel must be 1–16');return n-1;}
  function changes(state,n=1){validate(state);const ch=channel(n);return Uint8Array.from(['preset','time','balance'].flatMap((key,i)=>[0xf0,0x43,0x10+ch,0x24,4+i,state[key],0xf7]));}
  function bulk(state,n=1){validate(state);const ch=channel(n),data=[...Array.from('LM  8036EF',c=>c.charCodeAt(0)),state.preset,state.time,state.balance];return Uint8Array.from([0xf0,0x43,ch,0x7e,0,13,...data,(-data.reduce((a,b)=>a+b,0))&127,0xf7]);}
  return {names,validate,changes,bulk};
})();
