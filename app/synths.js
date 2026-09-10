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
  // Musical constraints, not a uniform sweep of every legal MIDI value.
  // Choose routing first, then derive amplitude and tuning from its roles.
  function randomise(profile,voice,rng=Math.random){
    const integer=(min,max)=>min+Math.floor(rng()*(max-min+1));
    const pick=values=>values[integer(0,values.length-1)];
    const ys=profile.id==='ys200',g=voice.global;
    g.ALG=integer(1,profile.algorithms.length);
    const layout=profile.algorithms[g.ALG-1],carriers=profile.carriers[g.ALG-1];
    const depth=i=>Math.max(0,...layout.edges.filter(([from])=>from===i).map(([,to])=>1+depth(to)));
    const characters=['pluck','sustain','soft'];
    const character=pick(characters);
    const bright=integer(0,2),fundamental=carriers[0];
    Object.assign(g,{FBL:integer(0,bright===2?5:3),SPD:integer(20,55),DLY:integer(0,30),
      LFW:ys?2:4,PMD:integer(0,5),AMD:integer(0,12),SYNC:1,PMS:integer(0,2),TRPS:0});
    if(ys)Object.assign(g,{AMS:integer(0,1),MONO:0,REV:integer(0,3)});
    else{
      g.OKS=1;
      for(let n=1;n<=4;n++){g['PR'+n]=integer(55,85);g['PL'+n]=n===4?50:integer(49,51);}
    }
    // The YS200 CRS is an encoded table index, not the ratio itself.
    // Match the ordered multiplier/detune table used by the instrument bridge.
    const ysRatios=[];
    for(let multiple=0;multiple<16;multiple++)for(const factor of [1,1.41,1.57,1.73])ysRatios.push((multiple||.5)*factor);
    ysRatios.sort((a,b)=>a-b);
    voice.operators.forEach((op,i)=>{
      const carrier=carriers.includes(i),stack=depth(i);
      // Keep a reliable fundamental, but give the other operators their own
      // contours. One contrasting layer prevents uniformly shaped patches.
      const contrast=i===(fundamental+1)%voice.operators.length;
      const contour=i===fundamental?character:pick(contrast?characters.filter(c=>c!==character):characters);
      const ratio=i===fundamental?1:carrier?pick([.5,1,1,2]):pick([.5,1,1,2,2,3,4,5,6,8]);
      Object.assign(op,{on:1,FIX:0,CRS:ys?ysRatios.indexOf(ratio):ratio===.5?0:ratio,
        FINE:carrier?0:pick([0,0,0,ys?integer(1,3):integer(1,12)]),DET:integer(ys?-2:-4,ys?2:4),
        KVS:integer(0,carrier?2:4),RATE:integer(0,carrier?1:2),
        OUT:carrier?integer(carriers.length>2?82:88,96):integer(45+bright*6,Math.max(62,85-stack*5)+bright*3)});
      if(ys){
        Object.assign(op,{wave:carrier?pick([0,0,1]):integer(0,7),FIXRG:0,SHIFT:0,
          AME:carrier?0:integer(0,1),EBS:0,LEVEL:integer(0,carrier?8:22),
          AR:contour==='soft'?integer(carrier?19:10,carrier?24:21):integer(carrier?27:25,31),
          D1R:contour==='pluck'?integer(carrier?12:16,carrier?22:31):integer(3,12),
          D1L:contour==='pluck'?integer(carrier?7:0,carrier?10:6):integer(carrier?12:8,15),
          D2R:contour==='pluck'?integer(carrier?3:5,carrier?8:18):0,
          RR:integer(carrier?5:4,carrier?12:15)});
      }else{
        Object.assign(op,{wave:0,AMS:carrier?0:integer(0,1),BP:39,LC:0,RC:0,
          LD:integer(0,carrier?5:15),RD:integer(0,carrier?10:25),
          R1:contour==='soft'?integer(carrier?55:40,68):integer(85,99),
          R2:contour==='pluck'?integer(55,carrier?75:90):integer(35,60),
          R3:contour==='pluck'?integer(35,65):integer(25,50),R4:integer(carrier?45:40,carrier?75:85),
          L1:carrier?99:contour==='soft'?integer(35,65):99,
          L2:contour==='pluck'?integer(carrier?65:25,carrier?85:60):integer(85,99),
          L3:contour==='pluck'?integer(carrier?40:0,carrier?60:30):integer(carrier?75:65,95),L4:0});
      }
      profile.normalize(op);
    });
    if(ys&&typeof YS200Codec!=='undefined'){
      const blocks=YS200Codec.encode(voice);
      // Clear controller-dependent attenuation even on imported/randomised voices.
      for(const address of [65,66,67,71,72,73,74,76])blocks.vced[address]=0;
      blocks.vced[64]=2;blocks.vced[75]=50;
      blocks.aced[21]=blocks.aced[22]=0;
      blocks.aced2.splice(0,4,0,0,50,0);
      voice.sysex={...voice.sysex,vced:blocks.vced,aced:blocks.aced,aced2:blocks.aced2};
    }
    return ys?{preset:pick([0,1,2,3,4,5]),time:integer(8,22),balance:integer(10,30)}:null;
  }
  return {get,snapshot,randomise,list:()=>Array.from(profiles.values(),p=>({id:p.id,label:p.label,status:p.status,operatorCount:p.operatorCount}))};
})();
