/* =============================== Alerts ================================= */
/* Só leitura sobre World: nenhuma mecânica nova, apenas prioriza o que já
   existe e pede decisão do jogador. sev: 2=crítico, 1=atenção, 0=informativo. */
const Alerts = {
  list(fid){
    const out=[], f=World.fac[fid], mine=World.owned(fid);

    if(f.money < World.upkeep(fid)*20) out.push({sev:2,tid:null,txt:`Caixa próxima do colapso: cobre menos de 20 h de custeio (${Math.round(f.money)}).`});
    else if(f.money < World.upkeep(fid)*60) out.push({sev:1,tid:null,txt:`Caixa apertada: reserva cobre menos de 60 h de custeio.`});

    if(f.heat>=CONF.raidAt-12 && f.heat<CONF.raidAt) out.push({sev:1,tid:null,txt:`Pressão policial em ${Math.round(f.heat)}% — perto do limiar de operação.`});
    if(f.heat>=CONF.raidAt) out.push({sev:2,tid:null,txt:`Pressão policial crítica (${Math.round(f.heat)}%) — operação pode ocorrer a qualquer hora.`});

    for(const v of World.veh){
      if(v.f!==fid) continue;
      if(v.note==='sem combustível'||v.note==='sem combustível na estrada') out.push({sev:2,tid:v.loc,txt:`${VEHICLES[v.kind].name} #${v.id} está sem combustível${v.loc?` em ${World.ix[v.loc].name}`:' na estrada'}.`});
      else if(v.note==='tanque insuficiente para a viagem') out.push({sev:1,tid:v.loc,txt:`${VEHICLES[v.kind].name} #${v.id} não tem combustível suficiente para a próxima viagem.`});
      else if(v.note==='destino lotado'||v.note==='destino comercial lotado') out.push({sev:1,tid:v.route?v.route.b:null,txt:`${VEHICLES[v.kind].name} #${v.id} não consegue descarregar: destino sem espaço.`});
      else if(v.note==='origem perdida') out.push({sev:1,tid:null,txt:`${VEHICLES[v.kind].name} #${v.id} perdeu a origem da rota — reatribua manualmente.`});
    }

    for(const t of mine){
      if((t.inf[fid]||0) < 40) out.push({sev: t.inf[fid]<28?2:1, tid:t.id, txt:`${t.name} perdendo influência: ${Math.round(t.inf[fid])}% (controle exige presença de vapores).`});
      if(World.load(t) >= World.cap(t)*0.94) out.push({sev:1,tid:t.id, txt:`Estoque de ${t.name} praticamente cheio — produção pode ser desperdiçada.`});
      const dem=SELLABLE.reduce((s,g)=>s+(t.demand[g]||0),0);
      if(dem<0.15 && (t.type==='sitio'||t.type==='oficina') && World.load(t)>10 && !mine.some(o=>o.id!==t.id&&SELLABLE.reduce((s,g)=>s+(o.demand[g]||0),0)>0.5))
        out.push({sev:0,tid:t.id, txt:`${t.name} produz sem boca próximo com demanda relevante — considere uma rota mais longa.`});
      if(t.unrest>45) out.push({sev:1,tid:t.id, txt:`Desordem alta em ${t.name} (${Math.round(t.unrest)}%) — produção e escoamento reduzidos.`});
      // Fábrica travada há várias horas: sev sobe para crítico depois de
      // 18h seguidas, para diferenciar um travamento passageiro de um
      // prejuízo real e continuado. lastCost*stuckSince aproxima o quanto já
      // foi pago em opCost sem produzir nada além do gargalo.
      if(t.factory && t.factory.active && t.factory.bottleneck && (t.factory.stuckSince||0)>=6){
        const lost=Math.round((t.factory.lastCost||0)*(t.factory.stuckSince||0));
        out.push({sev:t.factory.stuckSince>18?2:1, tid:t.id,
          txt:`${t.name}: fábrica travada há ${Math.round(t.factory.stuckSince)} h por falta de ${GOODS[t.factory.bottleneck].name} — prejuízo acumulado ~${money(lost)}.`});
      }
      if(t.works.length){ const w=t.works[0]; out.push({sev:0,tid:t.id, txt:`Obra em ${t.name}: ${Math.ceil(w.need-w.p)} h restantes.`}); }
    }

    for(const v of World.veh.filter(x=>x.f===fid)){
      if((v.condition||100)<25) out.push({sev:2,tid:v.loc,txt:`${VEHICLES[v.kind].name} #${v.id} está com ${Math.round(v.condition)}% de condição.`});
      if(v.note==='sem motorista disponível') out.push({sev:1,tid:v.loc,txt:`${VEHICLES[v.kind].name} #${v.id} está sem motorista.`});
    }
    for(const t of mine){
      if((t.heat||0)>70) out.push({sev:2,tid:t.id,txt:`Pressão local alta em ${t.name}: ${Math.round(t.heat)}%.`});
      if(t.buildings.ponto){
        const pLoad=SELLABLE.reduce((s,g)=>s+t.pointStock[g],0);
        if(pLoad<0.5 && World.load(t)>20) out.push({sev:1,tid:t.id,txt:`Boca de ${t.name} está vazia enquanto há carga no estoque do território.`});
        if(pLoad>=79) out.push({sev:0,tid:t.id,txt:`Boca de ${t.name} está cheia — distribuição adicional aguarda espaço.`});
      }
    }
    for(const tr of World.trades){
      if(tr.seller===fid && tr.status==='accepted' && !tr.vehicleId)
        out.push({sev:1,tid:tr.origin,txt:`Venda para ${World.fac[tr.buyer].short} aguardando transporte.`});
      if(tr.seller===fid && tr.status==='transporting')
        out.push({sev:0,tid:tr.dest,txt:`Entrega comercial em trânsito para ${World.fac[tr.buyer].short}.`});
    }

    for(const op of World.ops){
      if(op.f===fid) out.push({sev:0,tid:op.to, txt:`Operação em preparo sobre ${World.ix[op.to].name}: faltam ${Math.ceil(op.need-op.prep)} h.`});
      else if(World.ix[op.to].owner===fid) out.push({sev:2,tid:op.to, txt:`${World.fac[op.f].short} concentra forças contra ${World.ix[op.to].name} — ${op.state==='prep'?`preparo em curso`:'em marcha'}.`});
    }
    // Escassez de importação (aviso antecipado e falta em curso).
    for(const c of Scarcity.current()){
      const nm=GOODS[c.good].name;
      if(c.phase==='warning') out.push({sev:1,tid:null,txt:`Escassez à vista: ${nm} some do abastecimento externo em ~${Math.ceil(c.hoursToStart)} h, por ~${Math.ceil(c.hoursLeft-c.hoursToStart)} h. Estoque agora pode salvar a firma.`});
      else out.push({sev:2,tid:null,txt:`${nm} em falta no abastecimento externo por mais ~${Math.ceil(c.hoursLeft)} h — portos não vendem.`});
    }
    const gr=World.greed&&World.greed[fid];
    if(gr&&gr.t>=3) out.push({sev:gr.t>=6?2:1,tid:null,txt:`Cobiça nível ${gr.t}: a fortuna atrai polícia, rivais e traição — custeio +${Math.round((Greed.upkeepMult(fid)-1)*100)}%.`});
    out.sort((a,b)=>b.sev-a.sev);
    return out;
  }
};

