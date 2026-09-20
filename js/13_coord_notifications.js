/* ============================ Coordenação =============================== */
/* Uma proposta agora é um acordo econômico de verdade: tem um bem, uma
   quantidade e um preço por unidade — não só um texto livre. Ao ser aceita,
   ela vira uma venda real (Econ.fulfillDeal) da firma vendedora para a
   compradora, com a origem escolhida automaticamente entre os territórios
   do vendedor que têm estoque. O dinheiro só é pago quando a carga é
   FISICAMENTE entregue (Logi.finishTrade) — exatamente pelo preço
   combinado na proposta, nunca pelo preço de mercado do momento.
   kind:'venda'  → from oferece vender `good` para `to` (from é o vendedor)
   kind:'compra' → from quer comprar `good` de `to` (to é o vendedor)
   Pedidos sem `good` (ex.: "Transporte", "Manutenção") continuam sendo só
   coordenação informativa, sem movimento de carga nem dinheiro automático. */
const Coord = (()=>{
  const profiles={
    0:{role:'Movimento e distribuição',needs:[['ammo',2],['armas',1],['logi',3]]},   // por VAGA (id), não por nome: firmas novas herdam a vaga
    1:{role:'Armamentos',needs:[['insumo','Armação'],['ammo','Geribá'],['logi','Brava']]},
    2:{role:'Munição',needs:[['insumo','Armação'],['logi','Brava'],['buyers','Armação']]},
    3:{role:'Apoio e circulação',needs:[['fuel','Armação'],['contracts','Armação'],['maintenance','Armação']]},
  };
  function profile(fid){return profiles[fid]||{role:'Especialização local',needs:[]};}

  function describe(r){
    if(!r.good) return r.note||'coordenação';
    const dir=r.kind==='compra'?'quer comprar':'oferece vender';
    return `${dir} ${r.qty} ${GOODS[r.good].name} a ${money(r.unitPrice)}/un`;
  }

  function openRequest(from,to,kind,good,qty,unitPrice,note=''){
    if(from===to) return 'A solicitação precisa envolver outra firma.';
    if(good && !GOODS[good]) return 'Bem inválido para a proposta.';
    const r={id:World.coordination.seq++,from,to,kind:kind||'geral',good:good||null,
      qty:Math.max(1,Math.round(qty||1)),unitPrice:Math.max(0,Number(unitPrice)||0),
      note,state:'pendente',created:World.h,tradeId:null};
    World.coordination.requests.push(r);
    if(to===0 && from!==0) Notifications.push('agreement','Nova proposta recebida',`${World.fac[from].short} ${describe(r)}.`,1,`req-in-${r.id}`);
    return r;
  }

  /* Executa o acordo economicamente: cria a venda real e tenta providenciar
     transporte imediatamente se houver um carro de apoio livre na origem. */
  function fulfill(r){
    const sellerId = r.kind==='compra' ? r.to : r.from;
    const buyerId  = r.kind==='compra' ? r.from : r.to;
    const seller=World.fac[sellerId], buyer=World.fac[buyerId];
    const origin=World.owned(sellerId).filter(t=>(t.stock[r.good]||0)>0.5)
      .sort((a,b)=>(b.stock[r.good]||0)-(a.stock[r.good]||0))[0];
    if(!origin){
      Notifications.push('agreement','Acordo sem estoque',`${seller.short} não tem ${GOODS[r.good].name} disponível para cumprir o acordo com ${buyer.short}.`,1,`deal-nostock-${r.id}`);
      return;
    }
    const qty=Math.min(r.qty,origin.stock[r.good]);
    const err=Econ.fulfillDeal(sellerId,buyerId,r.good,qty,r.unitPrice,origin.id);
    if(err){
      Notifications.push('agreement','Acordo não pôde ser fechado',err,1,`deal-fail-${r.id}`);
      return;
    }
    const tr=World.trades[World.trades.length-1];
    r.tradeId=tr.id;
    const v=World.veh.find(x=>x.f===sellerId&&x.loc===origin.id&&!x.route&&!x.path.length);
    if(v) Logi.assignTrade(v,tr);
    else if(sellerId===0) Notifications.push('agreement','Acordo fechado — falta transporte',`Aloque um carro de apoio em ${origin.name} para entregar ${GOODS[r.good].name} a ${buyer.short}. O pagamento só sai quando a carga chegar.`,1,`deal-notransport-${r.id}`);
    Notifications.push('agreement','Acordo em execução',`${seller.short} entregará ${Math.round(qty)} ${GOODS[r.good].name} a ${buyer.short} — ${money(qty*r.unitPrice)} ao concluir a entrega.`,0,`deal-open-${r.id}`);
  }

  function accept(id){
    const r=World.coordination.requests.find(x=>x.id===id);
    if(!r) return 'Solicitação inexistente.';
    r.state='aceita'; r.accepted=World.h;
    if(r.good && r.unitPrice>0 && r.qty>0) fulfill(r);
    if(r.from!==0) Notifications.push('agreement','Acordo aceito',`Você aceitou a proposta de ${World.fac[r.from].short}.`,0,`accept-${r.id}`);
    else Notifications.push('agreement','Acordo aceito',`${World.fac[r.to].short} aceitou sua proposta.`,0,`req-ok-${r.id}`);
    return r;
  }
  function reject(id){
    const r=World.coordination.requests.find(x=>x.id===id);
    if(!r) return 'Solicitação inexistente.';
    r.state='recusada';
    Notifications.push('agreement','Proposta recusada',r.from===0?`${World.fac[r.to].short} recusou sua proposta.`:`Você recusou a proposta de ${World.fac[r.from].short}.`,1,`reject-${r.id}`);
    return r;
  }
  function mine(){return World.coordination.requests.filter(r=>r.from===0||r.to===0);}
  return {profile,openRequest,accept,reject,mine,describe};
})();

