/* ================================== AI ================================== */
/* IA orientada por objetivos e estado do mundo.
   Camada única de decisão: AI.think() analisa o estado da facção, gera
   candidatos de objetivo, pontua cada um (necessidade + oportunidade +
   personalidade - distância - risco - repetição) e escolhe o melhor.
   O objetivo escolhido vira um plano de poucos passos, executado ao longo
   de várias horas de jogo — a IA não replaneja a cada frame. A escolha de
   DESTINO cabe à IA; a navegação real (DESTINO → ROTA → MOVIMENTO) continua
   inteiramente a cargo do RoadNet/Logi/Ops já existentes.

   LOTE 4 — a arquitetura PERCEPÇÃO → NECESSIDADES → PRIORIDADES → OBJETIVO →
   PLANO → EXECUÇÃO → RESULTADO → MEMÓRIA → REAVALIAÇÃO já existia de forma
   implícita neste arquivo (perceive() abaixo só nomeia e estrutura o que os
   gen*Goals já liam de World); o que este lote acrescenta de fato é:
     • perceive()/pickPersonnel()/pickTopN() — leitura estruturada da firma e
       seleção PONDERADA de personagens (nunca "o primeiro disponível").
     • genStaffGoals() — dois novos tipos de objetivo, EQUIP e REASSIGN,
       tratando gestão de pessoal como necessidade/objetivo/plano de verdade,
       não só manutenção reativa. Ambos passam pelo MESMO cérebro (think/
       execute/goalInvalid/goalOutcome/evolveTraits/memória) que EXPAND,
       CONTEST etc. — nenhum sistema de decisão paralelo.
     • execContest/execExpand/execDefend agora ESCOLHEM quem participa por
       peso (experiência, lealdade, moral, disciplina, personalidade), em vez
       de pegar o primeiro personagem ocioso que bater com a rota.
     • background() passa a considerar desempenho e personalidade, não só
       lealdade bruta, ao decidir quem dispensar sob aperto de caixa.
   Promoção de cargo já era automática e por mérito para jogador e IA por
   igual (Personnel.tick → eligiblePromotion/promote) — a IA não precisa
   "decidir" promover; ela só precisa (e já passa a) cuidar de quem chega
   até lá com lealdade/moral/equipamento em ordem. */
