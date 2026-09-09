'use strict';
const Synths = (() => {
  const profiles=new Map([['ys200',YS200Profile],['dx7',DX7Profile]]);
  function get(id){
    const profile=profiles.get(id);
    if(!profile)throw new RangeError('Unknown synthesizer: '+id);
    if(profile.status!=='ready')throw new Error(profile.label+' controls are not implemented yet');
    return profile;
  }
  function snapshot(profile,voice){
    if(get(profile.id)!==profile)throw new Error('Unregistered synth profile');
    if(voice.operators.length!==profile.operatorCount)throw new RangeError('Wrong operator count');
    return {format:'fm-editor-voice',version:1,synthId:profile.id,voice:structuredClone(voice)};
  }
  return {get,snapshot,list:()=>Array.from(profiles.values(),p=>({id:p.id,label:p.label,status:p.status,operatorCount:p.operatorCount}))};
})();