/* ================================= Greed ================================ */
/* O jogo é INFINITO: não há vitória. Em vez disso, quanto mais rica a firma,
   mais ela vira alvo — a cobiça é o motor da queda. Não é um castigo
   arbitrário: cada efeito pesa mais em quem acumulou mais, e todos podem ser
   amenizados por boas decisões (gastar, proteger, não abusar de preço,
   manter reputação e presença nos territórios).
   Nível de cobiça = degraus de riqueza (cada degrau = ×STEP sobre BASE), sem
   teto de riqueza; os efeitos crescem até MAXT.
     • custeio  +4% por nível (a estrutura de proteção encarece)
     • calor    +0.07/h por nível (dinheiro chama atenção)
     • batidas  confiscam 3% do caixa por nível (até 30%)
     • rivais   priorizam atacar quem é rico (ver AI.genContestGoals)
     • alianças esfriam (nível ≥ 3)
     • traição  (nível ≥ 2, firma com ≥ 2 territórios): um território é
                entregue e parte do caixa some. A chance cresce com desordem,
                preço abusivo, reputação ruim e territórios sem guarda. */
const Greed={
  BASE:30000, STEP:1.7, MAXT:10,
  acc:0, allyClock:12,
  /* Patrimônio "de rua": caixa + estoque + parque fabril. Território em si
     não conta (não é riqueza que se possa perder numa batida). */
  fortune(fid){
    const f=World.fac[fid]; if(!f) return 0;
    let v=f.money;
    for(const t of World.owned(fid)){
      for(const g of GK) v+=(t.stock[g]||0)*(GOODS[g].base||GOODS[g].buy*0.6)*0.5;
      for(const g of SELLABLE) v+=(t.pointStock[g]||0)*GOODS[g].base*0.5;
      if(t.factory) v+=(t.factory.level||1)*1500;
      for(const b in t.buildings) if(t.buildings[b]) v+=BUILD[b].cost*0.4;
    }
    return v;
  },
  tierOf(fortune){
    if(fortune<this.BASE*this.STEP) return 0;
    return Math.min(this.MAXT,Math.floor(Math.log(fortune/this.BASE)/Math.log(this.STEP)));
  },
  tier(fid){ return (World.greed&&World.greed[fid]&&World.greed[fid].t)||0; },
  wealth(fid){ return (World.greed&&World.greed[fid]&&World.greed[fid].f)||0; },
  upkeepMult(fid){ return 1+0.04*this.tier(fid); },
  betrayalChance(f,t){
    const mine=World.owned(f.id); if(mine.length<2) return 0;
    const unrest=mine.reduce((a,x)=>a+x.unrest,0)/mine.length;
    let gouge=0,nb=0;
    for(const x of mine) if(x.buildings.ponto){ nb++; for(const g of SELLABLE) gouge+=Math.max(0,(x.priceMult[g]||1)-1); }
    gouge=nb?gouge/(nb*3):0;
    const rep=Math.max(0,50-f.reputation)/50;
    return 0.0004*Math.pow(Math.min(t,this.MAXT),1.3)*(1+unrest/40+rep*1.5+gouge*3);
  },
  /* Resumo para a UI. betrayalPer100h é aproximado (chance/h × 100). */
  describe(fid){
    const f=World.fac[fid], t=this.tier(fid);
    return {fortune:this.wealth(fid),tier:t,
      upkeepPct:Math.round((this.upkeepMult(fid)-1)*100),
      heatPerH:+(0.07*Math.min(t,this.MAXT)).toFixed(2),
      cashSeizePct:t>=1?Math.round(Math.min(0.30,0.03*t)*100):0,
      betrayalPer100h:t>=2?+(this.betrayalChance(f,t)*100).toFixed(1):0,
      nextAt:Math.round(this.BASE*Math.pow(this.STEP,t+1))};
  },
  betray(f,t){
    const mine=World.owned(f.id).filter(x=>x.id!==f.home); if(!mine.length) return;
    // O ponto mais descuidado: pouca guarda e pouca influência.
    const guard=x=>World.units.filter(u=>u.f===f.id&&u.loc===x.id&&u.state==='idle').length;
    mine.sort((a,b)=>(guard(a)*20+(a.inf[f.id]||0))-(guard(b)*20+(b.inf[f.id]||0)));
    const x=mine[0];
    const cash=f.money>0?Math.round(f.money*(0.08+Math.random()*0.08)):0;
    f.money-=cash;
    x.owner=null; x.inf[f.id]=0; x.unrest=Math.min(100,x.unrest+25);
    for(let i=World.units.length-1;i>=0;i--) if(World.units[i].f===f.id&&World.units[i].loc===x.id&&World.units[i].state==='idle') World.units.splice(i,1);
    if(f.id===0){
      UI.log(`🗡️ <b>Traição em ${x.name}</b>: o responsável local entregou o ponto e sumiu com ${money(cash)}.`,'hit');
      World.chron(`Traição em ${x.name}: ponto entregue e ${money(cash)} desaparecidos (cobiça nível ${t}).`);
      if(typeof Notifications!=='undefined') Notifications.push('threat','Traição na firma',`${x.name} foi entregue por quem você confiava, junto com ${money(cash)} do caixa. Fortunas grandes atraem traidores.`,2,`betray-${x.id}-${Math.floor(World.h)}`,{label:'Ver território',tab:'terr',tid:x.id});
    } else UI.log(`🗡️ ${f.short} sofreu uma traição interna em ${x.name}.`);
  },
  tick(dh){
    for(const f of World.fac){
      const t=this.tier(f.id);
      if(f.alive&&t>=1) f.heat=Math.min(CONF.heatMax,f.heat+0.07*Math.min(t,this.MAXT)*dh);
    }
    this.acc+=dh; if(this.acc<1) return;
    const step=this.acc; this.acc=0;
    for(const f of World.fac){
      if(!f.alive){ World.greed[f.id]={f:0,t:0}; continue; }
      const fo=this.fortune(f.id), old=this.tier(f.id), t=this.tierOf(fo);
      World.greed[f.id]={f:fo,t};
      if(f.id===0){
        if(fo>World.peakFortune){ World.peakFortune=fo; World.peakDay=Math.floor(World.h/24)+1; }
        if(t>old && typeof Notifications!=='undefined')
          Notifications.push('police',`Cobiça nível ${t}`,`Sua fortuna (${money(fo)}) atraiu mais atenção: custeio +${Math.round((this.upkeepMult(0)-1)*100)}%, mais calor policial e rivais de olho em você.`,t>=5?2:1,`greed-${t}`,{label:'Ver Firma',tab:'fac'});
      }
      if(t>=2 && Math.random()<this.betrayalChance(f,t)*step) this.betray(f,t);
    }
    // Alianças esfriam com quem fica rico demais (só afeta o jogador).
    this.allyClock-=step;
    if(this.allyClock<=0){
      this.allyClock=12;
      const t=this.tier(0);
      if(t>=3) for(const o of World.fac){
        if(o.id===0||!o.alive||World.relation(0,o.id)!=='aliada') continue;
        if(Math.random()<0.06*(t-2)){
          World.setRelation(0,o.id,'neutra');
          UI.log(`${o.short} rompeu a aliança: acha sua fortuna grande demais para dividir a mesa.`,'hit');
          if(typeof Notifications!=='undefined') Notifications.push('agreement','Aliança rompida',`${o.short} rompeu a aliança com você. Quanto mais rico, menos gente confia em dividir a mesa.`,1,`ally-break-${o.id}-${Math.floor(World.h)}`,{label:'Ver Firma',tab:'fac'});
        }
      }
    }
  }
};