const AI = {
  /* ----------------------------- personalidade --------------------------- */
  /* Os valores abaixo são só o PONTO DE PARTIDA de cada facção (um leve
     "temperamento" inicial) — a personalidade de verdade vive em `traits`,
     é sorteada com uma variação aleatória a cada nova partida (ver
     personality()) e MUDA sozinha ao longo do jogo conforme os objetivos da
     IA dão certo ou dão errado (ver evolveTraits/applyTrend). Duas partidas
     nunca produzem exatamente a mesma IA, e a mesma IA se torna mais
     expansionista, mais cautelosa, mais comercial etc. dependendo de como as
     coisas foram indo — nunca um padrão fixo. */
  /* Arquétipos: o temperamento inicial pertence à FIRMA, não à vaga. As três
     firmas originais usam os três primeiros; firmas que entram no lugar de
     uma que caiu (ver Succession) sorteiam qualquer um. O legado entre
     partidas também é guardado por arquétipo. */
  PERSONALITY: {
    manguinhos:   { expansion:0.55, logistics:0.90, economy:0.80, aggression:0.30, riskTolerance:0.35, infrastructure:0.55 }, // logístico, cauteloso
    geriba:       { expansion:0.80, logistics:0.50, economy:0.45, aggression:0.70, riskTolerance:0.65, infrastructure:0.35 }, // expansionista, agressivo
    brava:        { expansion:0.55, logistics:0.55, economy:0.60, aggression:0.55, riskTolerance:0.50, infrastructure:0.65 }, // equilibrado, investidor
    comerciante:  { expansion:0.45, logistics:0.65, economy:0.92, aggression:0.30, riskTolerance:0.45, infrastructure:0.60 }, // vive do Mercado
    militarista:  { expansion:0.70, logistics:0.40, economy:0.40, aggression:0.92, riskTolerance:0.80, infrastructure:0.30 }, // força bruta
    oportunista:  { expansion:0.65, logistics:0.55, economy:0.65, aggression:0.55, riskTolerance:0.85, infrastructure:0.35 }, // arrisca tudo
    metodica:     { expansion:0.40, logistics:0.80, economy:0.65, aggression:0.35, riskTolerance:0.25, infrastructure:0.90 }, // devagar e sólida
  },
  SLOT_ARCH:{1:'manguinhos',2:'geriba',3:'brava'},
  archOf:{},        // vaga → arquétipo (preenchido quando uma firma nova entra)
  archKey(fid){ return this.archOf[fid]||this.SLOT_ARCH[fid]||'brava'; },
  traits:{},        // personalidade DINÂMICA por facção (id → {expansion,logistics,...})
  baseline:{},      // traços no INÍCIO da partida (após variação + legado) — referência de "de costume"
  gameH:0,          // última hora de jogo vista por AI.tick (World.h já foi zerado quando resetAll roda)
  metaCommitted:false,
  clamp01(v){ return Math.max(0.05,Math.min(0.95,v)); },
  personality(fid){
    if(!this.traits[fid]){
      const base=this.PERSONALITY[this.archKey(fid)] || {expansion:.6,logistics:.6,economy:.6,aggression:.5,riskTolerance:.5,infrastructure:.5};
      const out={};
      // Variação inicial de até ±0.14 em cada traço: mesmo arquétipo nunca
      // nasce idêntico duas vezes.
      // Legado: parte do que esta firma aprendeu em partidas anteriores
      // (ver commitMeta) desloca o ponto de partida — a IA "lembra", mas
      // com dose limitada, então continua imprevisível.
      const leg=(this.loadMeta().legacy||{})[this.archKey(fid)]||{};
      for(const k in base) out[k]=this.clamp01(base[k]+(Math.random()*0.28-0.14)+(Number(leg[k])||0));
      this.traits[fid]=out;
      this.baseline[fid]={...out};
    }
    return this.traits[fid];
  },
  /* Ajusta um traço específico após o resultado de um objetivo concreto —
     é aqui que a IA "aprende": sucesso reforça o traço ligado ao tipo de
     objetivo, fracasso o corrói (regressão). */
  evolveTraits(f,m,outcome,type){
    if(outcome==='neutral') return;
    const tr=this.traits[f.id]; if(!tr) return;
    const map={EXPAND:'expansion',CONTEST:'aggression',SUPPLY:'logistics',TRADE:'economy',INVEST:'infrastructure',RECRUIT:'infrastructure',DEFEND:'aggression',REDISTRIBUTE:'logistics',EQUIP:'infrastructure',REASSIGN:'logistics'};
    const key=map[type]; if(!key) return;
    const delta=(outcome==='success'?1:-1)*(0.012+Math.random()*0.01);
    tr[key]=this.clamp01(tr[key]+delta);
    if(type==='CONTEST'||type==='EXPAND'||type==='DEFEND'){
      // Arriscar e dar certo deixa a firma mais disposta a arriscar de novo;
      // arriscar e perder territ��rio/pessoal encolhe essa disposição mais
      // rápido do que o sucesso a alimenta (perder dói mais do que ganhar
      // anima — assimetria proposital, não um ajuste simétrico previsível).
      tr.riskTolerance=this.clamp01(tr.riskTolerance+(outcome==='success'?0.008:-0.016));
    }
    this.logLine(m,`Personalidade: ${key} ${delta>0?'+':''}${delta.toFixed(3)} após ${outcome==='success'?'sucesso':'fracasso'} em ${type}.`);
  },
  /* Tendência de médio prazo (a cada ~24h de jogo): olha se a firma cresceu
     ou encolheu em território e caixa desde a última checagem e empurra a
     personalidade inteira nessa direção — uma firma que vem perdendo
     território fica mais defensiva/comercial e menos disposta a arriscar;
     uma que vem crescendo fica mais expansionista e ousada. */
  applyTrend(f,m){
    if(m.lastTrendH!=null && World.h-m.lastTrendH<24) return;
    const tr=this.traits[f.id];
    const nowTerr=World.owned(f.id).length, nowMoney=f.money;
    if(m.lastTerr!=null && tr){
      const dTerr=nowTerr-m.lastTerr, dMoney=nowMoney-(m.lastMoney??nowMoney);
      if(dTerr>0){ tr.expansion=this.clamp01(tr.expansion+0.012*dTerr); tr.aggression=this.clamp01(tr.aggression+0.006*dTerr); }
      else if(dTerr<0){ tr.expansion=this.clamp01(tr.expansion+0.018*dTerr); tr.riskTolerance=this.clamp01(tr.riskTolerance+0.014*dTerr); tr.infrastructure=this.clamp01(tr.infrastructure-0.01*dTerr); }
      if(dMoney>2500) tr.economy=this.clamp01(tr.economy+0.012);
      else if(dMoney<-2500){ tr.economy=this.clamp01(tr.economy-0.012); tr.logistics=this.clamp01(tr.logistics+0.01); }
      if(dTerr!==0||Math.abs(dMoney)>2500) this.logLine(m,`Balanço 24h: território ${dTerr>=0?'+':''}${dTerr} · caixa ${dMoney>=0?'+':''}${Math.round(dMoney)} → personalidade ajustada.`);
    }
    m.lastTerr=nowTerr; m.lastMoney=nowMoney; m.lastTrendH=World.h;
  },
  /* Reinicia toda a memória/personalidade das IAs — chamado por World.reset()
     para que uma nova partida sorteie temperamentos novos, em vez de herdar
     a personalidade já evoluída (ou regredida) da partida anterior. */
  resetAll(){
    // Recomeçar no meio de uma partida (>= 2 dias de jogo) também conta como
    // experiência acumulada; partidas encerradas já foram registradas por UI.end.
    if(!this.metaCommitted && this.gameH>=48) this.commitMeta(null);
    this.mem={}; this.traits={}; this.baseline={}; this.archOf={}; this.metaCommitted=false; this.gameH=0;
  },

  /* ------------------ meta-progressão entre partidas ---------------------- */
  /* Guarda em localStorage o quanto cada firma DERIVOU do seu temperamento
     base (traço final − traço inicial), retendo só uma fração (70%; 85% para
     quem venceu a partida) e limitando a ±0.18 por traço. Efeito: as rivais
     carregam cicatrizes e hábitos de uma partida para a outra, sem nunca
     virarem um script fixo — a variação aleatória inicial continua valendo. */
  META_KEY:'peninsula_ai_meta_v1',
  meta:null,
  loadMeta(){
    if(this.meta) return this.meta;
    let m=null;
    try{ const raw=localStorage.getItem(this.META_KEY); if(raw) m=JSON.parse(raw); }catch(e){}
    if(!m||typeof m!=='object'||m.v!==1||typeof m.legacy!=='object'||!m.legacy) m={v:1,games:0,playerWins:0,legacy:{},record:{}};
    m.record=m.record||{};
    // Migração: a versão anterior guardava por vaga (1,2,3); agora por arquétipo.
    for(const [slot,key] of Object.entries(this.SLOT_ARCH)){
      if(m.legacy[slot]){ m.legacy[key]=m.legacy[key]||m.legacy[slot]; delete m.legacy[slot]; }
      if(m.record[slot]){ m.record[key]=m.record[key]||m.record[slot]; delete m.record[slot]; }
    }
    this.meta=m; return m;
  },
  saveMeta(){ try{ localStorage.setItem(this.META_KEY,JSON.stringify(this.meta)); }catch(e){} },
  /* Guarda o aprendizado de UMA firma (deriva em relação ao temperamento
     inicial) no legado do seu arquétipo. Usado no fim da partida e quando uma
     firma sai do jogo — assim o que ela aprendeu não morre com ela. */
  bankOne(id,won){
    const tr=this.traits[id], base=this.baseline[id]; if(!tr||!base) return;
    const meta=this.loadMeta(), key=this.archKey(id);
    const prev=meta.legacy[key]||{}, next={}, keep=won?0.85:0.7;
    for(const k in tr){
      const total=(Number(prev[k])||0)+(tr[k]-base[k]);
      next[k]=Math.max(-0.18,Math.min(0.18,total*keep));
    }
    meta.legacy[key]=next;
    const rec=meta.record[key]||(meta.record[key]={games:0,wins:0});
    rec.games++; if(won) rec.wins++;
  },
  commitMeta(winnerId){
    if(this.metaCommitted) return;
    const ids=Object.keys(this.traits); if(!ids.length) return;
    const meta=this.loadMeta();
    for(const id of ids) this.bankOne(+id,+id===winnerId);
    meta.games=(meta.games||0)+1;
    if(winnerId===0) meta.playerWins=(meta.playerWins||0)+1;
    this.metaCommitted=true; this.saveMeta();
  },
  /* Uma firma saiu do jogo: guarda o que aprendeu e apaga sua memória/traços
     para a vaga poder receber uma firma nova. */
  retire(fid){
    this.bankOne(fid,false); this.saveMeta();
    delete this.mem[fid]; delete this.traits[fid]; delete this.baseline[fid]; delete this.archOf[fid];
  },
  /* Uma firma nova assume a vaga com arquétipo sorteado. */
  enterFaction(fid,archKey){
    delete this.mem[fid]; delete this.traits[fid]; delete this.baseline[fid];
    this.archOf[fid]=archKey||Object.keys(this.PERSONALITY)[Math.floor(Math.random()*Object.keys(this.PERSONALITY).length)];
    return this.archOf[fid];
  },
  clearMeta(){ this.meta={v:1,games:0,playerWins:0,legacy:{},record:{}}; this.saveMeta(); },

  /* ------------- o que o jogador PERCEBE da personalidade ---------------- */
  TRAIT_TXT:{
    expansion:['apetite menor por expansão','apetite maior por expansão'],
    aggression:['postura mais contida','postura mais agressiva'],
    logistics:['menos atenção à logística','mais atenção à logística'],
    economy:['foco menor no comércio','foco maior no comércio'],
    infrastructure:['menos investimento em estrutura','mais investimento em estrutura'],
    riskTolerance:['mais cautela','mais disposição a arriscar'],
  },
  // Limiares de VISIBILIDADE (não mexem na evolução em si): a partir de quanto
  // desvio o jogador percebe uma mudança, e a cada quantos pontos de desvio
  // uma nova notificação é emitida. A evolução é lenta (~0.03–0.10 em 60 dias
  // de jogo), então valores maiores tornam o recurso praticamente invisível.
  SHIFT_SHOW:0.03, SHIFT_STEP:0.05, LEGACY_SHOW:0.04,
  PROFILE_TXT:{expansion:'expansionista',aggression:'agressivo',logistics:'logístico',economy:'comercial',infrastructure:'investidor',riskTolerance:'arrojado'},
  describeShift(delta,minAbs){
    let bk=null,bv=0;
    for(const k in this.TRAIT_TXT){ const v=delta[k]||0; if(Math.abs(v)>Math.abs(bv)){ bv=v; bk=k; } }
    if(!bk||Math.abs(bv)<minAbs) return null;
    return this.TRAIT_TXT[bk][bv>0?1:0];
  },
  /* Só devolve algo quando o desvio é grande o bastante para ser "notado" —
     números pequenos ficam invisíveis, como deve ser. */
  perception(fid){
    const tr=this.traits[fid], base=this.baseline[fid];
    const leg=(this.loadMeta().legacy||{})[this.archKey(fid)]||{};
    const out={tendency:null,legacy:this.describeShift(leg,this.LEGACY_SHOW),profile:null};
    if(!tr||!base) return out;
    const d={}; for(const k in tr) d[k]=tr[k]-base[k];
    out.tendency=this.describeShift(d,this.SHIFT_SHOW);
    let pk=null,pv=0.72; for(const k in this.PROFILE_TXT) if(tr[k]>=pv){ pv=tr[k]; pk=k; }
    out.profile=pk?this.PROFILE_TXT[pk]:null;
    return out;
  },
  /* Avisa o jogador (uma vez por degrau de SHIFT_STEP) quando uma rival muda de
     temperamento de forma marcante. */
  announceShifts(f,m){
    if(m.nextAnnounceH!=null && World.h<m.nextAnnounceH) return;
    m.nextAnnounceH=World.h+12;
    const tr=this.traits[f.id], base=this.baseline[f.id]; if(!tr||!base) return;
    m.announced=m.announced||{};
    for(const k in this.TRAIT_TXT){
      const level=Math.trunc((tr[k]-base[k])/this.SHIFT_STEP), prev=m.announced[k]||0;
      if(level===prev) continue;
      m.announced[k]=level;
      const grew=level!==0 && (prev===0 || Math.sign(level)!==Math.sign(prev) || Math.abs(level)>Math.abs(prev));
      if(!grew || typeof Notifications==='undefined') continue;
      const up=level>0, hot=up&&(k==='aggression'||k==='expansion');
      Notifications.push('event',`${f.short} mudou de postura`,`${f.short} parece ter ${this.TRAIT_TXT[k][up?1:0]} que de costume. Acompanhe na aba Firma.`,hot?1:0,`shift-${f.id}-${k}-${level}`);
    }
  },

  /* ------------------------------- memória -------------------------------- */
  mem:{},
  memOf(fid){
    if(!this.mem[fid]) this.mem[fid]={
      state:'IDLE', goal:null, plan:[], planStep:0,
      nextThink:Math.random()*3, lastDecisionH:0,
      recent:[],            // {type,targetId,h} — para penalizar repetição
      lastTargets:[],        // últimos territórios de destino (qualquer tipo)
      log:[],                 // histórico curto legível p/ diagnose
      completedPlans:0, cancelledPlans:0, repeatedActions:0,
      lastRefusalReason:null, lastOpH:-9999,
    };
    return this.mem[fid];
  },
  remember(m,type,targetId){
    const h=World.h;
    m.recent.push({type,targetId,h});
    if(m.recent.length>10) m.recent.shift();
    m.lastTargets.push(targetId);
    if(m.lastTargets.length>6) m.lastTargets.shift();
  },
  recentPenalty(m,type,targetId){
    let pen=0;
    for(const r of m.recent){
      const age=World.h-r.h;
      if(age>60) continue;
      if(r.targetId===targetId && r.type===type) pen+=Math.max(0,50-age*0.7);
      else if(r.targetId===targetId) pen+=Math.max(0,18-age*0.3);
    }
    // A→B→A: se o próprio alvo é o penúltimo destino visitado, penaliza mais.
    const lt=m.lastTargets;
    if(lt.length>=2 && lt[lt.length-2]===targetId) pen+=22;
    return pen;
  },
  logLine(m,txt){ m.log.push(`[h${Math.round(World.h)}] ${txt}`); if(m.log.length>14) m.log.shift(); },

  /* ============================== PERCEPÇÃO ================================ */
  /* LOTE 4 — leitura estruturada do estado da própria organização, na ordem
     PERCEPÇÃO → NECESSIDADES → PRIORIDADES → OBJETIVO → PLANO → EXECUÇÃO →
     RESULTADO → MEMÓRIA → REAVALIAÇÃO que o resto deste arquivo já seguia de
     forma implícita (cada gen*Goals lia World.* diretamente). perceive() não
     substitui os geradores existentes — eles continuam livres para consultar
     World quando precisarem de algo pontual — mas dá a QUALQUER gerador novo
     (como genStaffGoals, abaixo) um retrato único e nomeado do estado da
     facção, em vez de espalhar mais leituras cruas de World pelo arquivo.
     Nada aqui é armazenado como cópia paralela: tudo é lido ao vivo de
     World/Personnel a cada chamada. */
  perceive(f){
    const mine=World.owned(f.id);
    const snap=World.financialSnapshot(f.id);
    const upk=World.upkeep(f.id);
    const myUnits=World.units.filter(u=>u.f===f.id);
    const seg=myUnits.filter(u=>u.kind==='seguranca');
    const vapor=myUnits.filter(u=>u.kind==='vapor');
    const idle=myUnits.filter(u=>u.state==='idle');
    const wounded=myUnits.filter(u=>u.status==='ferido');
    const lowLoyalty=myUnits.filter(u=>(u.loyalty??60)<25);
    const lowMorale=myUnits.filter(u=>(u.morale??80)<35);
    const stockOf=g=>mine.reduce((s,t)=>s+(t.stock[g]||0),0);
    const stock={}; for(const g of GK) stock[g]=stockOf(g);
    const myVeh=World.veh.filter(v=>v.f===f.id);
    return {
      // dinheiro / economia
      money:f.money, income:snap.income, upkeep:upk, net:snap.net, heat:f.heat, reputation:f.reputation,
      // território / infraestrutura / influência
      territories:mine.length,
      avgInfra:mine.length?mine.reduce((s,t)=>s+(t.infra||0),0)/mine.length:0,
      avgUnrest:mine.length?mine.reduce((s,t)=>s+(t.unrest||0),0)/mine.length:0,
      avgInfluence:mine.length?mine.reduce((s,t)=>s+(t.inf[f.id]||0),0)/mine.length:0,
      // estoque / demanda / produção
      stock,
      factories:mine.filter(t=>t.factory&&t.factory.active).length,
      bottlenecks:mine.filter(t=>t.factory&&t.factory.bottleneck).length,
      // segurança / pessoal
      personnelTotal:myUnits.length, guards:seg.length, operators:vapor.length, idle:idle.length,
      wounded:wounded.length, lowLoyalty:lowLoyalty.length, lowMorale:lowMorale.length,
      avgExp:myUnits.length?myUnits.reduce((s,u)=>s+(u.exp||0),0)/myUnits.length:0,
      avgLoyalty:myUnits.length?myUnits.reduce((s,u)=>s+(u.loyalty??60),0)/myUnits.length:0,
      avgMorale:myUnits.length?myUnits.reduce((s,u)=>s+(u.morale??80),0)/myUnits.length:0,
      // veículos / logística
      vehicles:myVeh.length, vehiclesIdle:myVeh.filter(v=>!v.route&&!v.path.length).length,
      vehiclesStranded:myVeh.filter(v=>v.note&&v.note.indexOf('combustível')>=0).length,
    };
  },

  /* Seleção ponderada de personagens — nunca "o primeiro disponível" (ver
     requisito de composição do Lote 3/4). `weights` é um mapa {campo:peso}
     sobre valores normalizados (0..1) lidos ao vivo de Personnel.stat/traits/
     estado — quanto maior a soma ponderada, melhor o encaixe do personagem
     para o papel em questão. Mesma função serve para escolher quem promover
     mentalmente para uma tarefa (expandir, defender, operar, equipar, realocar
     — ver execContest/execExpand/execDefend/genStaffGoals). */
  pickPersonnel(units, weights){
    if(!units || !units.length) return null;
    const score=(u)=>{
      let s=0;
      for(const k in weights){
        let v;
        switch(k){
          case 'exp': v=Math.min(1,(u.exp||0)/200); break;
          case 'loyalty': v=(u.loyalty??60)/100; break;
          case 'morale': v=(u.morale??80)/100; break;
          case 'performance': v=Math.min(1,(u.performance||0)/40); break;
          case 'leadership': v=Math.min(1,(typeof Personnel!=='undefined'?Personnel.leadership(u):0)/2.5); break;
          case 'atk': v=Math.min(1,(typeof Personnel!=='undefined'?Personnel.stat(u,'atk'):0)/12); break;
          case 'def': v=Math.min(1,(typeof Personnel!=='undefined'?Personnel.stat(u,'def'):0)/2); break;
          case 'inf': v=Math.min(1,(typeof Personnel!=='undefined'?Personnel.stat(u,'inf'):0)/2); break;
          case 'discipline': v=u.traits?.disciplina??0.5; break;
          case 'loyaltyPersonality': v=(u.personality==='leal')?1:0; break;
          default: v=0;
        }
        s+=(weights[k]||0)*v;
      }
      return s;
    };
    let best=null,bestS=-Infinity;
    for(const u of units){ const s=score(u); if(s>bestS){ bestS=s; best=u; } }
    return best;
  },
  /* Escolhe os N melhores sem repetir personagem — usado para compor uma
     operação inteira (ver execContest), não só um único escolhido. */
  pickTopN(units, weights, n){
    const pool=units.slice(), chosen=[];
    for(let i=0;i<n && pool.length;i++){
      const best=this.pickPersonnel(pool,weights);
      if(!best) break;
      chosen.push(best); pool.splice(pool.indexOf(best),1);
    }
    return chosen;
  },

  /* ----------------------- verdade única de navegação ---------------------- */
  /* A escolha de DESTINO nunca deve ser aceita sem checar, pelo MESMO
     RoadNet que depois vai mover a unidade de fato, que existe uma ligação
     terrestre real. Isto evita que a IA prometa um objetivo que a malha
     viária não consegue cumprir — a causa raiz de facções "presas". */
  routeExists(fromId,toId,fid){
    if(fromId==null||toId==null||fromId===toId) return fromId===toId;
    return !!World.path(fromId,toId,false,fid);
  },
  diagnoseFail(fromId,toId,fid,ctx){
    const d=World.pathDiagnose(fromId,toId,fid);
    console.log(`[AI][rota] ${ctx}: ${World.ix[fromId]?.name||fromId} → ${World.ix[toId]?.name||toId} — ${d.reason||'motivo desconhecido'}`);
    return d;
  },

  /* --------------------------------- tick --------------------------------- */
  next:{}, // mantido só por compatibilidade de nome, não usado para decisão
  tick(dh){
    this.gameH=World.h;
    for(const f of World.fac){
      if(f.human || !World.owned(f.id).length) continue;
      const m=this.memOf(f.id);

      this.background(f,m,dh);    // suprimento/escoamento passivo, não é "objetivo"
      this.diplomacy(f,dh);       // pedidos pontuais a outras firmas
      this.respondToProposals(f); // decide sobre propostas recebidas (de qualquer firma)

      this.applyTrend(f,m);
      this.announceShifts(f,m);
      this.marketTrade(f,m);      // negocia com o Mercado (compra e venda), como o jogador

      m.nextThink-=dh;
      const invalid=m.goal && this.goalInvalid(f,m);
      if(!m.goal || invalid || m.nextThink<=0){
        if(invalid && m.goal){
          const outcome=this.goalOutcome(f,m.goal);
          m.cancelledPlans++;
          if(outcome==='success') m.completedPlans++;
          this.evolveTraits(f,m,outcome,m.goal.type);
          this.logLine(m,`Objetivo ${outcome==='success'?'concluído':outcome==='failure'?'fracassado':'encerrado'} (${m.goal.type} → ${m.goal.target}): ${this.invalidReason(f,m)}`);
        }
        this.think(f,m);
        m.nextThink=2.5+Math.random()*2.5; // reavalia a cada ~2.5–5h de jogo, ou antes se o objetivo cair
      }
      this.execute(f,m,dh);
    }
  },

  /* ---------------------- manutenção passiva (não-estratégica) ------------ */
  background(f,m,dh){
    const mine=World.owned(f.id);
    const ports=mine.filter(t=>t.type==='porto');
    for(const p of ports){
      // Greve no porto (p.portMult>1): só compra o essencial — o resto espera
      // o preço normalizar (ou vem do Mercado, ver marketTrade).
      // Aviso de escassez (Scarcity): estoca o bem que vai faltar — mais quanto
      // menor a tolerância a risco da firma (cautelosas estocam mais fundo).
      const strike=(p.portMult||1)>1.2, lim0=strike?0.4:1;
      const P0=this.personality(f.id);
      const want=(g,base,minMoney,qty)=>{
        const warn=Scarcity.warning(g);
        const lim=warn?(1.8+(1-P0.riskTolerance)):lim0;
        if(f.money>minMoney*(warn?0.6:1) && p.stock[g]<base*lim) Econ.buy(p,g,warn?qty*2:qty);
      };
      want('insumo',160,6000,60); want('fuel',200,3000,120); want('ammo',120,5000,40); want('armas',40,7000,20);
      // Químico só é comprado sob demanda (fábrica travada) ou como precaução no aviso.
      if(Scarcity.warning('quimico') && f.money>4000 && p.stock.quimico<120) Econ.buy(p,'quimico',50);
    }
    for(const t of mine){
      if(!t.buildings.ponto) continue;
      for(const g of SELLABLE){
        const room=Math.max(0,80-t.pointStock[g]);
        if(room>0.5 && t.stock[g]>1) Econ.distribute(t,g,Math.min(room,t.stock[g]));
      }
      // Precificação da IA: cada facção também tenta lucrar mais quando dá
      // e escoar mais rápido quando precisa — a mesma decisão que o
      // jogador toma manualmente, só que automática e um pouco mais
      // gananciosa quanto maior a personalidade "economy" da facção.
      const P=this.personality(f.id);
      for(const g of SELLABLE){
        const pm=t.priceMult?.[g]||1;
        const stockHigh=t.pointStock[g]>55, stockLow=t.pointStock[g]<12 && (t.demand[g]||0)>0.25;
        if(stockHigh) Econ.setMarkup(t,g,Math.max(0.6,pm-0.04));
        else if(stockLow) Econ.setMarkup(t,g,Math.min(1.25+P.economy*0.4,pm+0.03*(0.6+P.economy)));
      }
    }
    // reabastece veículos parados com pouco combustível
    for(const v of World.veh){
      if(v.f!==f.id||v.route||v.path.length) continue;
      if(v.loc!==null && v.fuel<VEHICLES[v.kind].fuelCap*0.35) Logi.refuel(v,VEHICLES[v.kind].fuelCap-v.fuel);
    }
    // Gestão de pessoal: a IA também administra seu próprio quadro, não só
    // conta cabeças (isso já é o que genRecruitGoals faz). Aqui é manutenção
    // leve, sem precisar virar um objetivo formal: dispensa quem está com
    // lealdade esgotada quando o caixa já não sustenta o custeio (evita ser
    // pega de surpresa por uma deserção justo quando mais precisa de todos),
    // e equipa segurança ociosa quando sobra caixa de verdade — considera
    // dinheiro (upkeep como referência), território (headcount vem de
    // genRecruitGoals) e postura (personalidade: aggression favorece
    // equipar). Throttle próprio para não repetir a decisão a cada 0.05h.
    if(m.nextPersonnelH==null || World.h>=m.nextPersonnelH){
      m.nextPersonnelH=World.h+4+Math.random()*3;
      const upk=World.upkeep(f.id);
      if(f.money<upk*25){
        // Demissão considera lealdade + desempenho + personalidade — não só
        // lealdade bruta: um 'oportunista' de baixo desempenho é o primeiro
        // candidato, um 'leal' de bom desempenho é poupado mesmo com
        // lealdade parecida (requisito de "considerar personalidade").
        const idlePool=World.units.filter(u=>u.f===f.id&&u.state==='idle');
        const worst=idlePool.map(u=>{
          const personaBias=u.personality==='oportunista'?-6:u.personality==='leal'?6:0;
          return {u,score:(u.loyalty??50)+(u.performance||0)*0.5+personaBias};
        }).sort((a,b)=>a.score-b.score)[0];
        if(worst && worst.score<28){
          this.logLine(m,`Pessoal: dispensou ${worst.u.name} (lealdade ${Math.round(worst.u.loyalty)}%, desempenho ${Math.round(worst.u.performance||0)}) para aliviar o custeio.`);
          Personnel.fire(worst.u);
        }
      } else if(f.money>upk*160){
        const P=this.personality(f.id);
        const guard=World.units.find(u=>u.f===f.id&&u.kind==='seguranca'&&u.state==='idle'&&!(u.inventory||[]).some(k=>Personnel.ITEMS[k]?.slot==='colete'));
        if(guard && Math.random()<0.35*P.aggression && !Personnel.equip(guard,'colete')){
          this.logLine(m,`Pessoal: equipou ${guard.name} com colete (caixa confortável).`);
        }
      }
    }
  },

  /* ---------------------------- Mercado (IA) ------------------------------ */
  /* Quanto de cada bem a firma NÃO vende ao Mercado: insumos das suas fábricas
     e o mínimo para operações/logística; bocaria mantém um pouco para a Boca. */
  reserveFor(f,g){
    if(SELLABLE.includes(g)) return 20;
    let r=(g==='fuel'||g==='ammo')?60:0;
    if(Scarcity.state(g)) r+=80;   // aviso ou falta em curso: ninguém vende o que não pode repor
    for(const t of World.owned(f.id)){
      if(!t.factory) continue;
      if((FACTORIES[t.factory.kind].inputs||[]).some(i=>i.good===g)) r+=40;
    }
    return r;
  },
  marketTrade(f,m){
    if(m.nextMarketH!=null && World.h<m.nextMarketH) return;
    m.nextMarketH=World.h+1.5+Math.random()*2;
    const P=this.personality(f.id), upk=World.upkeep(f.id);
    for(const o of PurchaseOffers.available(f.id)){
      if(o.dir==='sell') this.marketBuy(f,m,o,P,upk); else this.marketSell(f,m,o,P,upk);
    }
  },
  /* O Mercado quer COMPRAR da firma. Aceita se sobra estoque além da reserva e
     o preço é bom o bastante — firma apertada de caixa aceita preço pior;
     firma comercial (economy alto) é mais exigente. */
  marketSell(f,m,o,P,upk){
    const elig=PurchaseOffers.eligibleOrigins(o);
    if(!elig.length) return;
    const total=PurchaseOffers.totalAvailable(o);
    if(total-o.qty<this.reserveFor(f,o.good)) return;
    if(o.risk==='alto' && !(f.heat<45 && P.riskTolerance>0.5)) return;
    const ratio=o.unitPrice/PurchaseOffers.refPrice(o.good);
    const poor=f.money<upk*60;
    const floor=poor?0.94:(1.02+(1-P.economy)*0.06);
    if(ratio<floor) return;
    const best=elig.slice().sort((a,b)=>(b.stock[o.good]||0)-(a.stock[o.good]||0))[0];
    const err=PurchaseOffers.accept(o.id,best.id,f.id);
    if(!err) this.logLine(m,`Mercado: vendeu ${o.qty} ${GOODS[o.good].name} a ${Math.round(o.unitPrice)}/un (${poor?'caixa apertado':'preço bom'}).`);
  },
  /* O Mercado quer VENDER à firma. Só compra o que precisa (gargalo de fábrica
     ou estoque abaixo da reserva) e só a um preço razoável — mais tolerante
     quanto mais tempo a fábrica está parada, já que o prejuízo corre. */
  marketBuy(f,m,o,P,upk){
    const dests=PurchaseOffers.sellDestinations(o);
    if(!dests.length) return;
    const total=o.qty*o.unitPrice;
    if(f.money<total+upk*50+500) return;
    const mine=World.owned(f.id);
    const stuck=mine.filter(t=>t.factory&&t.factory.active&&t.factory.bottleneck===o.good);
    const stock=mine.reduce((s,t)=>s+(t.stock[o.good]||0),0);
    const short=stock<this.reserveFor(f,o.good)*0.6;
    if(!stuck.length && !short) return;
    const worst=stuck.reduce((mx,t)=>Math.max(mx,t.factory.stuckSince||0),0);
    let ceiling=1.28+Math.min(0.17,worst*0.01)+P.economy*0.05;
    // Em falta externa o Mercado cobra o preço da escassez (×1.9): só paga quem
    // já está travado (fábrica parada custa mais que o ágio).
    if(Scarcity.active(o.good)) ceiling=stuck.length?2.9:ceiling;
    if(o.unitPrice>GOODS[o.good].buy*ceiling) return;
    const dest=dests.find(t=>stuck.some(x=>x.id===t.id))||dests.slice().sort((a,b)=>(World.cap(b)-World.load(b))-(World.cap(a)-World.load(a)))[0];
    const err=PurchaseOffers.accept(o.id,dest.id,f.id);
    if(!err) this.logLine(m,`Mercado: comprou ${o.qty} ${GOODS[o.good].name} a ${Math.round(o.unitPrice)}/un para ${stuck.length?'destravar fábrica':'repor estoque'}.`);
  },

  diplomacy(f,dh){
    if(World.h<=12 || Math.random()>=0.02*dh) return;
    // Alvo: antes toda proposta ia direto pro jogador (to=0) — as IAs nunca
    // negociavam entre si, então o mundo só parecia vivo perto do jogador.
    // Agora sorteia entre qualquer outra firma que ainda tenha território;
    // o jogador continua pesando mais (curiosidade natural do comércio em
    // torno de quem o jogador é), mas deixa de ser a única ponta possível.
    const others=World.fac.filter(x=>x.id!==f.id && World.owned(x.id).length);
    if(!others.length) return;
    const target=(Math.random()<0.45 && others.some(x=>x.id===0))
      ? World.fac[0]
      : others[Math.floor(Math.random()*others.length)];
    if(World.coordination.requests.some(r=>r.from===f.id&&r.to===target.id&&r.state==='pendente')) return;

    // Reputação de quem propõe pesa no preço oferecido: reputação baixa
    // precisa "adoçar" a proposta pra ser levada a sério — paga mais
    // quando quer comprar, cobra menos quando quer vender.
    const repFactor=(f.reputation-50)/50; // -1 (péssima) .. +1 (ótima)

    // Reserva de caixa que a firma nunca compromete numa proposta de compra —
    // evita que ela se ofereça pra comprar e depois, na hora de a contraparte
    // aceitar, não tenha mais dinheiro (custeio, outra compra, etc. consumiram
    // o caixa nesse meio-tempo). O mesmo buffer usado em respondToProposals.
    const CASH_BUFFER=500;

    if(Math.random()<0.55){
      // Quer COMPRAR algo da outra firma — paga um pouco acima do preço de
      // porto para tornar a proposta atrativa de verdade. Só propõe se
      // sobrar caixa pra pagar pelo menos uma quantidade mínima razoável —
      // antes a proposta saía sem checar isso e travava na hora de aceitar.
      const buyGoods=['insumo','fuel','ammo','armas','quimico'];
      const g=buyGoods[Math.floor(Math.random()*buyGoods.length)];
      let unit=Math.round((GOODS[g].buy||40)*(1.08+Math.random()*0.35));
      unit=Math.max(1,Math.round(unit*(1-repFactor*0.08)));
      const desiredQty=15+Math.floor(Math.random()*46);
      const maxAffordable=Math.floor(Math.max(0,f.money-CASH_BUFFER)/unit);
      const qty=Math.min(desiredQty,maxAffordable);
      if(qty<5) return; // caixa baixo demais pra propor uma compra que valha a pena
      Coord.openRequest(f.id,target.id,'compra',g,qty,unit,'precisamos recompor o abastecimento');
    } else {
      // Está com excedente e OFERECE vender bocaria. A quantidade oferecida
      // agora é limitada ao que existe de fato num único complexo (é de lá
      // que Coord.fulfill tira a carga) — antes só checava ">10 em algum
      // complexo" e depois sorteava uma quantidade sem relação com o estoque
      // real, prometendo mais do que tinha para entregar.
      const mine=World.owned(f.id);
      const sellGoods=SELLABLE.filter(g=>mine.some(t=>(t.stock[g]||0)>10));
      if(!sellGoods.length) return; // sem excedente de verdade agora
      const g=sellGoods[Math.floor(Math.random()*sellGoods.length)];
      const bestStock=Math.max(...mine.map(t=>t.stock[g]||0));
      const qty=Math.min(10+Math.floor(Math.random()*31),Math.floor(bestStock));
      if(qty<5) return;
      let unit=Math.round(GOODS[g].base*(0.72+Math.random()*0.22));
      unit=Math.max(1,Math.round(unit*(1+repFactor*0.06)));
      Coord.openRequest(f.id,target.id,'venda',g,qty,unit,'proposta de fornecimento');
    }
  },

  /* Decide sobre propostas RECEBIDAS por esta firma, venham do jogador ou de
     outra IA. Antes só existia decisão manual (a tela de Coordenação, usada
     pelo jogador) — uma proposta de uma IA para outra IA ficava pendente pra
     sempre, porque ninguém jamais decidia por ela. Heurística simples:
     compara o preço da proposta com uma faixa "justa" em torno do preço de
     porto/base do bem, e aperta essa faixa quando quem propôs tem reputação
     baixa (mais desconfiança de quem historicamente não cumpriu acordos). */
  respondToProposals(f){
    const pend=World.coordination.requests.filter(r=>r.to===f.id&&r.state==='pendente');
    for(const r of pend){
      if(!r.good || !r.unitPrice){ Coord.reject(r.id); continue; } // sem bem/preço, não há o que avaliar
      const sender=World.fac[r.from];
      const distrust=Math.max(0,50-(sender?sender.reputation:50))/50; // 0 (confiável) .. 1 (péssima)
      const base=GOODS[r.good].buy||GOODS[r.good].base||40;
      const buyerId=r.kind==='compra'?r.from:r.to, sellerId=r.kind==='compra'?r.to:r.from;
      if(f.id===buyerId){
        const fair=base*(1.3-distrust*0.25); // reputação baixa do vendedor → teto de preço mais apertado
        if(r.unitPrice<=fair && f.money>=r.qty*r.unitPrice+500) Coord.accept(r.id); else Coord.reject(r.id);
      } else {
        const fair=base*(0.7+distrust*0.15); // reputação baixa do comprador → exige um piso maior
        const hasStock=World.owned(f.id).some(t=>(t.stock[r.good]||0)>=r.qty*0.6);
        if(r.unitPrice>=fair && hasStock) Coord.accept(r.id); else Coord.reject(r.id);
      }
    }
  },

  /* ============================== DECISÃO ================================= */
  think(f,m){
    const cands=[
      ...this.genSupplyGoals(f,m),
      ...this.genSupplyChainGoals(f,m),
      ...this.genRedistributeGoals(f,m),
      ...this.genExpandGoals(f,m),
      ...this.genContestGoals(f,m),
      ...this.genBuildGoals(f,m),
      ...this.genRecruitGoals(f,m),
      ...this.genTradeGoals(f,m),
      ...this.genDefendGoals(f,m),
      ...this.genStaffGoals(f,m),
    ];
    const P=this.personality(f.id);
    const heavyHeat=f.heat>78;
    for(const c of cands){
      let score=c.urgencyBase;
      // personalidade
      if(c.type==='EXPAND') score*=0.6+P.expansion;
      else if(c.type==='CONTEST') score*=0.5+P.aggression;
      else if(c.type==='SUPPLY') score*=0.6+P.logistics;
      else if(c.type==='INVEST') score*=0.6+P.infrastructure;
      else if(c.type==='RECRUIT') score*=0.6+P.aggression*0.5+P.infrastructure*0.5;
      else if(c.type==='TRADE') score*=0.6+P.economy;
      else if(c.type==='DEFEND') score+=P.aggression*8;
      else if(c.type==='REDISTRIBUTE') score*=0.55+P.logistics*0.55+P.infrastructure*0.25;
      else if(c.type==='EQUIP') score*=0.55+P.infrastructure*0.5+P.aggression*0.3;
      else if(c.type==='REASSIGN') score*=0.55+P.logistics*0.5+P.infrastructure*0.2;
      // distância (heurística simples de posicionamento, não é pathfinding)
      const from=c.srcId||f.home;
      if(c.targetId!=null && World.ix[c.targetId] && World.ix[from]){
        const d=World.dist(from,c.targetId);
        score-=Math.min(30,d/45)*(1.15-P.logistics*0.4);
      }
      // repetição recente
      score-=this.recentPenalty(m,c.type,c.targetId);
      // risco/exposição: calor alto penaliza tudo que não seja recuperação
      if(heavyHeat && c.type==='CONTEST') score-=80;
      if(heavyHeat) score-=8;
      c.score=score;
    }
    cands.sort((a,b)=>b.score-a.score);
    const viable=cands.filter(c=>c.score>=18);
    // Escolha PONDERADA entre as melhores opções, não sempre a nota mais
    // alta: quanto maior a riskTolerance da facção, mais ela se permite
    // escolher algo abaixo do "objetivamente melhor" — imprevisível de
    // partida pra partida e de facção pra facção, mas nunca uma escolha
    // ruim, só nem sempre a mesma.
    let best=null;
    if(viable.length){
      const topN=viable.slice(0,Math.min(4,viable.length));
      const temp=Math.max(0.18,0.5*(0.4+P.riskTolerance));
      const weights=topN.map(c=>Math.exp((c.score-topN[0].score)/(20*temp)));
      const sum=weights.reduce((a,b)=>a+b,0);
      let r=Math.random()*sum;
      for(let i=0;i<topN.length;i++){ r-=weights[i]; if(r<=0){ best=topN[i]; break; } }
      if(!best) best=topN[0];
    }

    if(!best){
      // nada urgente nem oportuno o bastante: recupera calor ou espera
      if(f.heat>40){
        m.goal={type:'RECOVER',target:'—',targetId:null,reason:'reduzir exposição antes de agir',priority:0};
        m.state='RECOVERING';
      } else {
        m.goal={type:'WAIT',target:'—',targetId:null,reason:'nenhuma necessidade ou oportunidade relevante',priority:0};
        m.state='IDLE';
      }
      m.plan=[]; m.planStep=0;
      this.logLine(m,`Objetivo: ${m.goal.type} (${m.goal.reason})`);
      return;
    }
    m.goal={type:best.type,target:best.target,targetId:best.targetId,srcId:best.srcId,good:best.good,build:best.build,
      reason:best.reason,priority:Math.round(best.score),startedH:World.h};
    m.state=this.stateFor(best.type);
    m.plan=this.planFor(best.type);
    m.planStep=0;
    this.remember(m,best.type,best.targetId);
    this.logLine(m,`Objetivo: ${best.type} → ${best.target} (${best.reason}) score=${Math.round(best.score)}`);
  },

  stateFor(type){
    return ({SUPPLY:'SUPPLYING',EXPAND:'EXPANDING',CONTEST:'PREPARING_OPERATION',
      INVEST:'BUILDING',RECRUIT:'BUILDING',TRADE:'TRADING',DEFEND:'REINFORCING',
      REDISTRIBUTE:'REORGANIZING',EQUIP:'STAFFING',REASSIGN:'REORGANIZING_STAFF'})[type]||'IDLE';
  },
  planFor(type){
    return ({
      SUPPLY:['buscar carga na origem','carregar veículo','transportar','descarregar no destino','verificar resultado'],
      EXPAND:['deslocar operador','ocupar território neutro','consolidar influência'],
      CONTEST:['posicionar pessoal','preparar munição','aguardar preparo','executar operação','avaliar resultado'],
      INVEST:['encomendar construção/ampliação','aguardar conclusão'],
      RECRUIT:['encomendar recrutamento','aguardar conclusão'],
      TRADE:['negociar carga','transportar','concluir venda'],
      DEFEND:['reposicionar segurança','manter guarda'],
      REDISTRIBUTE:['identificar excedente e carência internos','carregar veículo','transportar entre territórios próprios','reforçar estoque local'],
      EQUIP:['selecionar personagem elegível','obter ou fabricar equipamento','equipar'],
      REASSIGN:['selecionar origem com excedente de guarnição','selecionar personagem','deslocar até o destino carente'],
    })[type]||[];
  },

  /* Um objetivo deixa de ser válido quando o plano terminou ou quando a
     necessidade/oportunidade que o motivou desapareceu. */
  goalInvalid(f,m){
    const g=m.goal; if(!g) return false;
    if(g.type==='WAIT') return World.h-g.startedH>6; // reavalia espera com frequência
    if(g.type==='RECOVER') return f.heat<25 || World.h-g.startedH>20;
    if(g.targetId==null) return World.h-g.startedH>18;
    const t=World.ix[g.targetId];
    if(!t) return true;
    if(g.type==='SUPPLY'){
      const src=g.srcId!=null?World.ix[g.srcId]:null;
      if(src && src.owner!==f.id) return true;
      // Objetivo gerado por genSupplyChainGoals: alvo é uma fábrica travada.
      // Invalida assim que o gargalo desaparecer ou mudar de insumo — não
      // depende de t.demand/t.pointStock, que só existem para bocaria.
      if(t.factory && t.factory.kind && !SELLABLE.includes(g.good))
        return !t.factory.bottleneck || t.factory.bottleneck!==g.good || !src || (src.stock[g.good]||0)<3;
      if(g.good==='insumo') return t.stock.insumo>=55 || !src || src.stock.insumo<5;
      const need=t.demand[g.good]||0; return (t.pointStock[g.good]||0)>=need*8 || (src && (src.stock[g.good]||0)<3);
    }
    if(g.type==='EXPAND') return t.owner!=null;
    if(g.type==='CONTEST') return t.owner===f.id || (World.h-g.startedH>60);
    if(g.type==='INVEST') return t.owner!==f.id || (t.works.length===0 && World.h-g.startedH>2 && this._investDone);
    if(g.type==='RECRUIT') return World.h-g.startedH>60;
    if(g.type==='TRADE') return World.h-g.startedH>40;
    if(g.type==='DEFEND') return t.owner!==f.id || World.h-g.startedH>30;
    if(g.type==='REDISTRIBUTE'){
      const src=g.srcId!=null?World.ix[g.srcId]:null;
      if(!src||src.owner!==f.id||t.owner!==f.id) return true;
      const min=this.REDIST_MIN[g.good]||30;
      return (t.stock[g.good]||0)>=min || (src.stock[g.good]||0)<min*1.15 || World.h-g.startedH>40;
    }
    if(g.type==='EQUIP'){
      const u=World.units.find(x=>x.id===g.unitId);
      if(!u||u.f!==f.id) return true;
      const tpl=Personnel.ITEMS[g.itemKey]; if(!tpl) return true;
      const has=(u.inventory||[]).some(k=>{const item=World.items?.find(i=>i.id===k); return item&&Personnel.ITEMS[item.key]?.slot===tpl.slot;});
      return has || World.h-g.startedH>30;
    }
    if(g.type==='REASSIGN'){
      const u=World.units.find(x=>x.id===g.unitId);
      if(!u||u.f!==f.id) return true;
      return u.loc===g.targetId || World.h-g.startedH>40;
    }
    return World.h-g.startedH>80;
  },
  /* Julga o resultado de um objetivo que está sendo encerrado — é o que
     alimenta evolveTraits(). Aproximação deliberada (não instrumenta cada
     mecânica internamente), mas cobre o que importa: o território mudou de
     dono do jeito certo? A entrega foi concluída? A fábrica destravou? */
  goalOutcome(f,g){
    if(!g||g.targetId==null) return 'neutral';
    const t=World.ix[g.targetId]; if(!t) return 'neutral';
    if(g.type==='EXPAND'||g.type==='CONTEST') return t.owner===f.id?'success':'failure';
    if(g.type==='DEFEND') return t.owner===f.id?'success':'failure';
    if(g.type==='SUPPLY'){
      if(t.factory && t.factory.kind && !SELLABLE.includes(g.good))
        return (!t.factory.bottleneck || t.factory.bottleneck!==g.good) ? 'success':'failure';
      if(g.good==='insumo') return t.stock.insumo>=55 ? 'success':'failure';
      const need=t.demand?.[g.good]||0;
      return (t.pointStock?.[g.good]||0)>=need*6 ? 'success':'failure';
    }
    if(g.type==='TRADE'){
      const ally=World.fac.find(x=>x.short===g.target);
      return (ally && World.trades.some(tr=>tr.seller===f.id&&tr.buyer===ally.id&&tr.status==='delivered'&&tr.createdH>=g.startedH-1)) ? 'success':'failure';
    }
    if(g.type==='INVEST'||g.type==='RECRUIT') return t.works.length===0 ? 'success':'neutral';
    if(g.type==='REDISTRIBUTE'){
      const min=this.REDIST_MIN[g.good]||30;
      return (t.stock?.[g.good]||0)>=min ? 'success':'failure';
    }
    if(g.type==='EQUIP'){
      const u=World.units.find(x=>x.id===g.unitId); if(!u) return 'failure';
      const tpl=Personnel.ITEMS[g.itemKey]; if(!tpl) return 'neutral';
      const has=(u.inventory||[]).some(k=>{const item=World.items?.find(i=>i.id===k); return item&&Personnel.ITEMS[item.key]?.slot===tpl.slot;});
      return has?'success':'failure';
    }
    if(g.type==='REASSIGN'){
      const u=World.units.find(x=>x.id===g.unitId); if(!u) return 'failure';
      return u.loc===g.targetId?'success':'failure';
    }
    return 'neutral';
  },
  invalidReason(f,m){
    const g=m.goal; if(!g) return '—';
    if(g.type==='SUPPLY') return 'destino já abastecido ou origem esgotada';
    if(g.type==='EXPAND') return 'território deixou de estar neutro';
    if(g.type==='CONTEST') return 'alvo não é mais viável ou tempo excedido';
    if(g.type==='RECOVER') return 'exposição normalizada';
    if(g.type==='REDISTRIBUTE') return 'estoque já reorganizado ou origem sem mais excedente';
    if(g.type==='EQUIP') return 'personagem já equipado ou deixou de estar disponível';
    if(g.type==='REASSIGN') return 'personagem já reposicionado ou deixou de estar disponível';
    return 'condição de expiração atingida';
  },

  /* ============================ GERADORES DE OBJETIVOS ===================== */
  genSupplyGoals(f,m){
    const mine=World.owned(f.id), out=[];
    const ports=mine.filter(t=>t.type==='porto');
    for(const t of mine){
      if(t.type==='oficina' && t.stock.insumo<50 && ports.length){
        const src=ports.filter(p=>p.stock.insumo>15).sort((a,b)=>b.stock.insumo-a.stock.insumo)[0];
        if(src) out.push({type:'SUPPLY',targetId:t.id,srcId:src.id,good:'insumo',target:t.name,
          reason:'oficina com insumo baixo',urgencyBase:55+(50-t.stock.insumo)*0.4});
      }
    }
    for(const t of mine){
      if(!t.buildings.ponto) continue;
      for(const g of SELLABLE){
        const need=t.demand[g]||0; if(need<0.35) continue;
        const have=t.pointStock[g]||0;
        if(have<need*8){
          const src=mine.filter(x=>x.id!==t.id&&(x.stock[g]||0)>15).sort((a,b)=>b.stock[g]-a.stock[g])[0];
          if(src) out.push({type:'SUPPLY',targetId:t.id,srcId:src.id,good:g,target:t.name,
            reason:`${GOODS[g].name} escasso frente à demanda`,urgencyBase:30+need*14+(need*8-have)*0.3});
        }
      }
    }
    return out;
  },

  /* Reage ao próprio gargalo de produção: quando uma fábrica da facção está
     travada (t.factory.bottleneck!=null), prioriza levar exatamente o
     insumo em falta até ela — de um porto próprio (se for um bem
     importável, GOODS[good].buy>0) ou de outro território próprio com
     excedente. Energia nunca entra aqui: não é transportável (só pode ser
     usada no próprio território que a produz), então uma fábrica travada
     por falta de energia não tem solução logística — só investimento local. */
  genSupplyChainGoals(f,m){
    const mine=World.owned(f.id), out=[];
    const ports=mine.filter(t=>t.type==='porto');
    for(const t of mine){
      if(!t.factory||!t.factory.active||!t.factory.bottleneck) continue;
      const good=t.factory.bottleneck;
      if(good==='energia') continue; // sem solução logística — precisa de usina no próprio território
      let src=null;
      if(GOODS[good].buy){
        src=ports.filter(p=>p.id!==t.id&&(p.stock[good]||0)>15).sort((a,b)=>b.stock[good]-a.stock[good])[0];
      }
      if(!src) src=mine.filter(x=>x.id!==t.id&&(x.stock[good]||0)>15).sort((a,b)=>b.stock[good]-a.stock[good])[0];
      if(!src) continue;
      if(!this.routeExists(src.id,t.id,f.id)) continue;
      // Urgência cresce com quanto tempo a fábrica está travada e com o
      // custo operacional pago à toa nesse período (aproximação do
      // prejuízo acumulado) — gargalo prolongado deve pesar mais que um
      // travamento momentâneo de 1-2h.
      const stuckH=t.factory.stuckSince||0;
      const lostMoney=(t.factory.lastCost||0)*stuckH;
      out.push({type:'SUPPLY',targetId:t.id,srcId:src.id,good,target:t.name,
        reason:`fábrica travada por falta de ${GOODS[good].name} (${Math.round(stuckH)}h)`,
        urgencyBase:45+Math.min(40,stuckH*1.2)+Math.min(20,lostMoney*0.05)});
    }
    return out;
  },

  /* Patamar saudável de estoque industrial por território — abaixo disso o
     território é considerado "carente" desse bem para fins de redistribuição
     interna (não é o mesmo limiar de gargalo de fábrica, que é reativo a um
     bottleneck já detectado por Prod/FactorySystem). */
  REDIST_MIN:{fuel:60,ammo:40,armas:10,quimico:20,insumo:30},
  /* Reorganização interna de recursos: independe de haver uma fábrica travada
     agora mesmo (isso já é coberto por genSupplyChainGoals). Aqui a IA olha
     o conjunto dos seus territórios como uma rede — um território com
     excedente claro de um bem industrial (muito acima do que ele mesmo
     precisa) e outro território próprio abaixo do patamar saudável desse
     mesmo bem é uma oportunidade (ou necessidade, se o carente estiver perto
     de zero) de mover carga internamente, sem depender de mercado externo ou
     de uma proposta de coordenação. Isso cobre casos como: um Porto com
     muito combustível parado enquanto uma Oficina distante está sem, ou um
     território de fronteira com pouca munição para se defender enquanto
     outro complexo interno está afogado em munição parada. */
  genRedistributeGoals(f,m){
    const mine=World.owned(f.id), out=[];
    if(mine.length<2) return out;
    const P=this.personality(f.id);
    for(const dst of mine){
      // Gargalo de fábrica já tem seu próprio gerador, mais urgente e mais
      // preciso sobre qual origem escolher — evita as duas rotas competirem
      // pelo mesmo veículo com o mesmo bem ao mesmo tempo.
      if(dst.factory && dst.factory.active && dst.factory.bottleneck) continue;
      for(const g in this.REDIST_MIN){
        const min=this.REDIST_MIN[g], have=dst.stock[g]||0;
        if(have>=min) continue;
        const src=mine.filter(x=>x.id!==dst.id && (x.stock[g]||0)>min*2.2)
          .sort((a,b)=>(b.stock[g]||0)-(a.stock[g]||0))[0];
        if(!src) continue;
        if(!this.routeExists(src.id,dst.id,f.id)) continue;
        const shortage=min-have; // 0..min: quanto mais perto de zero, mais urgente
        out.push({type:'REDISTRIBUTE',targetId:dst.id,srcId:src.id,good:g,target:dst.name,
          reason:`${GOODS[g].name} baixo em ${dst.name} (${Math.round(have)}) com excedente em ${src.name}`,
          urgencyBase:10+shortage*0.5+(1-P.riskTolerance)*4});
      }
    }
    return out;
  },

  genExpandGoals(f,m){
    const mine=World.owned(f.id), out=[], seen=new Set();
    const idleOps=World.units.filter(u=>u.f===f.id&&u.kind==='vapor'&&u.state==='idle');
    if(!idleOps.length) return out;
    for(const t of mine) for(const n of t.neighbors){
      if(seen.has(n)) continue; seen.add(n);
      const x=World.ix[n];
      if(x.owner!==null) continue;
      if(World.units.some(u=>u.loc===n&&u.f===f.id)) continue;
      // Vizinhança de polígono não garante ligação terrestre real (ex.: uma
      // baía entre duas pontas de terra). Confere na mesma malha que vai
      // mover a unidade antes de considerar o objetivo.
      const carrier=idleOps.find(u=>this.routeExists(u.loc,n,f.id))||null;
      if(!carrier){ this.diagnoseFail(t.id,n,f.id,'expansão descartada'); continue; }
      out.push({type:'EXPAND',targetId:n,srcId:carrier.loc,target:x.name,
        reason:'território neutro adjacente com valor estratégico',
        urgencyBase:18+x.val*3+x.pop/3000});
    }
    return out;
  },

  genContestGoals(f,m){
    const mine=World.owned(f.id), out=[];
    if(World.h-m.lastOpH<70) return out; // intervalo mínimo entre operações
    if(f.money<3500 || f.heat>65) return out;
    for(const t of mine){
      const myGuards=World.at(t.id,f.id,'seguranca').length;
      if(myGuards<3||t.stock.ammo<45) continue;
      for(const n of t.neighbors){
        const x=World.ix[n];
        if(x.owner===f.id||x.island||x.owner===null) continue;
        const def=World.units.filter(u=>u.loc===n&&u.f!==f.id&&u.kind==='seguranca').length*(1+World.defBonus(x));
        const gain=x.val*2.4+x.pop/5000+(x.type==='porto'?2:0)+(x.type==='boca'?1.6:0);
        // Vácuo de poder (evento de mundo): dono abalado → exige menos força
        // e vale mais a pena agir agora, dentro da janela do evento.
        const vac=(x.vacuoUntil||0)>World.h;
        if(myGuards>=def*(vac?1.1:1.9)+1 && gain>2.2){
          if(!this.routeExists(t.id,n,f.id)){ this.diagnoseFail(t.id,n,f.id,'operação descartada'); continue; }
          out.push({type:'CONTEST',targetId:n,srcId:t.id,target:x.name,
            reason:'território rival com defesa inferior à nossa força',
            urgencyBase:20+(gain-def)*6+(vac?14:0)+Math.min(24,Math.max(0,Greed.tier(x.owner)-1)*4),n:Math.min(myGuards,5)});
        }
      }
    }
    return out;
  },

  genBuildGoals(f,m){
    const mine=World.owned(f.id), out=[];
    const upk=World.upkeep(f.id);
    const P=this.personality(f.id);
    // Ampliação de fábrica: administrar e desenvolver o próprio parque
    // industrial, não só reagir a gargalos. Só considera uma fábrica SAUDÁVEL
    // (sem gargalo recente) — ampliar quem já está travado por falta de
    // insumo só pioraria o prejuízo por hora (opCost sobe com o nível).
    for(const t of mine){
      if(t.works.length || !t.factory || !t.factory.active) continue;
      const lvl=t.factory.level||1;
      if(lvl>=5) continue;
      if(t.factory.bottleneck || (t.factory.stuckSince||0)>1) continue;
      const b=FACTORIES[t.factory.kind];
      const mult=1+(b.opCost||1)*0.06+(b.risk||0)*0.05;
      const cost=Math.round((2200+700*lvl)*mult);
      if(f.money<cost+upk*70) continue;
      out.push({type:'INVEST',targetId:t.id,target:t.name,upgrade:true,fromLevel:lvl,
        reason:`ampliar ${b.name} de nível ${lvl} para ${lvl+1}`,
        urgencyBase:14+P.infrastructure*14+P.economy*6});
    }
    if(f.money<upk*70+3000) return out;
    for(const t of mine){
      if(t.works.length) continue;
      if(!t.buildings.deposito && (t.type==='oficina'||t.type==='sitio'))
        out.push({type:'INVEST',targetId:t.id,target:t.name,reason:'sem depósito para escoar produção',urgencyBase:26});
      if(!t.buildings.ponto && (t.demand.cinza+t.demand.ambar+t.demand.rubra)>0.8)
        out.push({type:'INVEST',targetId:t.id,target:t.name,reason:'território com demanda sem Boca',urgencyBase:30});
    }
    // Posto de Mercado: sem ele a firma não vende excedente industrial nem
    // recebe fornecimento alternativo do Mercado (o que a deixava em
    // desvantagem em relação ao jogador). Vale a pena onde há fábrica ou
    // muito estoque industrial parado.
    if(!mine.some(t=>t.buildings.mercado) && f.money>BUILD.mercado.cost+upk*40){
      const ind=t=>INDUSTRIAL.reduce((a,g)=>a+(t.stock[g]||0),0)+(t.factory?150:0);
      const t=mine.filter(x=>!x.works.length).sort((a,b)=>ind(b)-ind(a))[0];
      if(t && ind(t)>60) out.push({type:'INVEST',targetId:t.id,target:t.name,build:'mercado',reason:'sem Posto de Mercado para escoar excedente e reforçar suprimento',urgencyBase:24+this.personality(f.id).economy*10});
    }
    if(!mine.some(t=>t.buildings.garagem) && mine.length){
      const t=mine.find(x=>!x.works.length)||mine[0];
      out.push({type:'INVEST',targetId:t.id,target:t.name,reason:'frota sem garagem de apoio',urgencyBase:20});
    }
    return out;
  },

  genRecruitGoals(f,m){
    const mine=World.owned(f.id), out=[];
    const upk=World.upkeep(f.id);
    const home=mine.find(t=>t.buildings.ponto&&!t.works.length)||mine.find(t=>!t.works.length);
    if(!home) return out;
    const ops=World.units.filter(u=>u.f===f.id&&u.kind==='vapor').length;
    const seg=World.units.filter(u=>u.f===f.id&&u.kind==='seguranca').length;
    if(ops<mine.length+1 && f.money>upk*40+UNITS.vapor.cost)
      out.push({type:'RECRUIT',targetId:home.id,target:home.name,good:'vapor',reason:'operadores insuficientes para manter influência',urgencyBase:22});
    if(seg<4 && f.money>upk*70+UNITS.seguranca.cost)
      out.push({type:'RECRUIT',targetId:home.id,target:home.name,good:'seguranca',reason:'segurança insuficiente para defesa',urgencyBase:24});
    const myVeh=World.veh.filter(v=>v.f===f.id).length;
    const gar=mine.find(t=>t.buildings.garagem&&!t.works.length);
    if(myVeh<3 && gar && f.money>upk*80+VEHICLES.caminhao.cost)
      out.push({type:'RECRUIT',targetId:gar.id,target:gar.name,good:'caminhao',reason:'frota de transporte insuficiente',urgencyBase:20});
    return out;
  },

  genTradeGoals(f,m){
    const mine=World.owned(f.id), out=[];
    const upk=World.upkeep(f.id);
    const allies=World.fac.filter(x=>x.id!==f.id&&World.relation(f.id,x.id)==='aliada');
    for(const ally of allies){
      if(World.trades.some(tr=>tr.seller===f.id&&tr.buyer===ally.id&&tr.status!=='delivered'&&tr.status!=='cancelled')) continue;
      const origin=mine.find(t=>(t.stock.armas>15||t.stock.ammo>40||t.stock.fuel>80||t.stock.insumo>80));
      if(origin && f.money>upk*100+5000 && ally.money>3000){
        out.push({type:'TRADE',targetId:ally.home,srcId:origin.id,target:ally.short,
          reason:'excedente disponível para venda a aliado',urgencyBase:16});
      }
    }
    return out;
  },

  genDefendGoals(f,m){
    const mine=World.owned(f.id), out=[];
    for(const t of mine){
      const rivalHere=World.units.some(u=>u.loc===t.id&&u.f!==f.id&&u.f>=0);
      const idleGuards=World.units.filter(u=>u.f===f.id&&u.kind==='seguranca'&&u.state==='idle');
      if((rivalHere||t.unrest>55) && idleGuards.length){
        const carrier=idleGuards.find(u=>u.loc!==t.id&&this.routeExists(u.loc,t.id,f.id));
        if(!carrier){
          if(idleGuards.some(u=>u.loc!==t.id)) this.diagnoseFail(idleGuards[0].loc,t.id,f.id,'reforço descartado');
          continue;
        }
        out.push({type:'DEFEND',targetId:t.id,srcId:carrier.loc,target:t.name,
          reason:rivalHere?'presença rival detectada em território próprio':'desordem elevada',
          urgencyBase:38+t.unrest*0.3});
      }
    }
    return out;
  },

  /* Gestão estrutural de pessoal como OBJETIVO acompanhável (LOTE 4) —
     diferente da manutenção reativa de background() (que só evita ser pega de
     surpresa por caixa/deserção), aqui a IA percebe DUAS necessidades
     estruturais e as transforma em planos de poucos passos, com um
     personagem ESPECÍFICO escolhido por peso (nunca o primeiro da lista):
       • EQUIP — segurança ociosa e de confiança (lealdade/desempenho/
         experiência) ainda sem colete, quando o caixa realmente sobra.
       • REASSIGN — território de fronteira (vizinho de dono diferente) com
         guarnição escassa, enquanto outro território próprio tem sobra —
         reorganização interna de PESSOAL, o equivalente de
         genRedistributeGoals só que para gente, não para estoque. */
  genStaffGoals(f,m){
    const mine=World.owned(f.id), out=[];
    const upk=World.upkeep(f.id);
    const P=this.personality(f.id);

    if(f.money>upk*150){
      const candidates=World.units.filter(u=>u.f===f.id&&u.kind==='seguranca'&&u.state==='idle'&&
        !(u.inventory||[]).some(k=>{ const item=World.items?.find(i=>i.id===k); return item&&Personnel.ITEMS[item.key]?.slot==='colete'; }));
      if(candidates.length){
        const chosen=this.pickPersonnel(candidates,{loyalty:0.4,performance:0.3,exp:0.3});
        if(chosen) out.push({type:'EQUIP',targetId:chosen.loc,srcId:chosen.loc,unitId:chosen.id,itemKey:'colete',
          target:chosen.name, reason:'segurança de confiança sem proteção adequada',
          urgencyBase:14+P.infrastructure*10+P.aggression*6});
      }
    }

    if(mine.length>=2){
      for(const dst of mine){
        const hereGuards=World.at(dst.id,f.id,'seguranca').length;
        const exposed=dst.neighbors.some(n=>{ const x=World.ix[n]; return x&&x.owner!==f.id; });
        if(!exposed || hereGuards>=2) continue;
        const donor=mine.filter(t=>t.id!==dst.id)
          .map(t=>({t,n:World.at(t.id,f.id,'seguranca').length}))
          .filter(o=>o.n>=3).sort((a,b)=>b.n-a.n)[0];
        if(!donor) continue;
        if(!this.routeExists(donor.t.id,dst.id,f.id)) continue;
        const candidates=World.at(donor.t.id,f.id,'seguranca');
        const chosen=this.pickPersonnel(candidates,{discipline:0.5,loyalty:0.3,def:0.2});
        if(!chosen) continue;
        out.push({type:'REASSIGN',targetId:dst.id,srcId:donor.t.id,unitId:chosen.id,
          target:dst.name,reason:'território de fronteira com guarnição escassa',
          urgencyBase:16+(2-hereGuards)*8+P.logistics*6});
      }
    }
    return out;
  },

  /* ============================== EXECUÇÃO ================================= */
  execute(f,m,dh){
    const g=m.goal; if(!g) return;
    switch(g.type){
      case 'SUPPLY': this.execSupply(f,m); break;
      case 'REDISTRIBUTE': this.execSupply(f,m); break; // mesma mecânica de atribuição de veículo, origem/destino internos
      case 'EXPAND': this.execExpand(f,m); break;
      case 'CONTEST': this.execContest(f,m); break;
      case 'INVEST': this.execInvest(f,m); break;
      case 'RECRUIT': this.execRecruit(f,m); break;
      case 'TRADE': this.execTrade(f,m); break;
      case 'DEFEND': this.execDefend(f,m); break;
      case 'EQUIP': this.execEquip(f,m); break;
      case 'REASSIGN': this.execReassign(f,m); break;
      case 'RECOVER': case 'WAIT': default: break; // apenas aguarda / se recupera
    }
  },

  execSupply(f,m){
    const g=m.goal;
    const already=World.veh.some(v=>v.f===f.id&&v.route&&v.route.a===g.srcId&&v.route.b===g.targetId&&v.route.good===g.good);
    if(already) return;
    const v=World.veh.find(x=>x.f===f.id&&!x.route&&!x.path.length);
    if(!v) return;
    const sea=VEHICLES[v.kind].sea;
    if(!World.path(g.srcId,g.targetId,sea,f.id)){
      if(!sea) this.diagnoseFail(g.srcId,g.targetId,f.id,'abastecimento');
      m.goal=null; return;
    }
    const err=Logi.assign(v,g.srcId,g.targetId,g.good,VEHICLES[v.kind].cap);
    if(!err) m.planStep=Math.min(m.plan.length-1,2);
  },

  execExpand(f,m){
    const g=m.goal;
    const already=World.units.some(u=>u.f===f.id&&(u.op===null)&&u.path[0]===g.targetId);
    if(already) return;
    // Seleção ponderada em vez de "o primeiro Vapor ocioso com rota": prefere
    // quem gera mais influência (inf efetivo) e é mais confiável para deixar
    // sozinho num território neutro recém-ocupado.
    const candidates=World.units.filter(x=>x.f===f.id&&x.kind==='vapor'&&x.state==='idle'&&this.routeExists(x.loc,g.targetId,f.id));
    if(!candidates.length){
      const any=World.units.find(x=>x.f===f.id&&x.kind==='vapor'&&x.state==='idle');
      if(any) this.diagnoseFail(any.loc,g.targetId,f.id,'expansão');
      m.goal=null; return;
    }
    const u=this.pickPersonnel(candidates,{inf:0.5,loyalty:0.3,exp:0.2});
    u.state='moving'; u.path=[g.targetId]; u.roadPoints=null; u.roadIndex=0;
    m.planStep=1;
  },

  execContest(f,m){
    const g=m.goal;
    const active=World.ops.find(op=>op.f===f.id&&op.to===g.targetId&&(op.state==='prep'||op.state==='marcha'));
    if(active){ m.state='OPERATING'; m.planStep=3; return; }
    // Composição real da operação (Lote 3): a IA escolhe QUEM vai, não só
    // quantos — pesos variam com a própria personalidade (facção mais
    // agressiva/tolerante a risco favorece experiência/ataque bruto mesmo com
    // lealdade menor; mais cautelosa prioriza lealdade/disciplina).
    const P=this.personality(f.id);
    const candidates=World.at(g.srcId,f.id,'seguranca');
    const n=Math.min(g.n||3,candidates.length);
    if(n<1){ m.goal=null; return; }
    const weights={exp:0.3+P.aggression*0.2, loyalty:0.2+(1-P.riskTolerance)*0.2, discipline:0.15, atk:0.2+P.aggression*0.2};
    const chosen=this.pickTopN(candidates,weights,n);
    const unitIds=chosen.map(u=>u.id);
    const q=Ops.quote(f.id,g.srcId,g.targetId,n,unitIds);
    if(!q.ok){ m.lastRefusalReason=q.reason; this.logLine(m,`Operação recusada: ${q.reason}`); m.goal=null; return; }
    const err=Ops.plan(f.id,g.srcId,g.targetId,n,unitIds);
    if(err){ m.lastRefusalReason=err; this.logLine(m,`Operação recusada: ${err}`); m.goal=null; return; }
    m.lastOpH=World.h; m.state='OPERATING'; m.planStep=3;
    UI.log(`<b>${f.short}</b> concentra pessoal em ${World.ix[g.srcId].name}.`, World.ix[g.targetId].owner===0?'hit':null);
    if(World.ix[g.targetId].owner===0) UI.banner(`${f.short} se prepara contra ${World.ix[g.targetId].name}`);
  },

  execInvest(f,m){
    const g=m.goal, t=World.ix[g.targetId];
    if(!t){ m.goal=null; return; }
    if(g.upgrade){
      if(!t.factory){ m.goal=null; return; }
      // Nível já subiu desde que o objetivo foi criado: a obra encomendada
      // terminou — encerra como concluído em vez de tentar ampliar de novo.
      if((t.factory.level||1)>(g.fromLevel||1)){ m.goal=null; return; }
      if(t.works.length){ m.planStep=1; return; } // obra em andamento: só aguarda
      if((t.factory.level||1)>=5){ m.goal=null; return; }
      const err=FactorySystem.upgrade(t);
      if(!err) m.planStep=1; else { m.lastRefusalReason=err; m.goal=null; }
      return;
    }
    if(t.works.length) { m.planStep=1; return; }
    let k=null;
    if(g.build && !t.buildings[g.build]) k=g.build;
    else if(!t.buildings.deposito && (t.type==='oficina'||t.type==='sitio')) k='deposito';
    else if(!t.buildings.ponto) k='ponto';
    else if(!t.buildings.garagem) k='garagem';
    if(!k){ m.goal=null; return; }
    if(f.money<BUILD[k].cost) return;
    f.money-=BUILD[k].cost;
    t.works.push({type:'build',k,p:0,need:BUILD[k].hours});
    m.planStep=1;
  },

  execRecruit(f,m){
    const g=m.goal, t=World.ix[g.targetId];
    if(!t||t.works.length){ m.planStep=1; return; }
    if(g.good==='caminhao'){
      if(f.money<VEHICLES.caminhao.cost) return;
      f.money-=VEHICLES.caminhao.cost; t.works.push({type:'veh',k:'caminhao',p:0,need:VEHICLES.caminhao.hours});
    } else {
      const k=g.good;
      if(f.money<UNITS[k].cost) return;
      f.money-=UNITS[k].cost; t.works.push({type:'unit',k,p:0,need:UNITS[k].hours});
    }
    m.planStep=1;
  },

  execTrade(f,m){
    const g=m.goal;
    const ally=World.fac.find(x=>x.short===g.target);
    if(!ally) { m.goal=null; return; }
    const origin=World.ix[g.srcId];
    if(!origin||origin.owner!==f.id){ m.goal=null; return; }
    if(World.trades.some(tr=>tr.seller===f.id&&tr.buyer===ally.id&&tr.status!=='delivered'&&tr.status!=='cancelled')){ m.planStep=1; return; }
    const good=origin.stock.armas>15?'armas':origin.stock.ammo>40?'ammo':origin.stock.fuel>80?'fuel':'insumo';
    const qty=Math.min(good==='armas'?20:good==='ammo'?40:60,origin.stock[good]);
    if(qty<=0){ m.goal=null; return; }
    const before=World.trades.length;
    const err=Econ.createTrade(f.id,ally.id,good,qty,GOODS[good].buy*1.25,origin.id);
    if(!err && World.trades.length>before){
      const tr=World.trades[World.trades.length-1];
      const v=World.veh.find(x=>x.f===f.id&&x.loc===origin.id&&!x.route&&!x.path.length);
      if(v) Logi.assignTrade(v,tr);
      m.planStep=2;
    }
  },

  execDefend(f,m){
    const g=m.goal;
    const already=World.units.some(u=>u.f===f.id&&u.kind==='seguranca'&&u.path[0]===g.targetId);
    if(already) return;
    // Seleção ponderada: quem reforça um território ameaçado deveria ser
    // disciplinado e leal (não deserta nem falha no meio do caminho), não
    // simplesmente o primeiro ocioso encontrado.
    const candidates=World.units.filter(x=>x.f===f.id&&x.kind==='seguranca'&&x.state==='idle'&&x.loc!==g.targetId&&this.routeExists(x.loc,g.targetId,f.id));
    if(!candidates.length){
      const any=World.units.find(x=>x.f===f.id&&x.kind==='seguranca'&&x.state==='idle'&&x.loc!==g.targetId);
      if(any) this.diagnoseFail(any.loc,g.targetId,f.id,'reforço');
      m.goal=null; return;
    }
    const u=this.pickPersonnel(candidates,{def:0.4,discipline:0.3,loyalty:0.3});
    u.state='moving'; u.path=[g.targetId]; u.roadPoints=null; u.roadIndex=0;
    m.planStep=1;
  },

  /* EQUIP: fabrica (ou reaproveita um item físico já largado no território —
     ver World.itemsAt) e equipa o personagem específico escolhido por
     genStaffGoals. Nunca cria equipamento: se faltar caixa ou estoque de
     armas, Personnel.craftItem recusa e a IA só aguarda a próxima
     reavaliação (mesmo contrato de erro usado pelo jogador). */
  execEquip(f,m){
    const g=m.goal;
    const u=World.units.find(x=>x.id===g.unitId);
    if(!u||u.f!==f.id||u.state!=='idle'){ m.goal=null; return; }
    const t=World.ix[u.loc];
    if(!t||t.owner!==f.id){ m.goal=null; return; }
    const tpl=Personnel.ITEMS[g.itemKey]; if(!tpl){ m.goal=null; return; }
    const already=(u.inventory||[]).some(k=>{ const item=World.items?.find(i=>i.id===k); return item&&Personnel.ITEMS[item.key]?.slot===tpl.slot; });
    if(already){ m.goal=null; return; }
    m.planStep=1;
    const freeItem=World.itemsAt(t.id,f.id).find(i=>i.key===g.itemKey);
    if(freeItem){ const err=Personnel.equip(u,freeItem.id); if(!err){ m.planStep=2; this.logLine(m,`Pessoal: equipou ${u.name} com ${tpl.name} (peça já disponível em ${t.name}).`); } return; }
    const made=Personnel.craftItem(t.id,g.itemKey,f.id);
    if(typeof made==='string'){ m.lastRefusalReason=made; return; } // caixa/estoque insuficiente: só aguarda a próxima reavaliação
    Personnel.equip(u,made.id);
    m.planStep=2;
    this.logLine(m,`Pessoal: equipou ${u.name} com ${tpl.name} (fabricado em ${t.name}).`);
  },

  /* REASSIGN: desloca um personagem ESPECÍFICO (já escolhido por
     genStaffGoals) de um território com sobra de guarnição para um com
     carência — mesma mecânica de movimento usado por DEFEND, mas motivada por
     desequilíbrio estrutural, não por ameaça imediata. */
  execReassign(f,m){
    const g=m.goal;
    const u=World.units.find(x=>x.id===g.unitId);
    if(!u||u.f!==f.id||u.state!=='idle'){ m.goal=null; return; }
    if(u.loc===g.targetId){ m.goal=null; return; }
    if(!this.routeExists(u.loc,g.targetId,f.id)){ this.diagnoseFail(u.loc,g.targetId,f.id,'reorganização de pessoal descartada'); m.goal=null; return; }
    u.state='moving'; u.path=[g.targetId]; u.roadPoints=null; u.roadIndex=0;
    m.planStep=1;
  },

  /* ============================== DEBUG ==================================== */
  diagnose(fid){
    const f=World.fac[fid], m=this.memOf(fid);
    const info={
      faction:f.short, state:m.state, goal:m.goal?`${m.goal.type} → ${m.goal.target}`:'—',
      reason:m.goal?m.goal.reason:'—', priority:m.goal?m.goal.priority:0,
      traits:{...this.personality(fid)}, // personalidade dinâmica atual (evoluiu/regrediu desde o início)
      plan:m.plan, planStep:m.planStep,
      lastTargets:m.lastTargets.slice(), recentGoals:m.recent.map(r=>`${r.type}@${r.targetId}(h${Math.round(r.h)})`),
      completedPlans:m.completedPlans, cancelledPlans:m.cancelledPlans, repeatedActions:m.repeatedActions,
      lastRefusalReason:m.lastRefusalReason, timeSinceDecision:Math.round(World.h-(m.goal?.startedH||0)),
      log:m.log.slice(),
      perception:this.perceive(f), // retrato estruturado do estado da firma no momento do diagnóstico
    };
    console.log(`[AI] ${f.name}\nEstado: ${info.state}\nObjetivo: ${info.goal}\nMotivo: ${info.reason}\nScore: ${info.priority}\nPlano: ${info.plan.join(' → ')||'—'}`);
    return info;
  },
};
