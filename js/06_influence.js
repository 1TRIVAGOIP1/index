/* =============================== Influence ============================== */
const Influence = {
  tick(dh){
    for(const t of World.terr){
      const present={};
      for(const u of World.units) if(u.loc===t.id&&u.state==='idle') present[u.f]=(present[u.f]||0)+(typeof Personnel!=='undefined'?Personnel.stat(u,'inf'):UNITS[u.kind].inf);
      const pontoMul=t.buildings.ponto?1.5:1;
      for(let f=0;f<4;f++){
        const p=present[f]||0;
        if(p>0){
          t.inf[f]=Math.min(100, t.inf[f]+p*0.85*pontoMul*(t.owner===f?1:0.6)*dh);
        }else if(t.owner!==f){
          t.inf[f]=Math.max(0,t.inf[f]-0.9*dh);
        }else{
          // Um território dominado não desaparece sozinho. A influência do dono
          // só entra em erosão relevante quando há pressão externa ou desordem.
          const rivalPressure=Object.keys(present).some(k=>+k!==f && (present[k]||0)>0);
          const pressure=(rivalPressure?0.22:0) + (t.unrest>70?0.10:0);
          t.inf[f]=Math.min(100,t.inf[f]+0.08*dh-pressure*dh);
        }
        // infiltração: presença rival corrói o dono de forma explícita.
        if(f!==t.owner && p>0 && t.owner!==null) t.inf[t.owner]=Math.max(0,t.inf[t.owner]-p*0.5*dh);
      }
      if(t.owner!==null && t.inf[t.owner]<CONF.influenceLose){
        const old=t.owner; t.owner=null;
        UI.log(`<b>${t.name}</b> escapou do controle de ${World.fac[old].short}.`, old===0?'hit':null);
        if(old===0) World.chron(`${t.name} escapou do seu controle (influência baixa demais).`);
      }
      if(t.owner===null){
        let best=-1,bv=0;
        for(let f=0;f<4;f++) if(t.inf[f]>bv){bv=t.inf[f];best=f;}
        if(best>=0 && bv>=CONF.influenceFlip){
          t.owner=best;
          UI.log(`<b>${World.fac[best].short}</b> assumiu o controle de <b>${t.name}</b>.`, best===0?'win':'hit');
          if(best!==0 && t.inf[0]>15) World.chron(`${World.fac[best].short} tomou ${t.name}.`);
        }
      }
    }
  }
};