/* ============================ Notificações =============================== */
/* Sistema de comunicação do jogo com o jogador. Continua orientado a estado
   (scan() compara o mundo a cada tick e emite avisos quando algo muda) e a
   eventos pontuais (push() chamado diretamente por Coord, Logi, Econ, IA
   etc.). O que muda aqui é só a camada de apresentação:

     - hierarquia de severidade clara (0 informação · 1 atenção · 2 crítico),
       usando exatamente a mesma escala numérica que o resto do jogo já
       manda em `sev` — nada que chama push() precisa mudar;
     - agrupamento por `key` (já existia) com janelas mais longas para
       eventos de baixa importância e mais curtas para críticos, para não
       "engolir" um segundo alerta grave;
     - duração do toast proporcional à severidade, e crítico não some
       sozinho — só quando o jogador reconhece (clique) ou dispensa;
     - histórico com os mesmos campos de sempre (hora do jogo, tipo,
       mensagem, severidade), limitado para não crescer sem controle;
     - `act()` continua usando a navegação já existente (abas + seleção em
       World.selected) — nenhum sistema de seleção novo é criado;
     - API pública preservada: push, scan, render, markAllRead, markRead,
       clear, openCenter, updateBadge, act. `dismiss` e `notify` são novas
       e puramente aditivas, para módulos futuros. */
