/* ============================== Ops / Conflito ========================== */
/* Nenhum ataque improvisado: reunir pessoal, munição, preparar por horas,
   marchar e, depois, conviver com a desordem e a recuperação.

   LOTE 3 — integração com personagens individuais (01b_personnel.js):
   uma operação sempre foi uma lista de IDs de unidades (op.units já
   existia); o que faltava era 1) permitir ao chamador ESCOLHER quais
   personagens entram (em vez de sempre pegar os N primeiros ociosos),
   2) fazer a COMPOSIÇÃO da equipe (experiência, liderança, moral,
   lealdade, personalidade, equipamento) importar de verdade no resultado,
   e 3) devolver experiência/moral/lealdade aos personagens quando a
   operação tem sucesso ou fracassa, em vez de só a manutenção passiva de
   Personnel.tick.

   Compatibilidade: quote()/plan() continuam aceitando a assinatura antiga
   (fid, fromId, toId, count) — quem já chama assim continua funcionando
   exatamente como antes, só que agora com prep/combate modulados pela
   composição escolhida automaticamente. Um 5º parâmetro opcional
   (unitIds) permite a um chamador (UI) escolher os personagens específicos
   que compõem a operação. Nenhum personagem, inventário ou equipamento é
   duplicado aqui — tudo é lido ao vivo de World.units/World.items via
   Personnel, a única fonte de verdade. */