/* =============================== Succession ============================= */
/* O mundo se renova: firmas que perdem tudo — ou que ficam presas no vermelho
   com um único território por ~36 h — saem de cena, e algumas horas depois uma
   firma NOVA (nome, cor, arquétipo e localização próprios) assume a vaga.
   Assim nunca sobra um mapa vazio nem a mesma disputa de sempre. Entrantes
   nascem num território neutro longe dos demais e recebem um empurrão
   proporcional à fortuna do líder (para seguirem relevantes contra quem já
   está muito rico). */
const Succession={
  PREFIX:['Coletivo','Grupo','Comissão','Núcleo','Aliança','Liga','Sociedade','Frente'],
  PALETTE:['#3fbf8f','#e07bb5','#e0913f','#4fc3d9','#b6d94a','#c96f6f','#7d8be0','#d9c34a','#5fd0a8'],
  WEAK_HOURS:36,
  /* Uma firma acabou: remove tudo que era dela e agenda a vaga. */
  bury(f){
    if(f.buried||f.id===0) return; f.buried=true;
    const id=f.id;
    for(const tr of World.trades.slice()) if(tr.seller===id||tr.buyer===id) Econ.cancelTrade(tr);
    for(let i=World.units.length-1;i>=0;i--) if(World.units[i].f===id) World.units.splice(i,1);
    for(let i=World.veh.length-1;i>=0;i--) if(World.veh[i].f===id) World.veh.splice(i,1);
    for(let i=World.ops.length-1;i>=0;i--) if(World.ops[i].f===id) World.ops.splice(i,1);
    for(const l of World.loans) if(l.status==='active'&&(l.lender===id||l.borrower===id)) l.status=(l.borrower===id)?'default':'paid';
    for(const r of World.coordination.requests) if((r.from===id||r.to===id)&&r.state==='pendente') r.state='expirada';
    World.purchaseOffers=World.purchaseOffers.filter(o=>o.fid!==id);
    if(typeof Police!=='undefined'){ Police.cds[id]=0; Police.bribeCount[id]=0; }
    AI.retire(id);
    World.vacancies.push({id,at:World.h+18+Math.random()*22});
    if(typeof Notifications!=='undefined') Notifications.push('territory','Firma fora do jogo',`${f.short} saiu de cena. Uma nova firma deve ocupar a vaga em breve.`,0,`bury-${id}-${Math.floor(World.h)}`);
  },
  /* Desistência: solta o último território e sai. */
  withdraw(f){
    for(const t of World.owned(f.id)){ t.owner=null; t.inf[f.id]=0; }
    f.alive=false;
    UI.log(`<b>${f.short}</b> desistiu — sem caixa e sem território, deixou a península.`);
    this.bury(f);
  },
  pickHome(){
    const occupied=World.terr.filter(t=>t.owner!==null);
    const cand=World.terr.filter(t=>t.owner===null&&!t.island);
    if(!cand.length) return null;
    const score=t=>{
      let md=Infinity; for(const o of occupied) md=Math.min(md,World.dist(t.id,o.id));
      if(md===Infinity) md=500;
      return md+t.val*25+(t.type==='porto'?90:t.type==='boca'?40:0)+Math.random()*30;
    };
    cand.sort((a,b)=>score(b)-score(a));
    const top=cand.slice(0,3); return top[Math.floor(Math.random()*top.length)];
  },
  enter(id){
    const old=World.fac[id]; if(!old||old.alive) return true;
    const home=this.pickHome(); if(!home) return false;
    const alive=World.fac.filter(x=>x.alive&&x.id!==id);
    let short=home.name; if(alive.some(o=>o.short===short)) short+=' Nova';
    const usedColors=new Set(World.fac.filter(x=>x.alive).map(x=>x.color.toLowerCase()));
    const free=this.PALETTE.filter(c=>!usedColors.has(c.toLowerCase()));
    const color=(free.length?free:this.PALETTE)[Math.floor(Math.random()*(free.length||this.PALETTE.length))];
    const prefix=this.PREFIX[Math.floor(Math.random()*this.PREFIX.length)];
    const leaderW=Math.max(0,...World.fac.filter(x=>x.alive).map(x=>Greed.wealth(x.id)));
    const money=9000+Math.min(60000,Math.round(leaderW*0.05));
    const bonusGuards=Math.max(0,Math.min(3,Math.floor((Greed.tierOf(leaderW)-2)/2)));
    const fac={id,name:`${prefix} de ${home.name}`,short,color,human:false,home:home.id,money,heat:0,alive:true,hold:0,
      lastOp:-200,drivers:0,admins:2,credit:0,reputation:50,patrimony:0,enteredH:World.h};
    World.fac[id]=fac;
    home.owner=id; home.inf[id]=80; home.unrest=0; home.buildings.ponto=true; home.buildings.deposito=true;
    home.stock.fuel+=320; home.stock.ammo+=90; home.stock.insumo+=120; home.stock.quimico+=40;
    World.spawnUnit(id,'vapor',home.id); World.spawnUnit(id,'vapor',home.id); World.spawnUnit(id,'seguranca',home.id);
    for(let i=0;i<bonusGuards;i++) World.spawnUnit(id,'seguranca',home.id);
    World.spawnVeh(id,'van',home.id);
    fac.drivers=World.veh.filter(v=>v.f===id).length;
    fac.patrimony=World.veh.filter(v=>v.f===id).reduce((a,v)=>a+VEHICLES[v.kind].cost,0);
    for(const o of World.fac) if(o.id!==id) World.setRelation(id,o.id,'neutra');
    AI.enterFaction(id);
    World.greed[id]={f:0,t:0};
    UI.log(`🆕 <b>${fac.name}</b> se estabeleceu em <b>${home.name}</b>.`);
    if(typeof Notifications!=='undefined') Notifications.push('territory','Nova firma na península',`${fac.name} se estabeleceu em ${home.name}. É uma rival nova, com temperamento desconhecido.`,1,`enter-${id}-${Math.floor(World.h)}`,{label:'Ver território',tab:'terr',tid:home.id});
    return true;
  },
  tick(dh){
    for(const f of World.fac){
      if(f.id===0||!f.alive) continue;
      const weak=World.owned(f.id).length<=1 && f.money<0;
      f.weakH=weak?(f.weakH||0)+dh:0;
      if(f.weakH>=this.WEAK_HOURS) this.withdraw(f);
    }
    for(let i=World.vacancies.length-1;i>=0;i--){
      const v=World.vacancies[i];
      if(World.h<v.at) continue;
      if(this.enter(v.id)) World.vacancies.splice(i,1); else v.at=World.h+2;   // sem território livre: tenta de novo
    }
  }
};

