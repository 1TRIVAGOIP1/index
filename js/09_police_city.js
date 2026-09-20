/* ================================ Police ================================ */
const Police = {
  // BUG corrigido: o cooldown era um único número global (`cd`) compartilhado
  // por todas as facções. Assim que UMA facção sofria uma batida, `cd` subia
  // para 60 e bloqueava a polícia de agir contra QUALQUER outra facção por
  // 60 h — inclusive o jogador. Agora cada facção tem seu próprio relógio.
  cds:{},
  // Contador de propinas recentes por facção — cada tentativa aumenta o
  // risco da próxima (ver bribe()); decai lentamente com o tempo, então uma
  // facção que para de usar o recurso volta gradualmente a um risco baixo.
  bribeCount:{},
  tick(dh){
    for(const f of World.fac){
      const prev=this.cds[f.id]||0;
      const cd=Math.max(0,prev-dh);
      this.cds[f.id]=cd;
      if(f.heat>=CONF.raidAt && cd<=0 && World.owned(f.id).length){
        this.raid(f); this.cds[f.id]=60; f.heat=Math.max(0,f.heat-30);
      } else if(f.heat>=40 && f.heat<CONF.raidAt && cd<=0 && World.owned(f.id).length){
        // Gradação abaixo do limiar de raid: entre 40% e 70% de pressão há
        // uma chance pequena por hora de uma "batida leve" — dá sinal ao
        // jogador de que a situação está piorando, em vez de silêncio total
        // até o estouro em CONF.raidAt. Chance escala de ~0.4%/h (heat=40)
        // a ~2.2%/h (heat=70).
        const chance=(0.004+(f.heat-40)/30*0.018)*dh;
        if(Math.random()<chance){ this.lightRaid(f); this.cds[f.id]=18; }
      }
      // Propina "esfria" com o tempo: cada ~30h sem uso reduz o contador em 1,
      // então o risco de vazamento volta a cair se a facção parar de recorrer
      // a isso com frequência.
      if(this.bribeCount[f.id]) this.bribeCount[f.id]=Math.max(0,this.bribeCount[f.id]-dh/30);
    }
  },
  /* Paga propina para reduzir a pressão policial na hora. Custa dinheiro
     sempre, mas o resultado não é garantido: quanto mais a facção recorreu
     a isso recentemente, maior o risco de a tentativa vazar e a pressão
     SUBIR em vez de cair — corrupção não é grátis nem infalível. */
  bribe(fid,amount){
    const f=World.fac[fid];
    amount=Math.max(200,Math.round(Number(amount)||0));
    if(f.money<amount) return 'Caixa insuficiente para pagar a propina.';
    const n=this.bribeCount[fid]||0;
    // Risco de vazamento: 8% base + 6% por uso recente, até um teto de 55% —
    // nunca totalmente seguro, nunca impossível.
    const failChance=Math.min(0.55,0.08+n*0.06);
    f.money-=amount;
    this.bribeCount[fid]=n+1;
    if(Math.random()<failChance){
      const extra=Math.round(amount*0.02)+8;
      f.heat=Math.min(CONF.heatMax,f.heat+extra);
      if(fid===0) UI.log(`⚠️ A propina vazou — pressão policial subiu em vez de cair (+${extra}%).`,'hit');
      return null;
    }
    const relief=Math.min(f.heat,18+amount*0.05);
    f.heat=Math.max(0,f.heat-relief);
    if(fid===0) UI.log(`Propina paga discretamente. Pressão reduzida em ${Math.round(relief)}%.`);
    return null;
  },
  /* Quanto mais rica a firma, mais a polícia leva do CAIXA numa batida (3% por
     nível de cobiça, até 30%; metade disso na batida leve). Riqueza parada é
     riqueza exposta — gastar, investir ou "lavar" via propina passa a importar. */
  seizeCash(f,scale){
    const tier=(typeof Greed!=='undefined')?Greed.tier(f.id):0;
    if(tier<1||f.money<=0) return 0;
    const cash=Math.round(f.money*Math.min(0.30,0.03*tier)*scale);
    f.money-=cash; return cash;
  },
  lightRaid(f){
    const t=World.owned(f.id).sort((a,b)=>(b.stock.rubra*3+b.stock.ambar*2+b.stock.cinza)-(a.stock.rubra*3+a.stock.ambar*2+a.stock.cinza))[0];
    if(!t) return;
    let seized=0;
    // Fração bem menor que o raid completo (que tira 55% do estoque): aqui
    // só 12–18%, sem prender pessoal nem derrubar tanto a influência — é
    // aviso, não o golpe final.
    const frac=0.12+Math.random()*0.06;
    for(const g of SELLABLE){ seized+=t.stock[g]*frac*GOODS[g].base; t.stock[g]*=(1-frac); }
    t.unrest=Math.min(100,t.unrest+18);
    const cash=this.seizeCash(f,0.5);
    UI.log(`🚓 Batida leve em <b>${t.name}</b> contra ${f.short}. Apreensão parcial de ~${money(Math.round(seized))}${cash?` e confisco de ${money(cash)} em caixa`:''}.`,'cop');
    if(f.id===0) World.chron(`Batida leve em ${t.name}${cash?` (confisco de ${money(cash)})`:''}.`);
    if(f.id===0) Notifications.push('police','Batida policial leve',`Uma batida leve em ${t.name} apreendeu parte do estoque. A pressão segue subindo — considere pagar propina ou reduzir preços agressivos.`,1,`lightraid-${t.id}-${Math.floor(World.h/6)}`);
  },
  roadEncounter(v,tid){
    // Antes só v.f===0 (o jogador) sofria blitz/interceptação na estrada — as
    // 3 IAs nunca corriam esse risco, uma assimetria real contra o jogador.
    // Agora a mecânica vale pra qualquer facção; só a exibição em tela (log e
    // notificação) continua restrita ao jogador, pra não gerar ruído sobre
    // eventos que ele não pode ver nem reagir.
    if(!v||v.kind==='lancha'||v.qty<=0.5) return;
    if(World.h-v.lastRoadEventH<6) return;
    v.lastRoadEventH=World.h;
    const t=World.ix[tid]; if(!t) return;
    const f=World.fac[v.f];
    const rival=t.owner!=null && t.owner!==v.f;
    const policeChance=Math.min(0.055,0.008 + f.heat*0.00042 + (t.unrest||0)*0.00012);
    if(Math.random()<policeChance){
      const seized=Math.min(v.qty, Math.max(1,v.qty*(0.18+Math.random()*0.27)));
      const g=Object.keys(v.cargo).find(k=>v.cargo[k]>0.5);
      if(g){ v.cargo[g]=Math.max(0,v.cargo[g]-seized); v.qty=Math.max(0,v.qty-seized); }
      f.money-=Math.round(90+Math.random()*260);
      f.heat=Math.min(CONF.heatMax,f.heat+7);
      v.condition=Math.max(40,(v.condition||100)-3);
      v.note='retido em blitz';
      if(v.f===0){
        UI.log(`🚓 Blitz na estrada em <b>${t.name}</b>: ${Math.round(seized)} un. retidas e multa aplicada.`,'cop');
        Notifications.push('police','Blitz na estrada',`O carro de apoio encontrou uma blitz em ${t.name}. Houve retenção de carga e multa.`,1,`blitz-${v.id}-${Math.floor(World.h/6)}`);
      }
      return;
    }
    if(rival){
      const rivalUnits=World.units.filter(u=>u.f===t.owner&&u.loc===tid&&u.kind==='seguranca').length;
      const rivalChance=Math.min(0.16,0.035 + f.heat*0.00035 + rivalUnits*0.012 + (t.unrest||0)*0.0002);
      if(Math.random()<rivalChance){
        const g=Object.keys(v.cargo).find(k=>v.cargo[k]>0.5);
        const lost=Math.min(v.qty,Math.max(1,v.qty*(0.28+Math.random()*0.38)));
        if(g){v.cargo[g]=Math.max(0,v.cargo[g]-lost);v.qty=Math.max(0,v.qty-lost);}
        f.reputation=Math.max(0,f.reputation-2);
        v.note='carga interceptada';
        if(v.qty<=0.5){v.route=null;v.phase='idle';}
        if(v.f===0){
          UI.log(`⚠️ Passagem por ${t.name}: uma facção rival interceptou parte da carga (${Math.round(lost)} un.).`,'hit');
          Notifications.push('threat','Carga interceptada',`A passagem por ${t.name} apresentou risco rival e parte da carga foi perdida.`,1,`rival-${v.id}-${Math.floor(World.h/6)}`);
        }
      }
    }
  },
  raid(f){
    const t=World.owned(f.id).sort((a,b)=>(b.stock.rubra*3+b.stock.ambar*2+b.stock.cinza)-(a.stock.rubra*3+a.stock.ambar*2+a.stock.cinza))[0];
    if(!t) return;
    let seized=0;
    for(const g of SELLABLE){ seized+=t.stock[g]*0.55*GOODS[g].base; t.stock[g]*=0.45; }
    t.stock.ammo*=0.6; t.unrest=Math.min(100,t.unrest+55);
    t.inf[f.id]=Math.max(0,t.inf[f.id]-16);
    for(const u of World.units.filter(u=>u.loc===t.id&&u.f===f.id).slice(0,2)) u.hp=Math.max(12,u.hp*0.5);
    const cash=this.seizeCash(f,1);
    UI.log(`🚨 Operação policial em <b>${t.name}</b> contra ${f.short}. Apreensão de ~$${Math.round(seized).toLocaleString('pt-BR')}${cash?` e confisco de ${money(cash)} em caixa`:''}.`,'cop');
    if(f.id===0){ UI.banner(`Operação policial em ${t.name}`); World.chron(`Operação policial em ${t.name}: ${money(Math.round(seized))} apreendidos${cash?` + ${money(cash)} do caixa`:''}.`); }
  }
};

