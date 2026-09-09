'use strict';
// YS100/YS200 MIDI appendix Add-11–13; see PARAMETER_AUDIT.md.
const YS200 = (() => {
  const unsupported = {CHrs:'The YS200 ignores the legacy DX chorus parameter.',FIXRM:'No low-frequency mode in the YS200 ACED format; this slot is reserved.'};
  const ranges = {ALG:[1,8],FBL:[0,7],SPD:[0,99],DLY:[0,99],LFW:[0,3],PMD:[0,99],AMD:[0,99],SYNC:[0,1],PMS:[0,7],AMS:[0,3],AME:[0,1],EBS:[0,7],KVS:[0,7],MONO:[0,1],TRPS:[-24,24],FIX:[0,1],FIXRG:[0,7],CRS:[0,63],FINE:[0,15],DET:[-3,3],SHIFT:[0,3],AR:[1,31],D1R:[0,31],D1L:[0,15],D2R:[0,31],RR:[1,15],REV:[0,7],RATE:[0,3],LEVEL:[0,99],OUT:[0,99],wave:[0,7],on:[0,1]};
  const carriers = [[0],[0],[0],[0],[0,2],[0,1,2],[0,1,2],[0,1,2,3]];
  function reason(key,op,index){return unsupported[key] || (key==='SHIFT'&&index===0?'Operator 1 envelope shift is fixed at Off.':key==='FIXRG'&&!op.FIX?'Fixed frequency range only applies in FIX mode.':'');}
  function limits(key,op){return key==='FINE'&&!op.FIX&&op.CRS<4?[0,7]:ranges[key];}
  function valid(key,value,op,index){const r=limits(key,op);return !reason(key,op,index)&&r&&Number.isInteger(value)&&value>=r[0]&&value<=r[1];}
  function normalize(op){op.FINE=Math.min(op.FINE,limits('FINE',op)[1]);}
  // Do not label an encoded frequency index as a measured ratio or Hz value.
  function frequencyLabel(op){return `${op.FIX?'FIX':'RTO'} CRS:${op.CRS} FIN:${op.FINE}`;}
  // A complete stage-relative overview, not a fixed-duration note simulation.
  // Fit the full relative duration uniformly; only one pixel is reserved per
  // finite stage so fast stages do not become artificial long ramps.
  function envelopePoints(op,index=0){
    const duration=r=>8*Math.pow(2,(31-r)/4);
    const sustain=op.D1L===0?0:1-(15-op.D1L)*3/96;
    const shift=[96,48,24,12][index===0?0:op.SHIFT];
    const attack=op.AR===31?0:duration(op.AR);
    const stages=[{key:"AR",level:1,time:attack}];
    let level=1;
    if(op.D1R!==0||sustain===1){
      if(sustain<1)stages.push({key:"D1R",level:sustain,time:duration(op.D1R)*(1-sustain)});
      level=sustain;
      if(level>0){
        const next=op.D2R===0?level:level/2;
        stages.push({key:"D2R",level:next,time:op.D2R===0?32:duration(op.D2R)*(level-next)});
        level=next;
      }
    }else stages.push({key:"D1R",level:1,time:32}); // first decay holds indefinitely
    const offLevel=level;
    if(level>0)stages.push({key:"RR",level:0,time:duration(op.RR*2+1)*level});
    const weights=stages.map(s=>s.time);
    const visibleStages=stages.filter(s=>s.time>0).length;
    const available=244-visibleStages,total=weights.reduce((a,b)=>a+b,0);
    const y=level=>Math.round(8+(1-level)*shift/96*95);
    const points=[[3,y(0)]];let x=3;
    stages.forEach((stage,i)=>{x+=stage.time===0?0:1+available*weights[i]/total;points.push([x,y(stage.level)]);});
    points[points.length-1][0]=247;
    const hold=op.D1R===0&&sustain<1?'D1 HOLD':op.D2R===0&&sustain>0?'D2 HOLD':'';
    const guides=stages.map((stage,n)=>({key:stage.key,axis:'x',x:points[n+1][0],y:points[n+1][1]}));
    // The level handle shares the first-decay corner. A first-decay hold
    // never reaches that level, so there is no corresponding plotted handle.
    if(op.D1R!==0||sustain===1){
      const corner=sustain===1?points[1]:points[2];
      guides.push({key:'D1L',axis:'y',x:corner[0],y:corner[1]});
    }
    return {points,offLevel,sustain,attack,shift,hold,guides};
  }
  const algorithms = [
    {positions:[[60,128],[60,94],[60,60],[60,26]],edges:[[3,2],[2,1],[1,0]]},
    {positions:[[60,128],[60,88],[36,38],[84,38]],edges:[[2,1],[3,1],[1,0]]},
    {positions:[[60,128],[36,88],[36,48],[84,88]],edges:[[2,1],[1,0],[3,0]]},
    {positions:[[60,128],[36,88],[84,88],[84,48]],edges:[[3,2],[2,0],[1,0]]},
    {positions:[[36,128],[36,76],[84,128],[84,76]],edges:[[1,0],[3,2]]},
    {positions:[[24,128],[60,128],[96,128],[60,66]],edges:[[3,0],[3,1],[3,2]]},
    {positions:[[24,128],[60,128],[96,128],[96,76]],edges:[[3,2]]},
    {positions:[[18,128],[46,128],[74,128],[102,128]],edges:[]}
  ];
  algorithms.forEach(layout=>{layout.feedback=[[3,3]];});
  return {ranges,unsupported,carriers,reason,limits,valid,normalize,frequencyLabel,envelopePoints,algorithms};
})();