const Ops = {
  PREP_HOURS: 14,
  AMMO_PER: 9,
  FUEL_PER: 3,
  // Rank mínimo (na trilha de 'seguranca') para contar como "líder" capaz
  // de coordenar uma equipe — ver _metrics().
  LEADER_RANK_MIN: 1,

  /* Personagens elegíveis para compor uma operação partindo de um
     território — usado por UI para montar a tela de seleção. Devolve a
     projeção serializável de cada um (Personnel.summary), nunca os
     objetos crus de World.units. */
  roster(fid, fromId){
    return World.at(fromId, fid, 'seguranca').map(u=>Personnel.summary(u));
  },

  /* Métricas agregadas de uma composição de personagens (já resolvidos
     como objetos de World.units, não IDs). Isso é o que faz "10
     operadores" deixar de ser um número só: a mesma contagem de pessoas
     produz cohesion/prepFactor diferentes dependendo de QUEM está nela. */
  _metrics(units){
    if(!units.length) return {avgExp:0,avgMorale:0,avgLoyalty:0,avgDiscipline:0,avgEquipCond:100,hasLeader:false,cohesion:1,prepFactor:1,roster:[]};
    const n=units.length;
    let expSum=0,moraleSum=0,loyaltySum=0,discSum=0,condSum=0,condCount=0,personaSyn=0;
    for(const u of units){
      expSum+=u.exp||0; moraleSum+=(u.morale??80); loyaltySum+=(u.loyalty??60);
      discSum+=u.traits?.disciplina??0.5;
      for(const itemId of (u.inventory||[])){
        const item=World.items?.find(i=>i.id===itemId);
        if(item){ condSum+=item.condition; condCount++; }
      }
      // Personalidade não é só flavor de texto: disciplinado/leal ajudam a
      // equipe a operar coordenada, oportunista puxa para baixo — pequeno
      // e limitado (personaNorm é limitado a [-1,1] mais abaixo).
      if(u.personality==='disciplinado'||u.personality==='leal') personaSyn+=1;
      else if(u.personality==='oportunista') personaSyn-=1;
    }
    const avgExp=expSum/n, avgMorale=moraleSum/n, avgLoyalty=loyaltySum/n, avgDiscipline=discSum/n;
    const avgEquipCond=condCount?condSum/condCount:100;
    const hasLeader=units.some(u=>(u.rank||0)>=this.LEADER_RANK_MIN);
    const expNorm=Math.min(1,avgExp/150), moraleNorm=avgMorale/100, loyaltyNorm=avgLoyalty/100, condNorm=avgEquipCond/100;
    const personaNorm=Math.max(-1,Math.min(1,personaSyn/n));
    // cohesion: multiplicador de poder de combate aplicado a QUEM está na
    // mesma operação (ver combat()) — teto/piso apertados de propósito
    // (0.75x–1.35x) para nunca substituir os atributos individuais já
    // computados por Personnel.stat, só modulá-los.
    let cohesion=1+0.15*(moraleNorm-0.5)+0.15*(loyaltyNorm-0.5)+0.10*expNorm+(hasLeader?0.08:0)+0.05*personaNorm+0.08*(condNorm-0.5);
    cohesion=Math.max(0.75,Math.min(1.35,cohesion));
    // prepFactor: multiplicador sobre PREP_HOURS — equipe experiente/
    // liderada/disciplinada prepara mais rápido; moral baixa atrasa.
    let prepFactor=1-0.15*expNorm-(hasLeader?0.10:0)-0.05*(avgDiscipline-0.5)+0.10*(1-moraleNorm);
    prepFactor=Math.max(0.7,Math.min(1.3,prepFactor));
    return {avgExp,avgMorale,avgLoyalty,avgDiscipline,avgEquipCond,hasLeader,cohesion,prepFactor,
      roster:units.map(u=>Personnel.summary(u))};
  },

  /** Só calcula requisitos e viabilidade — não gasta nada. Usado pela UI
   *  para exibir a ordem antes do jogador confirmar.
   *  unitIds (opcional): IDs específicos de World.units a compor a
   *  operação. Se omitido, mantém o comportamento antigo (primeiros N
   *  ociosos disponíveis), com `count` ainda obrigatório nesse caso. */
  quote(fid, fromId, toId, count, unitIds){
    const from=World.ix[fromId], to=World.ix[toId];
    const q={from:fromId,to:toId,count,ammo:(count||0)*this.AMMO_PER,fuel:(count||0)*this.FUEL_PER,
      hops:null,ok:true,reason:null,
      target:{owner:to.owner,name:to.name,defenders:World.units.filter(u=>u.loc===toId&&u.f!==fid&&u.kind==='seguranca').length,
        unrest:Math.round(to.unrest),infra:to.infra,defBonus:World.defBonus(to)}};
    if(!from||from.owner!==fid){ q.ok=false; q.reason='A concentração precisa partir de um território seu.'; return q; }
    if(!from.neighbors.includes(toId)){ q.ok=false; q.reason='Só é possível operar sobre um território vizinho.'; return q; }
    q.hops=1;
    if(to.island && !World.veh.some(v=>v.f===fid&&VEHICLES[v.kind].sea)){ q.ok=false; q.reason='Alcançar a ilha exige uma lancha da firma.'; return q; }

    const availUnits=World.at(fromId,fid,'seguranca');
    q.availPersonnel=availUnits.length;

    let chosen;
    if(unitIds && unitIds.length){
      chosen=unitIds.map(id=>World.units.find(u=>u.id===id)).filter(Boolean);
      if(chosen.length!==unitIds.length){ q.ok=false; q.reason='Um ou mais personagens selecionados não foram encontrados.'; return q; }
      for(const u of chosen){
        if(u.f!==fid||u.kind!=='seguranca'||u.state!=='idle'||u.loc!==fromId){
          q.ok=false; q.reason=`${u.name||'Operador'} não está disponível no território de partida.`; return q;
        }
      }
      count=chosen.length;
      q.count=count; q.ammo=count*this.AMMO_PER; q.fuel=count*this.FUEL_PER;
    }else{
      if(availUnits.length<count||count<1){ q.ok=false; q.reason='Pessoal insuficiente no território de partida.'; return q; }
      chosen=availUnits.slice(0,count);
    }

    if(from.stock.ammo<q.ammo){ q.ok=false; q.reason=`Faltam ${Math.ceil(q.ammo-from.stock.ammo)} de munição no estoque local.`; return q; }
    if(from.stock.fuel<q.fuel){ q.ok=false; q.reason=`Faltam ${Math.ceil(q.fuel-from.stock.fuel)} de combustível no estoque local.`; return q; }

    // Composição real — quem são, atributos efetivos, equipamento; usado
    // pela UI para prever o resultado ANTES de confirmar, e reaproveitado
    // por plan() para não recalcular tudo duas vezes de formas diferentes.
    q.composition=this._metrics(chosen);
    q.unitIds=chosen.map(u=>u.id);
    return q;
  },

  /** unitIds (opcional): mesmo contrato de quote(). Sem unitIds, se
   *  comporta exatamente como antes (primeiros N ociosos). */
  plan(fid, fromId, toId, count, unitIds){
    const q=this.quote(fid,fromId,toId,count,unitIds);
    if(!q.ok) return q.reason;
    const from=World.ix[fromId];
    const chosen=q.unitIds.map(id=>World.units.find(u=>u.id===id));
    from.stock.ammo-=q.ammo; from.stock.fuel-=q.fuel;
    const op={id:World.uid++,f:fid,from:fromId,to:toId,prep:0,
      // need agora é modulado pela composição: equipe experiente/liderada
      // prepara mais rápido, moral baixa atrasa (ver _metrics).
      need:this.PREP_HOURS*(q.composition?.prepFactor||1),
      units:[],ammo:q.ammo,fuel:q.fuel,
      state:'prep',startH:World.h,targetSnapshot:q.target,
      // cohesion é lido por combat() para modular o poder de fogo de quem
      // está nesta operação (ver combat()). composition é um SNAPSHOT do
      // início (para histórico/debrief) — os dados ao vivo continuam
      // acessíveis via Ops.composition(op) a qualquer momento.
      cohesion:q.composition?.cohesion||1,
      composition:q.composition?.roster||[],
      resolved:false};
    for(const u of chosen){ u.state='prep'; u.op=op.id; u.ammo=this.AMMO_PER; op.units.push(u.id); }
    World.ops.push(op);
    World.fac[fid].heat=Math.min(CONF.heatMax, World.fac[fid].heat+4);
    return null;
  },

  /* Composição AO VIVO de uma operação em andamento (não o snapshot do
     início) — para telas que queiram mostrar o estado atual dos
     personagens (feridos, moral atualizada, etc). */
  composition(op){
    return op.units.map(id=>{ const u=World.units.find(x=>x.id===id); return u?Personnel.summary(u):null; }).filter(Boolean);
  },

  cancel(op){
    const from=World.ix[op.from];
    for(const id of op.units){ const u=World.units.find(x=>x.id===id); if(u){u.state='idle';u.op=null;from.stock.ammo+=u.ammo;u.ammo=0;} }
    if(from.owner===op.f){ from.stock.fuel+=op.fuel||0; }
    World.ops.splice(World.ops.indexOf(op),1);
  },

  /* Consequência de sucesso: quando o território-alvo passa a pertencer à
     facção da operação enquanto ela está 'ativa' (a mudança de dono em si
     é decidida por Influence, não por Ops — aqui só reagimos a ela uma
     única vez por operação). Experiência/moral/lealdade vão para quem de
     fato participou e sobreviveu — persistido nos próprios World.units,
     sem estrutura paralela. */
  resolveSuccess(op, alive){
    op.resolved=true;
    for(const u of alive){
      u.exp=(u.exp||0)+18;
      u.morale=Math.min(100,(u.morale||80)+8);
      u.loyalty=Math.min(100,(u.loyalty||60)+4);
    }
    if(op.f===0) UI.log(`Operação sobre <b>${World.ix[op.to].name}</b> concluída — equipe ganhou experiência de campo.`,'win');
  },

  tick(dh){
    for(let i=World.ops.length-1;i>=0;i--){
      const op=World.ops[i];
      const alive=op.units.map(id=>World.units.find(u=>u.id===id)).filter(Boolean);
      if(!alive.length){
        if(op.f===0 && op.state!=='prep' && !op.resolved) UI.log(`Operação sobre <b>${World.ix[op.to]?.name||op.to}</b> fracassou — nenhum operador sobreviveu.`,'hit');
        World.ops.splice(i,1); continue;
      }
      if(op.state==='prep'){
        op.prep+=dh;
        if(op.prep>=op.need){
          op.state='marcha';
          for(const u of alive){ u.state='moving'; u.path=[op.to]; u.roadPoints=null; u.roadIndex=0; }
          if(op.f===0) UI.log(`Operação sobre <b>${World.ix[op.to].name}</b> em marcha.`);
          else if(World.ix[op.to].owner===0) UI.log(`<b>${World.fac[op.f].short}</b> avança sobre ${World.ix[op.to].name}.`,'hit');
        }
      }else if(op.state==='marcha'){
        if(alive.every(u=>u.loc===op.to&&u.path.length===0)){
          op.state='ativa'; for(const u of alive) u.state='idle';
        }
      }else{
        const to=World.ix[op.to];
        if(!op.resolved && to.owner===op.f) this.resolveSuccess(op, alive);
        if(!alive.some(u=>u.loc===op.to)) World.ops.splice(i,1);
      }
    }
    // Marcha terrestre: a rota COMPLETA até o destino é planejada uma vez pelo
    // RoadNet (A*, só terra) e percorrida até o fim. `loc` só muda na chegada.
    // Sem fallback em linha reta e sem replanejamento a cada território.
    for(const u of World.units){
      if(u.state!=='moving'||!u.path.length) continue;
      const U_=UNITS[u.kind], dest=u.path[u.path.length-1];
      if(!u.roadPoints || !u.roadPoints.length){
        const rp=RoadNet.routeFromPoint(u.x,u.y,dest,u.f);
        if(!rp || rp.length<2){
          u.state='idle';u.path=[];u.roadPoints=null;u.roadIndex=0;
          u.note='rota terrestre indisponível';
          UI.log(`<b>${U_.name}</b> não encontrou uma rota terrestre válida e permaneceu em terra.`,'hit');
          continue;
        }
        u.roadPoints=rp;u.roadIndex=1;
      }
      RoadNet.follow(u,(typeof Personnel!=='undefined'?Personnel.stat(u,'speed'):U_.speed)*dh);
      if(u.roadIndex>=u.roadPoints.length){
        u.loc=dest;u.path=[];u.roadPoints=null;u.roadIndex=0;u.state='idle';
      }
    }
    this.combat(dh);
  },
  combat(dh){
    const byT={};
    for(const u of World.units){
      if(u.loc===null||u.state==='prep') continue;
      // Combate era agrupado por u.loc, que só é atualizado quando a unidade
      // CHEGA ao destino (Ops.tick) — enquanto 'moving', u.loc ainda apontava
      // pro território de origem mesmo com o ícone já no meio da estrada
      // (u.x,u.y), podendo brigar num lugar que o jogador já não vê a
      // unidade. Agora, em trânsito, o combate usa a posição real na malha.
      const locId = u.state==='moving' ? (RoadNet.terrAt(u.x,u.y)||u.loc) : u.loc;
      (byT[locId]=byT[locId]||[]).push(u);
    }
    for(const tid in byT){
      const t=World.ix[tid], here=byT[tid], sides={};
      for(const u of here) (sides[u.f]=sides[u.f]||[]).push(u);
      const ids=Object.keys(sides).map(Number).filter(f=>sides[f].some(u=>UNITS[u.kind].atk>4||f===-1));
      const all=Object.keys(sides).map(Number);
      if(all.length<2||ids.length<1) continue;
      t.fighting=1.2; t.unrest=Math.min(100,t.unrest+22*dh);
      for(const a of all){
        const foes=all.filter(x=>x!==a); if(!foes.length) continue;
        const target=foes[0], pool=sides[target];
        let power=0;
        for(const u of sides[a]){
          let p=(typeof Personnel!=='undefined'?Personnel.stat(u,'atk'):UNITS[u.kind].atk);
          // Composição real da equipe: se esta unidade pertence a uma
          // operação ativa/em marcha, o cohesion daquela composição
          // (calculado por _metrics — moral, lealdade, experiência,
          // liderança, personalidade, condição do equipamento do GRUPO)
          // modula o poder de fogo individual, além do que Personnel.stat
          // já dá por personagem. Isso é o que faz a mesma contagem de
          // gente produzir resultados diferentes conforme QUEM compõe.
          if(u.op!=null){
            const op=World.ops.find(o=>o.id===u.op);
            if(op && (op.state==='marcha'||op.state==='ativa') && op.cohesion) p*=op.cohesion;
          }
          if(u.f>=0){
            if(u.ammo>0){ u.ammo=Math.max(0,u.ammo-1.1*dh); }
            else if(t.owner===u.f && t.stock.ammo>0){ t.stock.ammo=Math.max(0,t.stock.ammo-1.1*dh); }
            else p*=0.3;
          }
          power+=p;
        }
        // def do território (construções/influência/guarnição ociosa) MAIS
        // o def médio das próprias unidades que estão sob ataque agora — uma
        // Contenção (def alto) sofre proporcionalmente menos dano que um
        // Vapor (def baixo) na mesma briga, e isso valia só passivamente
        // (fora de combate) antes desta mudança.
        const unitDef=pool.length?pool.reduce((s,v)=>s+(typeof Personnel!=='undefined'?Personnel.stat(v,'def'):(UNITS[v.kind]?.def||0)),0)/pool.length:0;
        const def = ((t.owner===target)?(1+World.defBonus(t)):1)*(1+unitDef);
        let dmg=power*dh*10/def;
        while(dmg>0&&pool.length){
          const v=pool[0], take=Math.min(dmg,v.hp); v.hp-=take; dmg-=take;
          if(v.hp<=0){ pool.shift(); this.kill(v,t); }
          else if((v.maxhp||0)>0 && v.hp<v.maxhp*0.35 && v.status!=='ferido'){
            // Ferimento: estado já previsto e lido por Personnel.stat (penaliza
            // atributos efetivos) e recuperado passivamente em Personnel.tick
            // quando o personagem volta a ficar ocioso — nenhum estado novo.
            v.status='ferido';
            if(v.f===0) UI.log(`<b>${v.name||UNITS[v.kind]?.name}</b> foi ferido em combate.`,'hit');
          }
        }
        if(a>=0) World.fac[a].heat=Math.min(CONF.heatMax, World.fac[a].heat+2.2*dh);
      }
      // consequência: quem ficou sozinho no território rival derruba a influência
      const survivors=all.filter(f=>sides[f].length>0);
      if(survivors.length===1 && survivors[0]>=0 && survivors[0]!==t.owner && t.owner!==null){
        t.inf[t.owner]=Math.max(0,t.inf[t.owner]-14*dh);
      }
    }
  },
  kill(u,t){
    // Equipamento não desaparece com o personagem: cai fisicamente no campo
    // de batalha (mesmo território), disponível para ser recuperado depois
    // — combate é justamente uma das formas reais de "perder item" descritas
    // no sistema de Personnel, sem virar destruição mágica de patrimônio.
    if(typeof Personnel!=='undefined'){
      for(const itemId of [...(u.inventory||[])]) Personnel.unequip(u,itemId);
    }
    const i=World.units.indexOf(u); if(i>=0) World.units.splice(i,1);
    if(u.f===0) UI.log(`${u.name?`${u.name} (${UNITS[u.kind].name})`:UNITS[u.kind].name} perdido em ${t.name}.`,'hit');
    if(u.f>=0) World.fac[u.f].heat=Math.min(CONF.heatMax,World.fac[u.f].heat+1.5);
  }
};