/* ================================ Escassez ============================== */
/* Duas formas de escassez de importação:
   1) ESTRUTURAL — cota do porto: cada porto tem uma quantidade finita de cada
      bem importado (QUOTA_CAP) que se recompõe devagar (QUOTA_REGEN por hora).
      Quanto mais vazia a cota, mais caro o bem (até +50%). Comprar em massa
      tem custo; acumular estoque no porto é uma decisão, não um botão.
   2) POR EVENTO — falta externa: um (às vezes dois) bem importável some do
      abastecimento por um período. Há um AVISO ~10–16 h antes (janela para
      estocar), depois os portos param de vendê-lo até o fim do período; ao
      voltar, os portos retomam com só 60% da cota. Enquanto durar, o Mercado
      vende esse bem a preço de escassez (×1.9) e paga mais (×1.5) por ele:
      quem se preparou lucra, quem não se preparou paga caro ou trava.
   Vale para TODAS as firmas: a IA estoca no aviso e segura reserva na falta
   (ver AI.background / reserveFor / marketBuy). */
const Scarcity={
  IMPORTABLE:['insumo','quimico','fuel','armas','ammo'],
  QUOTA_CAP:360, QUOTA_REGEN:6,
  freshStock(){ const o={}; for(const g of this.IMPORTABLE) o[g]=this.QUOTA_CAP; return o; },
  state(g){
    for(const s of World.shortages){
      if(s.good!==g||World.h>=s.until) continue;
      return World.h<s.startH?{phase:'warning',s}:{phase:'active',s};
    }
    return null;
  },
  active(g){ const st=this.state(g); return st&&st.phase==='active'?st.s:null; },
  warning(g){ const st=this.state(g); return st&&st.phase==='warning'?st.s:null; },
  blockReason(g){
    const s=this.active(g);
    return s?`Importação de ${GOODS[g].name} suspensa por ~${Math.ceil(s.until-World.h)} h (escassez externa). Use o estoque, o Mercado ou produção própria.`:null;
  },
  importStock(t,g){ return (t&&t.importStock)?(t.importStock[g]||0):0; },
  consume(t,g,q){ if(t&&t.importStock) t.importStock[g]=Math.max(0,(t.importStock[g]||0)-q); },
  quotaMult(t,g){ const fr=Math.max(0,Math.min(1,this.importStock(t,g)/this.QUOTA_CAP)); return 1+(1-fr)*0.5; },
  marketPremium(g,dir){ return this.active(g)?(dir==='sell'?1.9:1.5):1; },
  /* Lista para a UI/Alerts: fases vigentes e futuras. */
  current(){
    const out=[];
    for(const s of World.shortages){ if(s.ended) continue;
      const st=this.state(s.good); if(st&&st.s===s) out.push({good:s.good,phase:st.phase,hoursToStart:Math.max(0,s.startH-World.h),hoursLeft:Math.max(0,s.until-World.h)}); }
    return out;
  },
  schedule(){
    const free=this.IMPORTABLE.filter(g=>!World.shortages.some(s=>!s.ended&&s.good===g));
    if(!free.length) return;
    const n=(Math.random()<0.2&&free.length>1)?2:1;
    const lead=10+Math.random()*6, dur=30+Math.random()*26;
    for(let i=0;i<n;i++){
      const g=free.splice(Math.floor(Math.random()*free.length),1)[0];
      World.shortages.push({id:World.uid++,good:g,warnH:World.h,startH:World.h+lead,until:World.h+lead+dur,warned:false,started:false,ended:false});
    }
  },
  announce(s,phase){
    const N=(typeof Notifications!=='undefined')?Notifications:null, nm=GOODS[s.good].name;
    const port=World.owned(0).find(t=>t.type==='porto');
    const act=port?{label:'Ver porto',tab:'terr',tid:port.id}:{label:'Abrir Painel',tab:'painel'};
    const lead=Math.round(s.startH-s.warnH), dur=Math.round(s.until-s.startH);
    if(phase==='warn'){
      UI.log(`📉 <b>Sinais de escassez</b>: ${nm} deve faltar no abastecimento externo em ~${lead} h.`,'hit');
      if(N) N.push('economy',`Escassez à vista: ${nm}`,`Fornecedores externos devem parar de entregar ${nm} em ~${lead} h, por ~${dur} h. Estoque feito agora pode salvar a firma.`,1,`scar-warn-${s.id}`,act);
    } else if(phase==='start'){
      UI.log(`⛔ <b>${nm}</b> em falta: os portos não vendem até o fim do período (~${dur} h).`,'hit');
      if(N) N.push('economy',`${nm} em falta`,`Os portos pararam de vender ${nm} por ~${dur} h. O Mercado ainda negocia, mas a preço de escassez.`,2,`scar-start-${s.id}`,{label:'Abrir Mercado',tab:'mercado'});
      if(typeof PurchaseOffers!=='undefined'){ PurchaseOffers.burst('sell',1,0); PurchaseOffers.burst('buy',1,0); }
    } else {
      UI.log(`✅ Importação de <b>${nm}</b> retomada (com cota parcial nos portos).`,'win');
      if(N) N.push('economy',`${nm} de volta`,`Os portos voltaram a vender ${nm}, ainda com cota reduzida por um tempo.`,0,`scar-end-${s.id}`,act);
      for(const t of World.terr) if(t.importStock) t.importStock[s.good]=this.QUOTA_CAP*0.6;
    }
  },
  tick(dh){
    if(World.scarcityCd==null) World.scarcityCd=80;
    // cota regenera — exceto do bem que está em falta
    for(const t of World.terr){
      if(!t.importStock) continue;
      for(const g of this.IMPORTABLE){
        if(this.active(g)) continue;
        t.importStock[g]=Math.min(this.QUOTA_CAP,(t.importStock[g]||0)+this.QUOTA_REGEN*dh);
      }
    }
    World.scarcityCd-=dh;
    if(World.scarcityCd<=0 && World.h>50){ this.schedule(); World.scarcityCd=70+Math.random()*80; }
    for(const s of World.shortages){
      if(!s.warned){ s.warned=true; this.announce(s,'warn'); }
      if(!s.started && World.h>=s.startH){ s.started=true; this.announce(s,'start'); }
      if(!s.ended && World.h>=s.until){ s.ended=true; this.announce(s,'end'); }
    }
    if(World.shortages.some(s=>s.ended&&World.h-s.until>2)) World.shortages=World.shortages.filter(s=>!s.ended||World.h-s.until<=2);
  }
};