const Notifications=(()=>{
  let seq=1, items=[], queue=[], shown=0, initialized=false;

  // Metadados de severidade: nome, rótulo curto para leitura e janela de
  // agrupamento (quanto tempo um novo evento com a mesma `key` só incrementa
  // o contador em vez de virar um toast novo). Crítico agrupa por menos
  // tempo — o jogador precisa ver cada ocorrência grave — enquanto avisos
  // menores (ex.: "veículo saiu") somam por mais tempo antes de reaparecer.
  const SEV=[
    {id:0,name:'informação', ttl:4200,  group:24000},
    {id:1,name:'atenção',    ttl:6500,  group:15000},
    {id:2,name:'crítico',    ttl:0,     group:5000}, // ttl 0 = não some sozinho
  ];
  const sevMeta=s=>SEV[Math.max(0,Math.min(SEV.length-1,s|0))];

  const icon={agreement:'🤝',territory:'🏳️',threat:'⚠️',police:'🚨',economy:'💵',vehicle:'🚐',system:'ℹ️',event:'📰'};
  const defaultTitle={agreement:'Coordenação',territory:'Território',threat:'Ameaça',police:'Polícia',economy:'Economia',vehicle:'Veículo',system:'Sistema',event:'Acontecimento'};

  // ---- estilo (auto-injetado uma única vez; puramente visual/aditivo) ----
  let stylesReady=false;
  function ensureStyles(){
    if(stylesReady) return; stylesReady=true;
    if(document.getElementById('notifSysStyle')) return;
    const css=`
      #notifToasts{display:flex;flex-direction:column;gap:8px;}
      .ntoast{opacity:0;transform:translateX(18px);transition:opacity .22s ease,transform .22s ease;}
      .ntoast.nshow{opacity:1;transform:translateX(0);}
      .ntoast.nleave{opacity:0;transform:translateX(18px);}
      .ntoast.sev2{box-shadow:0 0 0 1px rgba(226,102,75,.55) inset;}
      .ntoast .nclose{float:right;opacity:.55;cursor:pointer;font-size:12px;line-height:1;margin-left:8px;}
      .ntoast .nclose:hover{opacity:1;}
      .ntoast.nbump{animation:nbumpKf .32s ease;}
      @keyframes nbumpKf{0%{transform:scale(1);}35%{transform:scale(1.035);}100%{transform:scale(1);}}
      .nrow{transition:background-color .18s ease;}
      .nrow.unread{position:relative;}
      .nrow.unread::before{content:'';position:absolute;left:-9px;top:14px;width:6px;height:6px;border-radius:50%;background:#e8b84b;}
      .nrow.sev2.unread::before{background:#e2664b;}
      .nrow .ndismiss{opacity:.55;cursor:pointer;font-size:11px;margin-left:8px;}
      .nrow .ndismiss:hover{opacity:1;}
      #notifBadge.critical{background:#e2664b;}
    `.trim();
    const st=document.createElement('style'); st.id='notifSysStyle'; st.textContent=css;
    document.head.appendChild(st);
  }

  /* `act` (opcional): {label, tab, tid} — transforma o aviso em decisão. O
     botão leva direto à aba (e ao território) relevante para agir. Reusa
     exatamente a seleção/navegação por abas que o jogo já tem. */
  function runAct(a){
    if(!a) return;
    if(a.tid && World.ix[a.tid]) World.selected=a.tid;
    const btn=document.querySelector(`#tabs button[data-tab="${a.tab||'terr'}"]`);
    if(btn) btn.click();
  }
  function act(id){
    const n=items.find(x=>x.id===id); if(!n||!n.act) return;
    n.read=true; updateBadge(); runAct(n.act);
  }

  function push(type,title,msg,sev=0,key='',actn=null){
    ensureStyles();
    const s=sevMeta(sev).id;
    const now=Date.now();
    const win=sevMeta(s).group;
    const existing=key&&items.find(x=>x.key===key&&now-x.ts<win);
    if(existing){
      existing.count=(existing.count||1)+1; existing.ts=now;
      // se o texto mudou (ex.: quantidade/estado diferente), atualiza — sem
      // criar um segundo item de histórico para o mesmo acontecimento.
      existing.msg=msg; existing.title=title;
      bumpToast(existing);
      updateBadge();
      return existing;
    }
    const n={id:seq++,type,title,msg,sev:s,key,ts:now,gameH:World.h,read:false,count:1,act:actn};
    items.unshift(n); if(items.length>80) items.length=80;
    // Aviso sonoro puramente aditivo: só toca se js/audio/audio-engine.js foi
    // carregado (PenAudio global). Nenhuma regra de notificação muda aqui —
    // a severidade `s` já existente só escolhe qual efeito tocar.
    if(typeof window!=='undefined' && window.PenAudio) window.PenAudio.sfx(s>=2?'notify_crit':s===1?'notify_attn':'notify_info');
    queue.push(n); pump(); updateBadge(); return n;
  }

  // Ponto de entrada simples para outros módulos que só querem "avisar algo"
  // sem conhecer título padrão, ícone ou severidade — reduz o acoplamento
  // com a apresentação. Continua chamando push() por baixo; não substitui a
  // API existente, só simplifica o caso comum.
  function notify(type,msg,opts={}){
    const title=opts.title||defaultTitle[type]||'Aviso';
    return push(type,title,msg,opts.sev??0,opts.key||'',opts.act||null);
  }

  function toastBody(n){
    const s=sevMeta(n.sev);
    const label=n.count>1?` ×${n.count}`:'';
    const hint=n.act?`Toque para: ${n.act.label}`:(s.id>=2?'Toque para reconhecer':'Toque para abrir Avisos');
    return `<span class="nclose" data-nclose="${n.id}" title="Dispensar">✕</span>`+
      `<div class="ntitle">${icon[n.type]||'🔔'} ${n.title}${label}</div>`+
      `<div class="nmsg">${n.msg}</div><div class="nmeta">${hint}</div>`;
  }

  function bumpToast(n){
    const el=document.querySelector(`.ntoast[data-nid="${n.id}"]`);
    if(!el) return; // não está mais visível — só o histórico foi atualizado
    el.innerHTML=toastBody(n);
    el.classList.remove('nbump'); void el.offsetWidth; el.classList.add('nbump');
  }

  function closeToast(el,cb){
    if(!el||!el.isConnected){ cb&&cb(); return; }
    el.classList.remove('nshow'); el.classList.add('nleave');
    setTimeout(()=>{ el.remove(); cb&&cb(); },200);
  }

  function pump(){
    if(shown>=3||!queue.length) return;
    const n=queue.shift(); if(!n) return; shown++;
    const box=document.getElementById('notifToasts'); if(!box){shown--;return;}
    const s=sevMeta(n.sev);
    const el=document.createElement('div'); el.className=`ntoast sev${n.sev}`; el.dataset.nid=n.id;
    el.innerHTML=toastBody(n);
    el.onclick=(ev)=>{
      if(ev.target&&ev.target.dataset&&ev.target.dataset.nclose){
        n.read=true; updateBadge(); closeToast(el,()=>{shown--;pump();}); return;
      }
      n.read=true; updateBadge(); if(n.act) runAct(n.act); else openCenter();
      closeToast(el,()=>{shown--;pump();});
    };
    box.appendChild(el);
    requestAnimationFrame(()=>el.classList.add('nshow'));
    if(s.ttl>0){
      setTimeout(()=>{ if(!el.isConnected)return; closeToast(el,()=>{shown--;pump();}); },s.ttl);
    }
    // severidade crítica (ttl 0) permanece até o jogador clicar ou dispensar
  }

  // Fecha um toast específico (ou só marca como lido, se já não estiver
  // visível) sem apagar o histórico — usado pelo botão "✕" e disponível
  // para outros módulos que queiram limpar um aviso pontualmente.
  function dismiss(id){
    const n=items.find(x=>x.id===id); if(n){n.read=true;}
    const el=document.querySelector(`.ntoast[data-nid="${id}"]`);
    if(el) closeToast(el,()=>{shown=Math.max(0,shown-1);pump();});
    updateBadge();
  }

  function updateBadge(){
    const unread=items.filter(x=>!x.read).length;
    const unreadCritical=items.some(x=>!x.read&&x.sev>=2);
    const b=document.getElementById('notifBadge'), t=document.getElementById('tabNotifCount'), m=document.getElementById('tabMarketCount');
    if(b){b.textContent=unread>99?'99+':unread;b.style.display=unread?'inline-flex':'none';b.classList.toggle('critical',unreadCritical);}
    if(t){t.textContent=unread?` ${unread>9?'9+':unread}`:'';}
    const pending=(typeof PurchaseOffers!=='undefined')?PurchaseOffers.available().length:0;
    if(m){m.textContent=pending?` ${pending>9?'9+':pending}`:'';m.className=pending?'tabBadge':'';}
  }
  function markAllRead(){items.forEach(x=>x.read=true);updateBadge();}
  function markRead(id){const n=items.find(x=>x.id===id); if(n&&!n.read){n.read=true;updateBadge();}}
  function clear(){items=[];queue=[];shown=0;initialized=false;scan.owners=null;scan.events=new Set();scan.lastMoneyOK=true;scan.lastHeat=0;updateBadge();}
  function openCenter(){
    const tab=document.querySelector('#tabs button[data-tab="notif"]'); if(tab) tab.click();
  }
  function render(){
    const arr=items.slice(0,40);
    if(!arr.length) return `<div class="hint">Nenhuma notificação ainda. Acordos, mudanças territoriais, ameaças, problemas logísticos e acontecimentos importantes aparecerão aqui.</div>`;
    return arr.map(n=>{
      const s=sevMeta(n.sev);
      const time=`Dia ${Math.floor(n.gameH/24)+1} · ${String(Math.floor(n.gameH%24)).padStart(2,'0')}:${String(Math.floor((n.gameH%1)*60)).padStart(2,'0')}`;
      return `<div class="nrow sev${n.sev} ${n.read?'':'unread'}" data-nid="${n.id}" title="${s.name}">`+
        `<div class="nicon">${icon[n.type]||'🔔'}</div>`+
        `<div class="nbody">`+
          `<div class="ntitle">${n.title}${n.count>1?` ×${n.count}`:''}</div>`+
          `<div class="nmsg">${n.msg}</div>`+
          `${n.act?`<button type="button" data-nact="${n.id}" style="margin-top:5px">${n.act.label}</button>`:''}`+
          `<div class="ntime">${time}<span class="ndismiss" data-ndismiss="${n.id}">dispensar</span></div>`+
        `</div></div>`;
    }).join('');
  }
  function scan(){
    if(!World.fac.length) return;
    if(!initialized){ initialized=true; return; }
    // Novos pedidos recebidos ou respostas aos pedidos enviados.
    for(const r of World.coordination.requests){
      if(r.to===0 && r.state==='pendente') push('agreement','Nova proposta recebida',`${World.fac[r.from].short} ${Coord.describe(r)}.` ,1,`req-in-${r.id}`);
      if(r.from===0 && r.state==='aceita') push('agreement','Acordo aceito',`${World.fac[r.to].short} aceitou sua proposta.`,0,`req-ok-${r.id}`);
      if(r.from===0 && r.state==='recusada') push('agreement','Proposta recusada',`${World.fac[r.to].short} recusou sua proposta.`,1,`req-no-${r.id}`);
    }
    // Mudanças de território.
    if(!scan.owners) scan.owners={};
    for(const t of World.terr){
      const old=scan.owners[t.id];
      if(old!==undefined && old!==t.owner){
        if(t.owner===0) push('territory','Nova comunidade sob seu controle',`${t.name} passou para sua firma.`,0,`own-${t.id}-${World.h}`);
        else if(old===0 && t.owner!==0) push('territory','Perda territorial',`${t.name} saiu do seu controle e passou para ${t.owner==null?'controle indefinido':World.fac[t.owner].short}.`,2,`lost-${t.id}-${World.h}`);
      }
      scan.owners[t.id]=t.owner;
    }
    // Operações rivais mirando o jogador.
    for(const op of World.ops){
      if(World.ix[op.to]?.owner===0 && op.f!==0) push('threat','Movimentação rival',`${World.fac[op.f].short} está preparando uma operação em ${World.ix[op.to].name}.`,2,`op-${op.id}`);
    }
    // Polícia, veículos e caixa — apenas mudanças de estado relevantes.
    const f=World.fac[0];
    if(f.heat>=CONF.raidAt && (scan.lastHeat||0)<CONF.raidAt) push('police','Pressão policial crítica',`A pressão chegou a ${Math.round(f.heat)}%. Prepare-se para uma possível operação.`,2,'heat-critical');
    if(f.money<World.upkeep(0)*20 && (scan.lastMoneyOK!==false)) push('economy','Caixa em risco','A reserva cobre menos de 20 horas de custeio.',2,'cash-low');
    scan.lastMoneyOK=f.money>=World.upkeep(0)*20; scan.lastHeat=f.heat;
    for(const v of World.veh.filter(x=>x.f===0)){
      if((v.note==='sem combustível'||v.note==='sem combustível na estrada') && v._notifNote!==v.note){ push('vehicle','Carro de apoio parado',`${VEHICLES[v.kind].name} #${v.id} ficou sem combustível.`,2,`fuel-${v.id}-${v.note}`); v._notifNote=v.note; }
      if((v.condition||100)<25 && !v._notifWear){ push('vehicle','Carro precisa de manutenção',`${VEHICLES[v.kind].name} #${v.id} está com ${Math.round(v.condition)}% de condição.`,1,`wear-${v.id}`); v._notifWear=true; }
    }
    // Eventos do mundo.
    if(!scan.events) scan.events=new Set();
    for(const e of World.events){ if(!scan.events.has(e.id)){ scan.events.add(e.id); if(!e.silent) push('event',e.name,e.desc,0,`event-${e.id}`); } }
    updateBadge();
  }
  return {push,notify,scan,render,markAllRead,markRead,clear,openCenter,updateBadge,act,dismiss};
})();