/* ================================ Rules ================================= */
const Rules = {
  tick(dh){
    if(World.over) return;
    for(const f of World.fac){
      const n=World.owned(f.id).length;
      if(n===0&&f.alive){
        f.alive=false;
        UI.log(`<b>${f.short}</b> deixou de existir como firma.`, f.id===0?'hit':'win');
        if(f.id!==0) Succession.bury(f);
      } else if(n>0&&!f.alive&&f.id===0) f.alive=true;
    }
    Scarcity.tick(dh); Greed.tick(dh); Succession.tick(dh);
    // Queda do jogador: sem território e sem pessoal, na hora; sem território
    // mas com pessoal, após 8 h de carência (não dá para "viver" só de unidades).
    const me=World.fac[0];
    if(World.owned(0).length===0){
      me.zeroH=(me.zeroH||0)+dh;
      if(!World.units.some(u=>u.f===0) || me.zeroH>=8) UI.end(false,null);
    } else me.zeroH=0;
  },
  collapse(){}
};
Econ.collapse=function(f){
  if(!f.alive) return;
  f.lastCollapseH=World.h;
  const t=World.owned(f.id).sort((a,b)=>a.val-b.val)[0];
  // O alívio de caixa escala com o tamanho do buraco (até um teto) em vez de
  // um valor fixo de $2500 — um rombo grande não era resolvido por um valor
  // fixo pequeno, o que (combinado com a falta de cooldown) alimentava a
  // cascata do bug original. Ainda é uma solução dolorosa, só não instantânea.
  const relief=Math.min(6000,Math.max(2500,-f.money*0.6));
  if(t){ t.owner=null; t.inf[f.id]=0; f.money+=relief;
    if(f.id===0) World.chron(`Sem caixa para o custeio: ${t.name} foi abandonado.`);
    UI.log(`${f.short} não sustentou o custeio e abandonou <b>${t.name}</b> (+${money(relief)} de caixa emergencial).`, f.id===0?'hit':null); }
  else { f.money+=relief; } // sem território pra abandonar: só o alívio de caixa mesmo
};