/* ============================== Cidade Viva ============================== */
/* Eventos de mundo. Além dos multiplicadores de fundo (demanda), alguns
   eventos agora abrem JANELAS DE DECISÃO — para o jogador (via notificação
   acionável) e para as IAs (via AI.marketTrade / genContestGoals):
     • Colheita farta      → sítios produzem mais; excedente pede escoamento.
     • Greve no porto      → compra externa encarece; o Mercado passa a
                              oferecer fornecimento alternativo (Posto de Mercado).
     • Vácuo de poder      → um território de outra firma perde influência e
                              ganha desordem: janela para operação/expansão.
     • Mercado aquecido    → compradores pagam mais por excedente, por um tempo.
   Os efeitos são recalculados a partir da lista de eventos ativos (apply), em
   vez de escritos "por cima" — assim eventos sobrepostos não se apagam. */
const City={
  cd:48,
  CATALOG:[
    {name:'Fim de semana forte',desc:'movimento turístico elevado',dur:18,mult:1.24,types:['boca','bairro']},
    {name:'Alta circulação',desc:'maior demanda nos bairros',dur:20,mult:1.15,types:['bairro']},
    {name:'Boca saturada',desc:'demanda temporariamente menor nos bocas',dur:24,mult:.82,types:['boca']},
    {name:'Fiscalização reforçada',desc:'pressão territorial maior',dur:16,mult:.88,types:['all']},
    {name:'Colheita farta',desc:'roças e sítios produzem 35% mais',dur:26,prod:1.35,prodKinds:['roca','sitio'],kind:'harvest'},
    {name:'Seca',desc:'roças e sítios produzem 50% menos',dur:30,prod:0.5,prodKinds:['roca','sitio'],kind:'drought'},
    {name:'Apagão',desc:'usinas de energia quase paradas — toda fábrica que depende de energia sofre',dur:14,prod:0.15,prodKinds:['usina'],kind:'blackout'},
    {name:'Greve no porto',desc:'compra externa 45% mais cara',dur:22,port:1.45,kind:'strike'},
    {name:'Vácuo de poder',desc:'',dur:20,kind:'vacuum'},
    {name:'Mercado aquecido',desc:'compradores pagam mais por excedente',dur:14,kind:'boom'},
  ],
  tick(dh){
    this.cd-=dh;if(this.cd>0)return;
    this.cd=42+Math.random()*30;
    // Sorteia até achar um evento aplicável (vácuo exige alvo válido).
    let e=null;
    for(let tries=0;tries<6&&!e;tries++){
      const c=this.CATALOG[Math.floor(Math.random()*this.CATALOG.length)];
      if(c.kind==='vacuum' && !this.vacuumTarget()) continue;
      if(World.events.some(x=>x.name===c.name)) continue;   // sem duplicar o mesmo evento
      e=c;
    }
    if(!e) return;
    const ev={id:World.uid++,name:e.name,desc:e.desc,until:World.h+e.dur,mult:e.mult,types:e.types||[],prod:e.prod,prodTypes:e.prodTypes||[],prodKinds:e.prodKinds||[],port:e.port,kind:e.kind||'demand'};
    World.events.push(ev);
    this.onStart(ev,e);
    this.apply();
    UI.log(`📰 <b>${ev.name}</b>: ${ev.desc} por ${e.dur}h.`);
  },
  vacuumTarget(){
    const c=World.terr.filter(t=>t.owner!==null && t.id!==World.fac[t.owner]?.home && !((t.vacuoUntil||0)>World.h));
    return c.length?c[Math.floor(Math.random()*c.length)]:null;
  },
  /* Ganchos de decisão: efeitos pontuais no início do evento + aviso
     acionável ao jogador (o botão leva direto ao lugar certo). */
  onStart(ev,e){
    const N=(typeof Notifications!=='undefined')?Notifications:null;
    if(ev.kind==='vacuum'){
      const t=this.vacuumTarget(); if(!t){ ev.kind='demand'; ev.desc='sem efeito'; return; }
      const owner=World.fac[t.owner];
      t.inf[t.owner]=Math.max(CONF.influenceLose+8,(t.inf[t.owner]||0)-18);
      t.unrest=Math.min(100,t.unrest+30);
      t.vacuoUntil=ev.until; ev.tid=t.id; ev.silent=true;
      ev.desc=`${t.name}: a influência de ${owner.short} caiu e a desordem subiu`;
      if(N){
        if(t.owner===0) N.push('threat','Vácuo de poder no seu território',`${t.name} perdeu influência e ganhou desordem por ~${e.dur} h. Reforce com vapores antes que um rival aproveite.`,2,`vacuo-${ev.id}`,{label:'Ver território',tab:'terr',tid:t.id});
        else N.push('event','Vácuo de poder',`${owner.short} perdeu firmeza em ${t.name} por ~${e.dur} h — boa janela para uma operação ou ocupação.`,1,`vacuo-${ev.id}`,{label:'Ver território',tab:'terr',tid:t.id});
      }
    } else if(ev.kind==='boom'){
      World.marketBoostUntil=ev.until; ev.silent=true;
      if(typeof PurchaseOffers!=='undefined') PurchaseOffers.burst('buy',2,0.28);
      if(N) N.push('event','Mercado aquecido','Compradores estão pagando mais por excedente. Novas ofertas de compra chegaram ao Mercado.',1,`boom-${ev.id}`,{label:'Abrir Mercado',tab:'mercado'});
    } else if(ev.kind==='strike'){
      ev.silent=true;
      if(typeof PurchaseOffers!=='undefined') PurchaseOffers.burst('sell',1,0);
      if(N) N.push('event','Greve no porto','Comprar em porto ficou 45% mais caro por um tempo. Quem tem Posto de Mercado recebe ofertas de fornecimento alternativas.',1,`strike-${ev.id}`,{label:'Abrir Mercado',tab:'mercado'});
    } else if(ev.kind==='harvest'){
      ev.silent=true;
      if(N && World.owned(0).some(t=>t.factory&&ev.prodKinds.includes(t.factory.kind))) N.push('event','Colheita farta','Suas roças e sítios produzem 35% mais por um tempo — garanta espaço de estoque e escoe o excedente.',0,`harvest-${ev.id}`,{label:'Abrir Mercado',tab:'mercado'});
      else if(N) N.push('event','Colheita farta',ev.desc,0,`harvest-${ev.id}`);
    } else if(ev.kind==='drought'){
      ev.silent=true;
      if(N) N.push('event','Seca',World.owned(0).some(t=>t.factory&&ev.prodKinds.includes(t.factory.kind))?'Suas roças e sítios produzem metade por um tempo. Insumo e maconha ficam mais escassos — segure estoque ou compre do Mercado.':ev.desc,World.owned(0).some(t=>t.factory&&ev.prodKinds.includes(t.factory.kind))?1:0,`drought-${ev.id}`,{label:'Abrir Mercado',tab:'mercado'});
    } else if(ev.kind==='blackout'){
      ev.silent=true;
      if(typeof PurchaseOffers!=='undefined') PurchaseOffers.burst('buy',1,0);
      if(N) N.push('event','Apagão',World.owned(0).some(t=>t.factory&&ev.prodKinds.includes(t.factory.kind))?'Sua usina quase parou: fábricas sem energia travam e continuam custando caixa. Energia não se transporta — só resta esperar ou reduzir o prejuízo.':ev.desc,1,`blackout-${ev.id}`);
    }
  },
  /* Recalcula os modificadores territoriais a partir dos eventos ativos. */
  apply(){
    for(const t of World.terr){ t.eventMult=1; t.prodMult=1; t.portMult=1; }
    for(const ev of World.events){
      for(const t of World.terr){
        if(ev.mult && ev.types && (ev.types.includes('all')||ev.types.includes(t.type))) t.eventMult*=ev.mult;
        if(ev.prod && ev.prodTypes && ev.prodTypes.includes(t.type)) t.prodMult*=ev.prod;
        if(ev.prod && ev.prodKinds && t.factory && ev.prodKinds.includes(t.factory.kind)) t.prodMult*=ev.prod;
        if(ev.port && t.type==='porto') t.portMult*=ev.port;
      }
    }
    for(const t of World.terr) t.eventMult=Math.max(.6,Math.min(1.5,t.eventMult));
  },
  cleanup(){
    let changed=false;
    for(const e of World.events.filter(x=>World.h>=x.until)){
      World.events.splice(World.events.indexOf(e),1); changed=true;
      if(e.tid){ const t=World.ix[e.tid]; if(t) t.vacuoUntil=0; }
    }
    if(changed) this.apply();
  },
  /* Rótulos curtos dos eventos que afetam um território (para a UI). */
  tagsFor(t){
    const out=[];
    for(const ev of World.events){
      if(ev.tid===t.id) out.push(ev.name);
      else if(ev.mult && ev.types && (ev.types.includes('all')||ev.types.includes(t.type))) out.push(`${ev.name} (demanda ×${ev.mult})`);
      else if(ev.prod && ev.prodTypes && ev.prodTypes.includes(t.type)) out.push(`${ev.name} (produção ×${ev.prod})`);
      else if(ev.prod && ev.prodKinds && t.factory && ev.prodKinds.includes(t.factory.kind)) out.push(`${ev.name} (produção ×${ev.prod})`);
      else if(ev.port && t.type==='porto') out.push(`${ev.name} (compra ×${ev.port})`);
    }
    return out;
  }
};
