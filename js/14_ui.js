/* ================================== UI ================================== */
const UI=(()=>{
  const $=id=>document.getElementById(id);
  let tab='terr', opCount=1, routeWiz=null, bannerT=0, opDraft=null;

  function log(html,cls){
    const d=document.createElement('div');
    const day=Math.floor(World.h/24)+1;
    d.innerHTML=`<span style="opacity:.55">D${day} </span>`+(cls?`<span class="${cls}">${html}</span>`:html);
    $('log').prepend(d); while($('log').children.length>60)$('log').lastChild.remove();
  }
  function banner(txt){ const b=$('banner'); b.textContent=txt; b.style.display='block'; bannerT=World.h+8; }
  const n0=v=>Math.round(v).toLocaleString('pt-BR');
  const money=v=>'$'+n0(v);

  function hud(){
    const f=World.fac[0];
    if(bannerT&&World.h>bannerT){ $('banner').style.display='none'; bannerT=0; }
    const day=Math.floor(World.h/24)+1, hh=Math.floor(World.h%24), mm=Math.floor((World.h%1)*60);
    $('clock').textContent=`Dia ${day} · ${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
    $('rMoney').textContent=money(f.money);
    {const gt=Greed.tier(0); $('rNet').textContent=`−${n0(World.upkeep(0))}/h de custeio${gt?` · cobiça ${gt}`:''}`;}
    $('rTerr').textContent=`${World.owned(0).length}/${World.terr.length}`;
    $('rUnits').textContent=World.units.filter(u=>u.f===0).length+'+'+World.veh.filter(v=>v.f===0).length;
    $('heatFill').style.width=(f.heat/CONF.heatMax*100)+'%';
    $('heatTxt').textContent=Math.round(f.heat)+'%';
  }

  /* ---------- aba Território ---------- */
  function terrPanel(){
    const f=World.fac[0], t=World.selected?World.ix[World.selected]:null, p=$('panel');
    if(!t){
      $('selName').textContent='Península';
      $('selSub').textContent='Selecione um território no mapa.';
      p.innerHTML=`<div class="hint"><p><b>O ciclo</b></p>
        <p>Bocas de chegada compram <b>insumo</b>, <b>combustível</b> e <b>munição</b> do abastecimento externo.
        Oficinas transformam insumo em carga. Sítios produzem Maconha.
        Bocas escoam o que estiver <i>fisicamente</i> em estoque ali — nada aparece no destino sozinho.</p>
        <p>Carro de apoios levam horas na estrada e queimam combustível do estoque de origem.
        Influência vem de vapores presentes; território sem presença escapa do seu controle.</p>
        <p>Operações militares exigem munição posicionada e 14 h de preparação. Elas custam caro e deixam desordem por dias.</p></div>`;
      return;
    }
    const own=t.owner==null?'Sem controle definido':World.fac[t.owner].name;
    const col=t.owner==null?TYPES[t.type].color:World.fac[t.owner].color;
    $('selName').innerHTML=`<span class="tag" style="background:${col}"></span>${t.name}`;
    $('selSub').textContent=`${TYPES[t.type].name} · ${own}${t.island?' · ilha':''}`;

    let h='';
    h+=`<div class="block"><h3>Perfil</h3>
      <div class="row"><span>População</span><b>${n0(t.pop)}</b></div>
      <div class="row"><span>Infraestrutura</span><b>nível ${t.infra}</b></div>
      <div class="row"><span>Valor estratégico</span><b>${'★'.repeat(t.val)}</b></div>
      <div class="row"><span>Desordem</span><b class="${t.unrest>25?'warn':''}">${Math.round(t.unrest)}%</b></div>
      <div class="row"><span>Custeio estimado</span><b>${money(t.pop/1000*1.9+t.infra*2.2)}/h</b></div>`;
    {const tags=City.tagsFor(t); if(tags.length) h+=`<div style="margin:4px 0">${tags.map(x=>`<span class="chip">📰 ${x}</span>`).join(' ')}</div>`;}
    for(let i=0;i<4;i++) if(t.inf[i]>1)
      h+=`<div class="row"><span><span class="tag" style="background:${World.fac[i].color}"></span>Influência ${World.fac[i].short}</span><b>${Math.round(t.inf[i])}%</b></div>`;
    h+=`<div class="hint" style="margin-top:6px">${TYPES[t.type].desc}</div></div>`;

    h+=`<div class="block"><h3>Estoque ${Math.round(World.load(t))}/${World.cap(t)}</h3>`;
    for(const g of GK) h+=`<div class="row"><span><span class="tag" style="background:${GOODS[g].color}"></span>${GOODS[g].name}</span><b>${t.stock[g].toFixed(1)}</b></div>`;
    h+=`<div class="bar"><i style="width:${Math.min(100,World.load(t)/World.cap(t)*100)}%;background:${World.load(t)>World.cap(t)*.9?'var(--red)':'var(--green)'}"></i></div></div>`;
    if(t.buildings.ponto){
      const pl=SELLABLE.reduce((s,g)=>s+t.pointStock[g],0);
      h+=`<div class="block"><h3>◉ Boca de distribuição · ${pl.toFixed(0)}/${t.pointCap||80}</h3>`;
      for(const g of SELLABLE){
        const pm=t.priceMult?.[g]||1;
        const pr=GOODS[g].base*t.price[g]*pm*(0.8+t.val*0.14);
        const tag=pm>1.12?' <span class="warn">acima do mercado</span>':pm<0.9?' <span style="color:var(--green)">promocional</span>':'';
        h+=`<div class="row"><span>${GOODS[g].name}</span><b>${t.pointStock[g].toFixed(1)} · ${t.demand[g].toFixed(2)}/h · ${money(pr)}${tag}</b></div>`;
        if(t.owner===0){
          h+=`<div class="btnrow" style="margin:2px 0 6px">
            <button data-dist="${g}" data-dq="20" ${t.stock[g]<=0||t.pointStock[g]>=80?'disabled':''}>Distribuir 20</button>
            <button data-dist="${g}" data-dq="80" ${t.stock[g]<=0||t.pointStock[g]>=80?'disabled':''}>Encher</button>
          </div>
          <div class="btnrow" style="margin:2px 0 8px">
            <button data-price="${g}" data-pd="-0.1" ${pm<=0.55?'disabled':''}>Preço −</button>
            <span style="align-self:center;font-size:12px;color:var(--muted)">markup ${Math.round(pm*100)}%</span>
            <button data-price="${g}" data-pd="0.1" ${pm>=1.75?'disabled':''}>Preço +</button>
          </div>`;
        }
      }
      h+=`<div class="row"><span>Pressão local</span><b>${Math.round(t.heat||0)}%</b></div><div class="hint">A carga no estoque do território não gera receita. Só a carga dentro da Boca é vendida conforme a demanda local. Preço acima do mercado rende mais por unidade mas vende mais devagar e gera desordem; preço abaixo vende mais rápido com margem menor.</div></div>`;
    }

    if(t.type==='porto'&&t.owner===0){
      h+=`<div class="block"><h3>Compra no abastecimento externo</h3>`;
      for(const g of ['insumo','quimico','fuel','ammo','armas'])
        {const pp=Econ.portPrice(t,g), hot=pp>GOODS[g].buy;
        const quota=Math.floor(Scarcity.importStock(t,g)), sc=Scarcity.state(g), off=sc&&sc.phase==='active';
        const tagTxt=off?` <span class="warn">EM FALTA — volta em ~${Math.ceil(sc.s.until-World.h)} h</span>`
          :sc?` <span class="warn">vai faltar em ~${Math.ceil(sc.s.startH-World.h)} h</span>`
          :(hot?' <span class="warn">(+'+Math.round((pp/GOODS[g].buy-1)*100)+'% vs. base)</span>':'');
        const dis=q=>(off||f.money<pp*q||quota<=0)?'disabled':'';
        h+=`<div class="item"><div><div class="nm">${GOODS[g].name}</div><div class="ct">${off?'sem venda':money(pp)+' por unidade'}${tagTxt}<br>cota do porto: <b class="${quota<Scarcity.QUOTA_CAP*0.25?'warn':''}">${quota}/${Scarcity.QUOTA_CAP}</b></div></div>
          <div class="btnrow"><button data-buy="${g}" data-q="25" ${dis(Math.min(25,Math.max(1,quota)))}>25</button>
          <button data-buy="${g}" data-q="100" ${dis(Math.min(100,Math.max(1,quota)))}>100</button></div></div>`;}
      h+=`<div class="hint">Cada porto tem uma <b>cota</b> finita de cada bem importado, que se recompõe devagar. Quanto mais vazia, mais caro. Em escassez externa o bem some dos portos por um período.</div></div>`;
      const offers=Supply.list();
      h+=`<div class="block"><h3>📦 Ofertas de abastecimento</h3>`;
      if(!offers.length) h+=`<div class="hint">Nenhuma oferta disponível agora. Novas oportunidades aparecem ao longo da partida.</div>`;
      for(const o of offers){
        const total=o.qty*o.unitPrice;
        const mins=Math.max(0,Math.ceil((o.expires-World.h)));
        h+=`<div class="item"><div><div class="nm"><span class="tag" style="background:${GOODS[o.good].color}"></span>${GOODS[o.good].name}</div><div class="ct">${o.qty} un. · ${money(o.unitPrice)}/un. · total ${money(total)}<br>Oferta expira em ~${mins} h de jogo.</div></div><button data-supply="${o.id}" ${f.money<total||World.cap(t)-World.load(t)<o.qty?'disabled':''}>Aceitar</button></div>`;
      }
      h+=`<div class="hint">As ofertas são uma mecânica abstrata de abastecimento do jogo. Depois de recebida na Boca de chegada, a carga precisa ser transportada até os territórios e distribuída para uma Boca para gerar receita.</div></div>`;
    }
    const totDem=SELLABLE.reduce((s,g)=>s+(t.demand[g]||0),0);
    if(totDem>0.2){
      h+=`<div class="block"><h3>Demanda local</h3>`;
      for(const g of SELLABLE){ if(!t.demand[g]) continue;
        const pr=GOODS[g].base*t.price[g]*(0.8+t.val*0.14);
        h+=`<div class="row"><span><span class="tag" style="background:${GOODS[g].color}"></span>${GOODS[g].name}</span>
          <b>${t.demand[g].toFixed(2)}/h · ${money(pr)}${t.price[g]<0.85?' <span class="warn">saturado</span>':''}</b></div>`; }
      h+=`</div>`;
    }

    if(t.factory){
      const fb=FACTORIES[t.factory.kind], active=t.owner!==null, lvl=t.factory.level||1;
      const inputsTxt=(fb.inputs&&fb.inputs.length)
        ? fb.inputs.map(i=>`${Math.round(t.stock[i.good]||0)} ${GOODS[i.good].name}${t.factory.bottleneck===i.good?' <span class="warn">(gargalo)</span>':''}`).join(' + ')
        : 'sem insumo — produção própria';
      const output=`${Math.round(t.factory.lastOutput||0)} ${GOODS[fb.output].name} neste ciclo`;
      h+=`<div class="factoryCard"><div class="factoryHead"><div class="factoryTitle"><div class="factoryIcon">${fb.icon}</div><div><b>${fb.name}</b><small>${active?'Ativa com '+World.fac[t.owner].short:'inativa enquanto o território estiver sem domínio'}</small></div></div><span class="chip">Nível ${lvl}/5</span></div><div class="factoryStats"><div class="factoryStat"><span>Produção</span><b>${output}</b></div><div class="factoryStat"><span>Insumos</span><b>${inputsTxt}</b></div></div><div class="factoryDependency"><strong>Dependência territorial:</strong> ${t.name} é o único lugar da Península onde essa conversão acontece. Sem os insumos certos chegando por transporte ou comércio, ela roda travada — pagando custeio sem produzir.</div>${t.owner===0&&lvl<5?`<button data-factory-upgrade="1" style="width:100%;margin-top:8px">Ampliar fábrica · ${money(2600*lvl)}</button>`:''}</div>`;
    }

    if(t.owner===0){
      if(t.works.length){
        h+=`<div class="block"><h3>Fila de obras (sequencial)</h3>`;
        t.works.forEach((w,i)=>{
          const nm=w.type==='build'?BUILD[w.k].name:w.type==='unit'?UNITS[w.k].name:w.type==='veh'?VEHICLES[w.k].name:w.type==='factory'?'Ampliação de fábrica':'Infraestrutura';
          h+=`<div class="row"><span>${nm}${i>0?' <small style="color:var(--muted)">(na fila)</small>':''}</span>
            <b>${i===0?Math.ceil(w.need-w.p)+' h':'aguarda a anterior'}</b></div>`;
        });
        h+=`</div>`;
      }
      h+=`<div class="block"><h3>Construir</h3>`;
      for(const b in BUILD){ const B=BUILD[b],done=t.buildings[b];
        h+=`<div class="item"><div><div class="nm">${B.icon} ${B.name}${done?' ✓':''}</div>
          <div class="ct">${money(B.cost)} · ${B.hours} h · custeio ${money(B.upkeep)}/h<br>${B.desc}</div></div>
          <button data-bld="${b}" ${done||f.money<B.cost?'disabled':''}>Iniciar</button></div>`; }
      if(t.infra<5) h+=`<div class="item"><div><div class="nm">Ampliar infraestrutura</div>
        <div class="ct">${money(2200*t.infra)} · ${16*t.infra} h · +capacidade, +produção, +custeio</div></div>
        <button data-infra="1" ${f.money<2200*t.infra?'disabled':''}>Ampliar</button></div>`;
      h+=`</div>`;

      const canUnit=t.buildings.ponto||t.buildings.refugio;
      h+=`<div class="block"><h3>Pessoal ${canUnit?'':'(exige Boca ou Refúgio)'}</h3>`;
      for(const k in UNITS){ const U=UNITS[k];
        h+=`<div class="item"><div><div class="nm">${U.icon} ${U.name}</div>
          <div class="ct">${money(U.cost)} · ${U.hours} h · custeio ${money(U.upkeep)}/h</div></div>
          <button data-unit="${k}" ${!canUnit||f.money<U.cost?'disabled':''}>Recrutar</button></div>`; }
      h+=`</div>`;
      if(t.buildings.garagem){
        h+=`<div class="block"><h3>Garagem</h3>`;
        for(const k in VEHICLES){ const V=VEHICLES[k];
          h+=`<div class="item"><div><div class="nm">${V.icon} ${V.name}</div>
            <div class="ct">${money(V.cost)} · ${V.hours} h · carga ${V.cap} · ${V.sea?'marítimo':'terrestre'}</div></div>
            <button data-veh="${k}" ${f.money<V.cost?'disabled':''}>Montar</button></div>`; }
        h+=`</div>`;
      }
    }

    const here=World.units.filter(u=>u.loc===t.id);
    h+=`<div class="block"><h3>Presença</h3>`;
    if(!here.length) h+=`<div class="hint">Ninguém no território. Sem vapores a influência cai.</div>`;
    else{
      const mineHere=here.filter(u=>u.f===0), rivalHere=here.filter(u=>u.f!==0);
      if(rivalHere.length){
        const g={};
        for(const u of rivalHere){ const k=`${u.f}:${u.kind}:${u.state==='prep'?'p':'i'}`; g[k]=(g[k]||0)+1; }
        for(const k in g){ const [fid,kind,st]=k.split(':');
          h+=`<span class="chip">${UNITS[kind].icon} ${g[k]}× ${UNITS[kind].name} · ${World.fac[+fid].short}${st==='p'?' (preparando)':''}</span>`; }
      }
      if(mineHere.length){
        h+=`<div style="display:flex;flex-direction:column;gap:6px;margin-top:${rivalHere.length?'8px':'0'}">`;
        for(const u of mineHere){
          const cargo=Personnel.cargoName(u), nxt=Personnel.eligiblePromotion(u);
          const equipTxt=(u.inventory||[]).map(id=>{
             const item = World.items?.find(i=>i.id===id);
             return item ? Personnel.ITEMS[item.key]?.name : id;
          }).join(', ');
          
          const avail = (World.items||[]).filter(i => i.loc === t.id && !i.equippedBy && i.owner === 0);
          const validAvail = avail.filter(i => {
             const it = Personnel.ITEMS[i.key];
             return (!it.kind || it.kind===u.kind) && (u.rank||0)>=(it.minRank||0);
          });
          
          h+=`<div class="item"><div>
              <div class="nm">${UNITS[u.kind].icon} ${u.name} <small>· ${cargo}${u.state==='prep'?' (preparando)':''}</small></div>
              <div class="ct">Exp ${Math.round(u.exp||0)} · Lealdade ${Math.round(u.loyalty??60)}% · Desempenho ${Math.round(u.performance||0)}${equipTxt?` · Equip.: ${equipTxt}`:''}</div>
            </div>
            <div class="btnrow" style="flex-wrap:wrap;gap:4px">
              ${nxt?`<button data-promote="${u.id}">Promover → ${nxt.name}</button>`:''}
              ${validAvail.length?`<select data-equipsel="${u.id}">${validAvail.map(i=>`<option value="${i.id}">${Personnel.ITEMS[i.key].name} (Condição: ${Math.round(i.condition)}%)</option>`).join('')}</select><button data-equipbtn="${u.id}">Equipar</button>`:''}
              ${(u.inventory||[]).map(id=>{
                 const item = World.items?.find(i=>i.id===id);
                 const name = item ? Personnel.ITEMS[item.key]?.name : id;
                 return `<button data-unequip="${u.id}:${id}" class="ghost">− ${name}</button>`;
              }).join('')}
              <button data-fire="${u.id}" class="ghost">Dispensar</button>
            </div></div>`;
        }
        h+=`</div>`;
      }
    }
    h+=`</div>`;

    if(t.owner===0){
       h+=`<div class="block"><h3>Fabricação de Equipamentos</h3>`;
       const availableToCraft = Object.entries(Personnel.ITEMS);
       for(const [k, it] of availableToCraft){
          const canCraft = f.money >= it.cost && (t.stock.armas||0) >= (it.reqArmas||0);
          h+=`<div class="item"><div><div class="nm">${it.name}</div><div class="ct">Custo: ${money(it.cost)} ${it.reqArmas ? `+ ${it.reqArmas} Armamentos` : ''}<br>Efeito: ${it.atk?`ATK +${it.atk} `:''}${it.def?`DEF +${it.def} `:''}${it.mob?`MOB +${it.mob} `:''}${it.prec?`PREC +${it.prec} `:''}</div></div><button data-craft="${k}" ${!canCraft?'disabled':''}>Fabricar</button></div>`;
       }
       const unequipped = (World.items||[]).filter(i => i.loc === t.id && !i.equippedBy && i.owner === 0);
       if(unequipped.length){
          h+=`<div class="hint" style="margin-top:6px"><b>No chão (Armazenado aqui):</b> ${unequipped.map(i => Personnel.ITEMS[i.key]?.name).join(', ')}</div>`;
       }
       h+=`</div>`;
    }

    // movimentação de pessoal
    if(t.owner===0){
      const idle=World.at(t.id,0);
      h+=`<div class="block"><h3>Deslocar pessoal</h3>
        <div class="hint">Selecione o destino clicando no mapa com o botão de envio ativo.</div>
        <div class="btnrow" style="margin-top:6px">
        <button id="sendOp" ${idle.some(u=>u.kind==='vapor')?'':'disabled'} class="${moveMode==='vapor'?'on':''}">Enviar vapor</button>
        <button id="sendSeg" ${idle.some(u=>u.kind==='seguranca')?'':'disabled'} class="${moveMode==='seguranca'?'on':''}">Enviar contenção</button></div></div>`;
    }

    // operação — ordem em dois estágios: rascunho (revisar) e confirmação
    const advOwn=t.neighbors.filter(n=>World.ix[n].owner===0);
    if(t.owner!==0 && advOwn.length){
      if(!opDraft || opDraft.to!==t.id) opDraft={to:t.id, from:advOwn.sort((a,b)=>World.at(b,0,'seguranca').length-World.at(a,0,'seguranca').length)[0]};
      const srcOptions=advOwn;
      const q=Ops.quote(0, opDraft.from, t.id, opCount);
      h+=`<div class="block"><h3>Ordem de operação — ${t.name}</h3>`;
      if(srcOptions.length>1){
        h+=`<div class="row"><span>Boca de concentração</span>
          <select id="opSrc" style="background:#1a3b43;color:var(--text);border:1px solid #2b5964;border-radius:4px;padding:3px">`;
        for(const s of srcOptions) h+=`<option value="${s}" ${s===opDraft.from?'selected':''}>${World.ix[s].name}</option>`;
        h+=`</select></div>`;
      } else h+=`<div class="row"><span>Boca de concentração</span><b>${World.ix[opDraft.from].name}</b></div>`;
      h+=`<div class="row"><span>Rota</span><b>${World.ix[opDraft.from].name} → ${t.name} (${q.hops??'?'} trecho)</b></div>
        <div class="item" style="margin-top:2px"><div class="ct">Pessoal a enviar</div>
          <div class="btnrow"><button id="opMinus">−</button><b>${opCount}</b><button id="opPlus">+</button></div></div>
        <div class="row"><span>Disponíveis na origem</span><b class="${q.availPersonnel<opCount?'warn':''}">${q.availPersonnel??0}</b></div>
        <div class="row"><span>Munição exigida</span><b class="${World.ix[opDraft.from].stock.ammo<q.ammo?'warn':''}">${q.ammo} <small>(estoque: ${World.ix[opDraft.from].stock.ammo.toFixed(0)})</small></b></div>
        <div class="row"><span>Combustível exigido</span><b class="${World.ix[opDraft.from].stock.fuel<q.fuel?'warn':''}">${q.fuel} <small>(estoque: ${World.ix[opDraft.from].stock.fuel.toFixed(0)})</small></b></div>
        <div class="row"><span>Tempo de preparação</span><b>${Ops.PREP_HOURS} h + marcha</b></div>`;
      h+=`<div class="hint" style="margin:6px 0 4px"><b>Estado atual do alvo</b></div>
        <div class="row"><span>Controle</span><b>${q.target.owner==null?'sem dono':World.fac[q.target.owner].short}</b></div>
        <div class="row"><span>Defensores (contenção)</span><b>${q.target.defenders}</b></div>
        <div class="row"><span>Bônus de defesa</span><b>+${Math.round(q.target.defBonus*100)}%</b></div>
        <div class="row"><span>Desordem local</span><b>${q.target.unrest}%</b></div>`;
      if((t.vacuoUntil||0)>World.h) h+=`<div class="hint" style="margin-top:6px"><b>Vácuo de poder:</b> a influência do dono está abalada por mais ~${Math.ceil(t.vacuoUntil-World.h)} h — janela favorável.</div>`;
      if(!q.ok) h+=`<div class="hint warn" style="margin-top:6px">${q.reason}</div>`;
      h+=`<button id="opGo" ${q.ok?'':'disabled'} style="width:100%;margin-top:8px">Confirmar e iniciar preparação (${Ops.PREP_HOURS} h)</button>
        <div class="hint" style="margin-top:6px">Ao confirmar, o pessoal fica imobilizado e a munição/combustível saem do estoque imediatamente. A situação do alvo pode mudar durante o preparo — revise antes de confirmar.</div></div>`;
    } else if(opDraft && opDraft.to===t.id){ opDraft=null; }
    p.innerHTML=h;

    p.querySelectorAll('[data-buy]').forEach(b=>b.onclick=()=>{
      const err=Econ.buy(t,b.dataset.buy,+b.dataset.q); if(err) log(err,'hit'); else log(`Compra de ${b.dataset.q} de ${GOODS[b.dataset.buy].name} em ${t.name}.`);
    });
    p.querySelectorAll('[data-supply]').forEach(b=>b.onclick=()=>{
      const err=Supply.accept(+b.dataset.supply,t.id);
      if(err) log(err,'hit'); else log('Oferta de abastecimento aceita e recebida no território.','win');
      panel();
    });
    p.querySelectorAll('[data-dist]').forEach(b=>b.onclick=()=>{
      const g=b.dataset.dist, q=+b.dataset.dq;
      const err=Econ.distribute(t,g,q);
      if(err) log(err,'hit'); else log(`${Math.round(q)} ${GOODS[g].name} distribuídas para a Boca de ${t.name}.`);
      panel();
    });
    p.querySelectorAll('[data-price]').forEach(b=>b.onclick=()=>{
      const g=b.dataset.price, cur=t.priceMult?.[g]||1;
      const err=Econ.setMarkup(t,g,cur+(+b.dataset.pd));
      if(err) log(err,'hit'); else log(`Preço de ${GOODS[g].name} em ${t.name} ajustado para ${Math.round((t.priceMult[g])*100)}% do mercado.`);
      panel();
    });
    const fu=p.querySelector('[data-factory-upgrade]'); if(fu) fu.onclick=()=>{const err=FactorySystem.upgrade(t);if(err)log(err,'hit');else log(`Ampliação da fábrica de ${t.name} iniciada.`,'win');panel();};
    p.querySelectorAll('[data-bld]').forEach(b=>b.onclick=()=>{
      const k=b.dataset.bld; if(f.money<BUILD[k].cost) return;
      f.money-=BUILD[k].cost; t.works.push({type:'build',k,p:0,need:BUILD[k].hours}); log(`Obra iniciada: ${BUILD[k].name} em ${t.name}.`);
    });
    const inf=p.querySelector('[data-infra]'); if(inf) inf.onclick=()=>{
      const c=2200*t.infra; if(f.money<c) return; f.money-=c;
      t.works.push({type:'infra',p:0,need:16*t.infra}); log(`Ampliação de infraestrutura em ${t.name}.`);
    };
    p.querySelectorAll('[data-unit]').forEach(b=>b.onclick=()=>{
      const k=b.dataset.unit; if(f.money<UNITS[k].cost) return;
      f.money-=UNITS[k].cost; t.works.push({type:'unit',k,p:0,need:UNITS[k].hours}); log(`${UNITS[k].name} em formação em ${t.name}.`);
    });
    p.querySelectorAll('[data-veh]').forEach(b=>b.onclick=()=>{
      const k=b.dataset.veh; if(f.money<VEHICLES[k].cost) return;
      f.money-=VEHICLES[k].cost; t.works.push({type:'veh',k,p:0,need:VEHICLES[k].hours}); log(`${VEHICLES[k].name} em montagem em ${t.name}.`);
    });
    const so=$('sendOp'), ss=$('sendSeg');
    if(so) so.onclick=()=>{ moveMode=moveMode==='vapor'?null:'vapor'; moveFrom=t.id; panel(); };
    if(ss) ss.onclick=()=>{ moveMode=moveMode==='seguranca'?null:'seguranca'; moveFrom=t.id; panel(); };
    p.querySelectorAll('[data-promote]').forEach(b=>b.onclick=()=>{
      const u=World.units.find(x=>x.id===+b.dataset.promote); if(!u) return;
      const err=Personnel.promote(u); if(err) log(err,'hit'); panel();
    });
    p.querySelectorAll('[data-fire]').forEach(b=>b.onclick=()=>{
      const u=World.units.find(x=>x.id===+b.dataset.fire); if(!u) return;
      Personnel.fire(u); panel();
    });
    p.querySelectorAll('[data-equipbtn]').forEach(b=>b.onclick=()=>{
      const id=+b.dataset.equipbtn, u=World.units.find(x=>x.id===id); if(!u) return;
      const sel=p.querySelector(`[data-equipsel="${id}"]`); if(!sel) return;
      const itemId = parseInt(sel.value);
      const item = World.items?.find(i => i.id === itemId);
      const err=Personnel.equip(u, itemId);
      if(err) log(err,'hit'); else log(`${u.name} equipado com ${Personnel.ITEMS[item.key].name}.`,'win');
      panel();
    });
    p.querySelectorAll('[data-unequip]').forEach(b=>b.onclick=()=>{
      const [idStr,itemIdStr]=b.dataset.unequip.split(':'); 
      const u=World.units.find(x=>x.id===+idStr); if(!u) return;
      const err=Personnel.unequip(u,parseInt(itemIdStr)); if(err) log(err,'hit'); panel();
    });
    p.querySelectorAll('[data-craft]').forEach(b=>b.onclick=()=>{
      const k = b.dataset.craft;
      const err = Personnel.craftItem(t.id, k, 0);
      if(err) log(err,'hit'); else log(`Fabricado: ${Personnel.ITEMS[k].name}.`,'win');
      panel();
    });
    const om=$('opMinus'),op=$('opPlus'),og=$('opGo'),os=$('opSrc');
    if(om) om.onclick=()=>{opCount=Math.max(1,opCount-1);panel();};
    if(op) op.onclick=()=>{opCount++;panel();};
    if(os) os.onchange=()=>{opDraft.from=os.value;panel();};
    if(og) og.onclick=()=>{
      const srcName=World.ix[opDraft.from].name;
      const err=Ops.plan(0,opDraft.from,t.id,opCount);
      if(err) log(err,'hit'); else { log(`Operação sobre <b>${t.name}</b> confirmada e em preparação a partir de ${srcName}.`); banner(`Preparando operação · ${Ops.PREP_HOURS} h`); opDraft=null; }
      panel();
    };
  }

  /* ---------- aba Logística ---------- */
  function logiPanel(){
    const p=$('panel');
    $('selName').textContent='Logística';
    $('selSub').textContent='Carro de apoios, rotas e carga em trânsito.';
    const mine=World.veh.filter(v=>v.f===0);
    let h='';
    if(routeWiz){
      h+=`<div class="block"><h3>Nova rota — ${VEHICLES[World.veh.find(v=>v.id===routeWiz.veh).kind].name}</h3>`;
      if(!routeWiz.a) h+=`<div class="hint">Clique no mapa no território de <b>origem</b> (de onde a carga sai).</div>`;
      else if(!routeWiz.b) h+=`<div class="hint">Origem: <b>${World.ix[routeWiz.a].name}</b>. Agora clique no <b>destino</b>.</div>`;
      else{
        h+=`<div class="hint">${World.ix[routeWiz.a].name} → ${World.ix[routeWiz.b].name}. Escolha a bocaria:</div><div class="btnrow" style="margin-top:7px">`;
        // Energia fica fora da lista: não é transportável (Logi.assign recusa
        // e a regra já vale para propostas de Coordenação — mantém consistente).
        for(const g of GK) if(g!=='energia') h+=`<button data-wg="${g}">${GOODS[g].ab}</button>`;
        h+=`</div>`;
      }
      h+=`<button id="wizCancel" style="margin-top:8px">Cancelar</button></div>`;
    }
    h+=`<div class="block"><h3>Carros de apoio (${mine.length})</h3>
      <div class="row"><span>Motoristas</span><b>${World.fac[0].drivers}/${mine.length}</b></div>
      <div class="row"><span>Gerentes</span><b>${World.fac[0].admins}</b></div>
      <div class="btnrow"><button id="hireDriver">Contratar motorista · $420</button><button id="hireAdmin">Contratar gerente · $520</button></div>
      <div class="hint">Cada carro de apoio precisa de motorista. Viagens desgastam a carros de apoio; carro de apoios parados podem entrar em manutenção.</div>`;
    if(!mine.length) h+=`<div class="hint">Sem carro de apoios. Construa uma Garagem e monte ao menos um.</div>`;
    for(const v of mine){
      const V=VEHICLES[v.kind];
      const where=v.loc!==null?World.ix[v.loc].name:'na estrada';
      const cg=GK.filter(g=>v.cargo[g]>0.4).map(g=>`${GOODS[g].ab} ${Math.round(v.cargo[g])}`).join(' ')||'vazio';
      const routeFuel=v.route&&v.loc!==null?Logi.requiredFuel(v,v.loc,v.route.b):0;
      const fuelCls=v.fuel<Math.max(5,V.fuelCap*.15)?'warn':'';
      h+=`<div class="item" style="align-items:flex-start"><div><div class="nm">${V.icon} ${V.name} #${v.id}</div>
        <div class="ct">${where} · carga ${cg} / ${V.cap}<br>
        combustível <b class="${fuelCls}">${v.fuel.toFixed(1)} / ${V.fuelCap}</b> · condição <b>${Math.round(v.condition||100)}%</b>${v.loc!==null?` · <span title="Estimativa para o destino atual">${routeFuel===Infinity?'—':routeFuel.toFixed(1)} necessário</span>`:''}
        ${v.route?`<br>rota ${World.ix[v.route.a].name} → ${World.ix[v.route.b].name} (${GOODS[v.route.good].ab})`:'<br>sem rota'}
        ${v.tradeId?`<br>movimento #${v.tradeId} em transporte` : ''}
        ${v.note?`<br><span class="warn">${v.note}</span>`:''}</div></div>
        <div class="btnrow">
          ${v.loc!==null&&v.fuel<V.fuelCap-0.1?`<button data-refuel="${v.id}">Abastecer</button>`:''}
          ${v.loc!==null&&(v.condition||100)<99&&!v.route?`<button data-repair="${v.id}">Manutenção</button>`:''}
          <button data-newroute="${v.id}">Rota</button>${v.route?`<button data-clr="${v.id}" class="danger">Parar</button>`:''}
        </div></div>`;
    }
    h+=`</div>`;
    h+=`<div class="block"><h3>Movimento entre firmas</h3>`;
    const myTrades=World.trades.filter(tr=>tr.seller===0&&tr.status!=='delivered'&&tr.status!=='cancelled');
    if(!myTrades.length) h+=`<div class="hint">Nenhum movimento comercial em andamento.</div>`;
    for(const tr of myTrades){
      const buyer=World.fac[tr.buyer], free=mine.flatMap(t=>World.veh.filter(v=>v.f===0&&v.loc===t.id&&!v.route));
      h+=`<div class="item" style="align-items:flex-start"><div>
        <div class="nm">${GOODS[tr.good].name} → ${buyer.short}</div>
        <div class="ct">${Math.round(tr.delivered)}/${Math.round(tr.qty)} · ${money(tr.unitPrice)}/un · ${World.ix[tr.origin].name} → ${World.ix[tr.dest].name}<br>
        ${tr.status==='accepted'?'aguardando carro de apoio':tr.status==='transporting'?'em trânsito':'em processamento'}</div>
      </div>
      <div class="btnrow">
        ${tr.status==='accepted'&&free.length?`<button data-sendtrade="${tr.id}">Enviar</button>`:''}
        ${tr.status==='accepted'?`<button data-canceltrade="${tr.id}" class="danger">Cancelar</button>`:''}
      </div></div>`;
    }
    h+=`</div>`;
    h+=`<div class="block"><h3>Estoques da firma</h3>`;
    const tot={}; for(const g of GK) tot[g]=0;
    for(const t of World.owned(0)) for(const g of GK) tot[g]+=t.stock[g];
    for(const g of GK) h+=`<div class="row"><span><span class="tag" style="background:${GOODS[g].color}"></span>${GOODS[g].name}</span><b>${Math.round(tot[g])}</b></div>`;
    h+=`</div><div class="hint">Cada carro de apoio possui tanque próprio. O combustível é abastecido no território, permanece no carro de apoio durante a viagem e é consumido ao longo da estrada. Ele não é retirado magicamente do destino.</div>`;
    p.innerHTML=h;
    const hd=$('hireDriver'); if(hd) hd.onclick=()=>{const e=Logi.hireDriver(0);if(e)log(e,'hit');else log('Motorista contratado.');panel();};
    const ha=$('hireAdmin'); if(ha) ha.onclick=()=>{const e=Logi.hireAdmin(0);if(e)log(e,'hit');else log('Gerente contratado.');panel();};
    p.querySelectorAll('[data-repair]').forEach(b=>{const v=World.veh.find(x=>x.id===+b.dataset.repair);const e=Logi.repair(v);if(e)log(e,'hit');else log(`${VEHICLES[v.kind].name} #${v.id} entrou em manutenção.`);panel();});
    p.querySelectorAll('[data-refuel]').forEach(b=>{
      const v=World.veh.find(x=>x.id===+b.dataset.refuel);
      const err=Logi.refuel(v,VEHICLES[v.kind].fuelCap-v.fuel);
      if(err) log(err,'hit'); else log(`${VEHICLES[v.kind].name} #${v.id} abastecido.`);
      panel();
    });
    p.querySelectorAll('[data-newroute]').forEach(b=>b.onclick=()=>{ routeWiz={veh:+b.dataset.newroute,a:null,b:null}; panel(); });
    p.querySelectorAll('[data-clr]').forEach(b=>b.onclick=()=>{ const v=World.veh.find(x=>x.id===+b.dataset.clr); v.route=null; v.phase='idle'; panel(); });
    p.querySelectorAll('[data-sendtrade]').forEach(b=>{
      const tr=World.trades.find(x=>x.id===+b.dataset.sendtrade);
      const v=World.veh.find(x=>x.f===0&&x.loc===tr.origin&&!x.route);
      if(v){
        const err=Logi.assignTrade(v,tr);
        if(err) log(err,'hit'); else log(`Entrega comercial iniciada: ${GOODS[tr.good].name} → ${World.fac[tr.buyer].short}.`);
      } else log('Nenhum carro de apoio livre na origem da venda.','hit');
      panel();
    });
    p.querySelectorAll('[data-canceltrade]').forEach(b=>{
      const tr=World.trades.find(x=>x.id===+b.dataset.canceltrade);
      Econ.cancelTrade(tr); log('Venda comercial cancelada e carga não transportada devolvida ao estoque.'); panel();
    });
    p.querySelectorAll('[data-wg]').forEach(b=>b.onclick=()=>{
      const v=World.veh.find(x=>x.id===routeWiz.veh);
      const err=Logi.assign(v,routeWiz.a,routeWiz.b,b.dataset.wg);
      log(err||`${VEHICLES[v.kind].name} #${v.id} em rota ${World.ix[routeWiz.a].name} → ${World.ix[routeWiz.b].name}.`, err?'hit':null);
      routeWiz=null; panel();
    });
    const wc=$('wizCancel'); if(wc) wc.onclick=()=>{routeWiz=null;panel();};
  }

  /* ---------- aba Painel (dashboard administrativo) ---------- */
  function chartLine(key, label, values, suffix=''){
    const W=360,H=108,P=10; const arr=values.length?values:[{v:0,h:0}];
    const vals=arr.map(x=>Number(x.v)||0), min=Math.min(...vals), max=Math.max(...vals), span=Math.max(1,max-min);
    const pts=arr.map((x,i)=>{const xx=P+(i/Math.max(1,arr.length-1))*(W-P*2);const yy=H-P-((x.v-min)/span)*(H-P*2);return `${xx.toFixed(1)},${yy.toFixed(1)}`}).join(' ');
    const last=vals[vals.length-1]||0;
    return `<div class="chartCard"><div class="chartHead"><div><div class="chartTitle">${label}</div><div class="chartSub">Últimas ${arr.length} leituras · agora ${money(last)}${suffix}</div></div></div><svg class="chartSvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="${label}"><path d="M ${P} ${H-P} H ${W-P}" stroke="#1b3b43" stroke-width="1" fill="none"/><polyline points="${pts}" fill="none" stroke="var(--blue)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><polyline points="${P},${H-P} ${pts} ${W-P},${H-P}" fill="rgba(127,199,255,.08)" stroke="none"/></svg></div>`;
  }
  function chartBars(fin){
    const inc=Math.max(0,fin.income), up=Math.max(0,fin.upkeep), max=Math.max(1,inc,up);
    const iw=Math.round((inc/max)*100), uw=Math.round((up/max)*100);
    return `<div class="chartCard"><div class="chartHead"><div><div class="chartTitle">Fluxo por hora</div><div class="chartSub">Receita recorrente versus custeio estimado</div></div></div><div style="display:grid;gap:9px;margin-top:8px"><div><div class="row" style="border:0"><span>Receita</span><b class="pillGood">${money(inc)}/h</b></div><div class="progress"><i style="width:${iw}%;background:var(--green)"></i></div></div><div><div class="row" style="border:0"><span>Custeio</span><b class="warn">${money(up)}/h</b></div><div class="progress"><i style="width:${uw}%;background:var(--red)"></i></div></div><div class="row" style="margin-top:2px"><span>Resultado</span><b class="${fin.net<0?'warn':'pillGood'}">${fin.net>=0?'+':''}${money(fin.net)}/h</b></div></div></div>`;
  }
  function painelPanel(){
    const p=$('panel'), f=World.fac[0], mine=World.owned(0), fin=World.financialSnapshot(0);
    $('selName').textContent='Painel executivo';
    $('selSub').textContent='Visão rápida da firma, caixa, território, operação e tendências.';
    const alerts=Alerts.list(0); $('tabAlertCount').textContent=alerts.filter(a=>a.sev===2).length||'';
    const avgInf=mine.length?mine.reduce((s,t)=>s+(t.inf[0]||0),0)/mine.length:0;
    const avgUnrest=mine.length?mine.reduce((s,t)=>s+t.unrest,0)/mine.length:0;
    const myVeh=World.veh.filter(v=>v.f===0);
    const stuck=myVeh.filter(v=>['sem combustível','destino lotado','origem perdida'].includes(v.note)).length;
    const coverage=World.terr.length?mine.length/World.terr.length*100:0;
    let h=`<div class="dashHero">
      <div class="kpi ${f.money<World.upkeep(0)*30?'bad':f.money<World.upkeep(0)*70?'warn':'good'}"><div class="label">Caixa disponível</div><div class="value">${money(f.money)}</div><div class="delta">${Math.max(0,Math.floor(f.money/Math.max(1,World.upkeep(0))))} h de autonomia</div></div>
      <div class="kpi ${fin.net<0?'bad':'good'}"><div class="label">Resultado / hora</div><div class="value">${fin.net>=0?'+':''}${money(fin.net)}</div><div class="delta">${money(fin.income)}/h receita · ${money(fin.upkeep)}/h custeio</div></div>
      <div class="kpi"><div class="label">Território</div><div class="value">${mine.length}/${World.terr.length}</div><div class="delta">${Math.round(coverage)}% do mapa sob controle</div></div>
      <div class="kpi ${f.heat>CONF.raidAt?'bad':f.heat>35?'warn':'good'}"><div class="label">Pressão</div><div class="value">${Math.round(f.heat)}%</div><div class="delta">limiar de operação ${CONF.raidAt}%</div></div>
    </div>`;
    if(alerts.length){
      h+=`<div class="chartCard"><div class="chartHead"><div><div class="chartTitle">Atenção necessária</div><div class="chartSub">${alerts.length} ponto(s) pedem acompanhamento</div></div><button id="openAlerts">Abrir avisos</button></div>`;
      for(const a of alerts.slice(0,4)) h+=`<div class="alert sev${a.sev}" data-jump="${a.tid??''}"><i></i><span>${a.txt}</span></div>`;
      h+=`</div>`;
    }
    {const gd=Greed.describe(0), sc=Scarcity.current();
     h+=`<div class="chartCard"><div class="chartHead"><div><div class="chartTitle">Cobiça · nível ${gd.tier}</div><div class="chartSub">Fortuna ${money(gd.fortune)} · recorde ${money(World.peakFortune)}</div></div></div>
       <div class="hint">${gd.tier?`Sua riqueza atrai atenção: custeio +${gd.upkeepPct}%, +${gd.heatPerH} de calor/h, batidas levam ${gd.cashSeizePct}% do caixa${gd.betrayalPer100h?`, risco de traição ≈ ${gd.betrayalPer100h}% a cada 100 h`:''}.`:'Fortuna ainda discreta — sem atenção extra. Cada degrau de riqueza traz mais poder e mais risco.'} Próximo nível a partir de ${money(gd.nextAt)}.</div></div>`;
     if(sc.length){
       h+=`<div class="chartCard"><div class="chartHead"><div><div class="chartTitle">Escassez de importação</div><div class="chartSub">O abastecimento externo está instável</div></div></div>`;
       for(const c of sc) h+=`<div class="alert sev${c.phase==='active'?2:1}"><i></i><span>${GOODS[c.good].name}: ${c.phase==='active'?`<b>em falta</b> por mais ~${Math.ceil(c.hoursLeft)} h`:`vai faltar em ~${Math.ceil(c.hoursToStart)} h (por ~${Math.ceil(c.hoursLeft-c.hoursToStart)} h)`}</span></div>`;
       h+=`</div>`;
     }}
    h+=chartLine('money','Evolução do caixa',World.stats.money);
    h+=chartBars(fin);
    h+=`<div class="dashGrid"><div class="dashMini"><span>Influência média</span><b>${Math.round(avgInf)}%</b><div class="progress"><i style="width:${Math.min(100,avgInf)}%"></i></div></div><div class="dashMini"><span>Desordem média</span><b class="${avgUnrest>30?'warn':''}">${Math.round(avgUnrest)}%</b><div class="progress"><i style="width:${Math.min(100,avgUnrest)}%;background:${avgUnrest>30?'var(--red)':'var(--gold)'}"></i></div></div><div class="dashMini"><span>Carros travados</span><b class="${stuck?'warn':''}">${stuck}</b><span>${myVeh.length} no total</span></div><div class="dashMini"><span>Operações</span><b>${World.ops.filter(o=>o.f===0).length}</b><span>em preparo ou curso</span></div></div>`;
    h+=`<div class="sideSection"><div class="block"><h3>Estoque consolidado</h3>`;
    const tot={}; for(const g of GK)tot[g]=0; for(const t of mine)for(const g of GK)tot[g]+=t.stock[g];
    for(const g of GK)h+=`<div class="row"><span><span class="tag" style="background:${GOODS[g].color}"></span>${GOODS[g].name}</span><b>${Math.round(tot[g])}</b></div>`;
    h+=`</div></div>`;
    h+=`<div class="sideSection"><div class="block"><h3>Próximas decisões</h3><div class="hint">Use o mapa para selecionar uma comunidade. Depois, as ações específicas aparecem na aba Comunidade. A aba Apoio e circulação concentra carros, rotas e transferências.</div></div></div>`;
    p.innerHTML=h;
    const oa=$('openAlerts'); if(oa)oa.onclick=()=>{const b=document.querySelector('#tabs button[data-tab="notif"]');if(b)b.click();};
    p.querySelectorAll('[data-jump]').forEach(el=>el.onclick=()=>{if(!el.dataset.jump)return;World.selected=el.dataset.jump;tab='terr';document.querySelectorAll('#tabs button').forEach(x=>x.classList.toggle('on',x.dataset.tab==='terr'));panel();});
  }

  /* ---------- aba Firma ---------- */
  function facPanel(){
    const p=$('panel'), f=World.fac[0];
    $('selName').textContent=f.name;
    $('selSub').textContent='Riqueza, rivais e operações em curso.';
    const gd=Greed.describe(0);
    let h=`<div class="block"><h3>Riqueza e cobiça</h3>
      <div class="row"><span>Comunidades</span><b>${World.owned(0).length} / ${World.terr.length}</b></div>
      <div class="row"><span>Fortuna atual</span><b>${money(gd.fortune)}</b></div>
      <div class="row"><span>Recorde (dia ${World.peakDay})</span><b>${money(World.peakFortune)}</b></div>
      <div class="row"><span>Nível de cobiça</span><b class="${gd.tier>=5?'warn':''}">${gd.tier}</b></div>
      <div class="row"><span>Custeio extra</span><b>+${gd.upkeepPct}%</b></div>
      <div class="row"><span>Calor por riqueza</span><b>+${gd.heatPerH}/h</b></div>
      <div class="row"><span>Batida leva do caixa</span><b>${gd.cashSeizePct}%</b></div>
      <div class="row"><span>Risco de traição</span><b class="${gd.betrayalPer100h>=1?'warn':''}">${gd.betrayalPer100h?`≈ ${gd.betrayalPer100h}% / 100 h`:'—'}</b></div>
      <div class="hint">O jogo não tem fim por vitória: você cresce até cair. Quanto mais rico, mais caro, mais vigiado e mais visado — e maior o risco de traição, que piora com desordem, preço abusivo, reputação baixa e pontos sem guarda. Próximo nível a partir de ${money(gd.nextAt)}.</div>
      <div class="row" style="margin-top:6px"><span>Reputação</span><b class="${f.reputation<35?'warn':''}">${Math.round(f.reputation)}/100</b></div>
      <div class="row"><span>Histórico de crédito</span><b>${f.credit} empréstimo${f.credit===1?'':'s'}</b></div>
      <div class="hint">Reputação baixa deixa outras firmas mais desconfiadas: elas cobram mais caro nas propostas que você recebe e exigem mais margem nas que você envia.</div></div>`;
    const bf=Police.bribeCount[0]||0;
    const failPct=Math.round(Math.min(55,8+bf*6));
    h+=`<div class="block"><h3>Polícia</h3>
      <div class="row"><span>Pressão atual</span><b class="${f.heat>=CONF.raidAt?'warn':''}">${Math.round(f.heat)}%</b></div>
      <div class="row"><span>Risco de vazamento da propina</span><b class="${failPct>30?'warn':''}">${failPct}%</b></div>
      <div class="hint">Pagar propina reduz a pressão na hora, mas o resultado não é garantido: quanto mais você recorre a isso recentemente, maior a chance de a tentativa vazar e a pressão subir em vez de cair. O risco cai sozinho com o tempo sem uso.</div>
      <div class="btnrow" style="margin-top:6px">
        <button data-bribe="600" ${f.money<600?'disabled':''}>Propina ${money(600)}</button>
        <button data-bribe="1800" ${f.money<1800?'disabled':''}>Propina ${money(1800)}</button>
      </div>
    </div>`;

    h+=`<div class="block"><h3>Relações</h3>`;
    for(const o of World.fac){ if(o.id===0) continue;
      const rel=World.relation(0,o.id);
      h+=`<div class="row"><span>${o.short}</span><b>${rel}</b></div>`;
      if(rel!=='aliada') h+=`<button data-ally="${o.id}" style="margin:3px 0 6px">Propor aliança</button>`;
    }
    h+=`</div>`;

    const allies=World.fac.filter(o=>o.id!==0&&World.relation(0,o.id)==='aliada');
    h+=`<div class="block"><h3>Novo movimento para aliada</h3>`;
    if(!allies.length) h+=`<div class="hint">Nenhuma firma aliada. Uma aliança libera o movimento direto.</div>`;
    else{
      const origins=World.owned(0).filter(t=>GK.some(g=>(t.stock[g]||0)>0));
      h+=`<div class="hint">A carga fica reservada no estoque da origem até um carro de apoio ser enviado. O pagamento só ocorre na entrega.</div>`;
      h+=`<div class="item"><span>Comprador</span><select id="tradeBuyer" style="background:#1a3b43;color:var(--text);border:1px solid #2b5964;border-radius:4px;padding:4px">`;
      for(const o of allies) h+=`<option value="${o.id}">${o.short}</option>`;
      h+=`</select></div>`;
      h+=`<div class="item"><span>Bocaria</span><select id="tradeGood" style="background:#1a3b43;color:var(--text);border:1px solid #2b5964;border-radius:4px;padding:4px">`;
      for(const g of ['armas','ammo','fuel','insumo','cinza','ambar','rubra']) h+=`<option value="${g}">${GOODS[g].name}</option>`;
      h+=`</select></div>`;
      h+=`<div class="item"><span>Origem</span><select id="tradeOrigin" style="background:#1a3b43;color:var(--text);border:1px solid #2b5964;border-radius:4px;padding:4px;max-width:180px">`;
      for(const t of origins) h+=`<option value="${t.id}">${t.name}</option>`;
      h+=`</select></div>`;
      h+=`<div class="item"><span>Quantidade</span><input id="tradeQty" type="number" min="1" value="25" style="width:90px;background:#102d33;color:var(--text);border:1px solid #2b5964;border-radius:4px;padding:5px"></div>`;
      h+=`<div class="item"><span>Preço/un.</span><input id="tradePrice" type="number" min="1" value="65" style="width:90px;background:#102d33;color:var(--text);border:1px solid #2b5964;border-radius:4px;padding:5px"></div>`;
      h+=`<button id="createTrade" style="width:100%">Criar ordem de movimento</button>`;
    }
    h+=`</div>`;

    h+=`<div class="block"><h3>Crédito entre firmas</h3>`;
    if(!allies.length) h+=`<div class="hint">Empréstimos exigem uma firma aliada.</div>`;
    else{
      h+=`<div class="hint">Empréstimo padrão: ${money(3000)} por 48 h, 15% de juro (paga ${money(3000*1.15)} no vencimento). Sem pagar em dia, a reputação de quem pegou cai.</div>`;
      for(const o of allies){
        const busy=World.loans.some(l=>l.status==='active'&&((l.lender===0&&l.borrower===o.id)||(l.lender===o.id&&l.borrower===0)));
        h+=`<div class="row"><span>${o.short}</span><b>${money(o.money)}</b></div>
          <div class="btnrow" style="margin:2px 0 8px">
            <button data-loan-borrow="${o.id}" ${busy||o.money<3000?'disabled':''}>Pedir ${money(3000)}</button>
            <button data-loan-lend="${o.id}" ${busy||f.money<3000?'disabled':''}>Emprestar ${money(3000)}</button>
          </div>`;
      }
      const myLoans=World.loans.filter(l=>l.lender===0||l.borrower===0);
      if(myLoans.length){
        h+=`<div class="hint" style="margin-top:4px"><b>Empréstimos em curso</b></div>`;
        for(const l of myLoans){
          const other=World.fac[l.lender===0?l.borrower:l.lender];
          const dir=l.lender===0?`emprestado a ${other.short}`:`pego de ${other.short}`;
          const status=l.status==='active'?`vence em ${Math.max(0,Math.ceil(l.due-World.h))} h`:l.status==='paid'?'quitado':'inadimplente';
          h+=`<div class="row"><span>${money(l.principal)} ${dir}</span><b>${status}</b></div>`;
        }
      }
    }
    h+=`</div>`;

    h+=`<div class="block"><h3>Rivais</h3>`;
    for(const o of World.fac){ if(o.id===0) continue;
      const ops=World.ops.filter(x=>x.f===o.id);
      h+=`<div class="row"><span><span class="tag" style="background:${o.color}"></span>${o.short}</span>
        <b>${World.owned(o.id).length} terr.${ops.length?' <span class="warn">concentrando</span>':''}</b></div>`;
      // O que dá pra PERCEBER do temperamento da rival — sem expor números.
      const pc=AI.perception(o.id), notes=[];
      if(pc.tendency) notes.push(`${o.short} parece ter ${pc.tendency} que de costume.`);
      if(pc.profile) notes.push(`Perfil marcante: ${pc.profile}.`);
      if(pc.legacy) notes.push(`Traz de partidas anteriores: ${pc.legacy}.`);
      if(notes.length) h+=`<div class="hint" style="margin:0 0 6px">${notes.join(' ')}</div>`;
    }
    h+=`</div>`;
    if(World.vacancies.length) h+=`<div class="block"><h3>Vagas na península</h3><div class="hint">${World.vacancies.length===1?'Uma vaga aberta':World.vacancies.length+' vagas abertas'}: novas firmas devem se estabelecer em territórios neutros nas próximas horas.</div></div>`;
    {const meta=AI.loadMeta();
     h+=`<div class="block"><h3>Memória entre partidas</h3>
      <div class="row"><span>Partidas registradas</span><b>${meta.games||0}</b></div>
      <div class="hint">As rivais guardam parte do que aprenderam de uma partida para a próxima (cerca de 70%; mais para quem venceu). O temperamento inicial ainda é sorteado, então nenhuma partida se repete.</div>
      ${meta.games?`<button data-meta-clear="1" class="danger" style="margin-top:6px">Esquecer o aprendizado das rivais</button>`:''}</div>`;}
    const myOps=World.ops.filter(x=>x.f===0);
    if(myOps.length){
      h+=`<div class="block"><h3>Suas operações</h3>`;
      for(const o of myOps) h+=`<div class="item"><div><div class="nm">${World.ix[o.to].name}</div>
        <div class="ct">${o.state==='prep'?`preparando · ${Math.ceil(o.need-o.prep)} h`:o.state}</div></div>
        ${o.state==='prep'?`<button data-cancel="${o.id}" class="danger">Abortar</button>`:''}</div>`;
      h+=`</div>`;
    }
    p.innerHTML=h;
    p.querySelectorAll('[data-ally]').forEach(b=>b.onclick=()=>{
      const fid=+b.dataset.ally;
      World.setRelation(0,fid,'aliada');
      log(`${World.fac[fid].short} agora é uma firma aliada para fins de movimento.`);
      panel();
    });
    const ct=$('createTrade');
    if(ct) ct.onclick=()=>{
      const buyer=+$('tradeBuyer').value, good=$('tradeGood').value, origin=$('tradeOrigin').value;
      const qty=+$('tradeQty').value, price=+$('tradePrice').value;
      const err=Econ.createTrade(0,buyer,good,qty,price,origin);
      if(err) log(err,'hit'); else log(`Ordem criada: ${Math.round(qty)} ${GOODS[good].name} para ${World.fac[buyer].short}.`);
      panel();
    };
    p.querySelectorAll('[data-meta-clear]').forEach(b=>b.onclick=()=>{ AI.clearMeta(); log('Aprendizado acumulado das rivais apagado — as próximas partidas começam do zero.'); panel(); });
    p.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=()=>{
      const o=World.ops.find(x=>x.id===+b.dataset.cancel); if(o){Ops.cancel(o);log('Operação abortada. Munição devolvida ao estoque.');} panel();
    });
    p.querySelectorAll('[data-bribe]').forEach(b=>b.onclick=()=>{
      const amt=+b.dataset.bribe;
      const err=Police.bribe(0,amt);
      if(err) log(err,'hit');
      panel();
    });
    p.querySelectorAll('[data-loan-borrow]').forEach(b=>b.onclick=()=>{
      const oid=+b.dataset.loanBorrow;
      const err=Econ.loan(oid,0,3000,48);
      if(err) log(err,'hit'); else log(`Empréstimo de ${money(3000)} recebido de ${World.fac[oid].short}. Vence em 48 h.`);
      panel();
    });
    p.querySelectorAll('[data-loan-lend]').forEach(b=>b.onclick=()=>{
      const oid=+b.dataset.loanLend;
      const err=Econ.loan(0,oid,3000,48);
      if(err) log(err,'hit'); else log(`Empréstimo de ${money(3000)} concedido a ${World.fac[oid].short}.`);
      panel();
    });
  }

  function mercadoPanel(){
    const p=$('panel');
    $('selName').textContent='Mercado';
    $('selSub').textContent='Compradores e fornecedores de última instância — nos dois sentidos.';
    const offers=PurchaseOffers.available(0);
    const hasPosto=PurchaseOffers.hasPosto(0);
    const nBuy=offers.filter(o=>o.dir!=='sell').length, nSell=offers.length-nBuy;
    let h=`<div class="block"><div class="row"><span>Compram de você</span><b>${nBuy}</b></div><div class="row"><span>Vendem a você</span><b>${nSell}</b></div><div class="hint">Você decide quais ofertas aceitar ou recusar. <b>Compra:</b> o Mercado leva estoque dos seus complexos e paga na hora. <b>Fornecimento:</b> o Mercado entrega num Posto de Mercado seu — sempre por mais que o preço de porto, mas útil quando o porto está longe ou em greve. As rivais negociam com o Mercado do mesmo jeito. As ofertas são ficcionais e abstratas.</div>${Scarcity.current().length?`<div class="hint warn" style="margin-top:6px"><b>Escassez de importação:</b> ${Scarcity.current().map(c=>`${GOODS[c.good].name} (${c.phase==='active'?`em falta ~${Math.ceil(c.hoursLeft)} h`:`falta em ~${Math.ceil(c.hoursToStart)} h`})`).join(', ')}. Em falta, o Mercado vende esse bem a ×1.9 e paga ×1.5 por ele — quem tem estoque lucra.</div>`:''}${hasPosto?'':'<div class="hint warn" style="margin-top:6px">Sem Posto de Mercado: bens industriais não podem ser vendidos nem recebidos por aqui, e não chegam ofertas de fornecimento.</div>'}</div>`;
    if(!offers.length){h+=`<div class="block"><div class="hint">Nenhuma oferta pendente. Novas ofertas aparecem ao longo do tempo, e eventos de mundo (como Mercado aquecido ou Greve no porto) trazem outras.</div></div>`;}
    for(const o of offers){
      if(o.dir==='sell'){
        const dests=World.owned(0).filter(t=>t.buildings.mercado);
        const fit=PurchaseOffers.sellDestinations(o);
        const total=o.qty*o.unitPrice, cash=World.fac[0].money>=total;
        let statusTxt;
        if(!dests.length) statusTxt='precisa de um Posto de Mercado para receber';
        else if(!fit.length) statusTxt=`nenhum Posto tem ${o.qty} de espaço livre`;
        else if(!cash) statusTxt=`caixa insuficiente (${money(total)})`;
        else statusTxt='pode receber';
        const port=Math.round(GOODS[o.good].buy);
        h+=`<div class="marketOffer"><div class="offerTop"><div><div class="offerName">${o.seller} · fornecimento</div><div class="offerMeta">Vende <b>${o.qty}</b> ${GOODS[o.good].name} · expira em ${Math.max(0,Math.ceil(o.expires-World.h))} h</div></div><div class="offerPrice">${money(o.unitPrice)}/un.</div></div>`;
        h+=`<div class="offerMeta" style="margin-top:7px">Custo: <b>${money(total)}</b> · preço de porto ${money(port)}/un. · ${statusTxt}</div>`;
        h+=`<div class="offerActions"><select id="offerOrigin-${o.id}" ${fit.length?'':'disabled'}>${fit.map(t=>`<option value="${t.id}">${t.name} · ${Math.floor(World.cap(t)-World.load(t))} livres</option>`).join('')||'<option>Sem Posto disponível</option>'}</select><button data-offer-accept="${o.id}" ${(fit.length&&cash)?'':'disabled'}>Aceitar</button><button data-offer-reject="${o.id}" class="danger">Recusar</button></div></div>`;
        continue;
      }
      // Origem é só uma PREFERÊNCIA de onde começar a tirar o estoque — o
      // restante é completado automaticamente nos demais complexos elegíveis.
      const elig=PurchaseOffers.eligibleOrigins(o);
      const total=PurchaseOffers.totalAvailable(o);
      const enough=total+0.001>=o.qty;
      const industrialSemPosto=INDUSTRIAL.includes(o.good) && !elig.length && World.owned(0).some(t=>(t.stock[o.good]||0)>0.01);
      let statusTxt;
      if(enough) statusTxt='estoque suficiente'+(elig.length>1?' (será combinado entre complexos, se preciso)':'');
      else if(industrialSemPosto) statusTxt='precisa de Posto de Mercado num complexo com estoque';
      else statusTxt=`falta estoque (você tem ${Math.floor(total)} de ${o.qty})`;
      h+=`<div class="marketOffer ${o.risk==='alto'?'hot':''}"><div class="offerTop"><div><div class="offerName">${o.buyer}</div><div class="offerMeta">Compra de <b>${o.qty}</b> ${GOODS[o.good].name} · expira em ${Math.max(0,Math.ceil(o.expires-World.h))} h</div></div><div class="offerPrice">${money(o.unitPrice)}/un.</div></div>`;
      h+=`<div class="offerMeta" style="margin-top:7px">Total: <b>${money(o.qty*o.unitPrice)}</b> · ${statusTxt}</div>`;
      h+=`<div class="offerActions"><select id="offerOrigin-${o.id}" ${elig.length?'':'disabled'}>${elig.slice().sort((a,b)=>(b.stock[o.good]||0)-(a.stock[o.good]||0)).map(t=>`<option value="${t.id}">${t.name} · ${Math.floor(t.stock[o.good])} disponíveis</option>`).join('')||'<option>Sem origem disponível</option>'}</select><button data-offer-accept="${o.id}" ${enough?'':'disabled'}>Aceitar</button><button data-offer-reject="${o.id}" class="danger">Recusar</button></div></div>`;
    }
    p.innerHTML=h;
    // ids de território são strings (ex.: 'centro'): não usar `+value` aqui.
    p.querySelectorAll('[data-offer-accept]').forEach(b=>b.onclick=()=>{
      const id=+b.dataset.offerAccept, sel=$(`offerOrigin-${id}`);
      const o=World.purchaseOffers.find(x=>x.id===id);
      const err=PurchaseOffers.accept(id,(sel&&!sel.disabled)?sel.value:null,0);
      if(err) log(err,'hit'); else log(o&&o.dir==='sell'?'Fornecimento do Mercado recebido.':'Oferta de compra aceita e liquidada.','win');
      mercadoPanel();
    });
    p.querySelectorAll('[data-offer-reject]').forEach(b=>b.onclick=()=>{const err=PurchaseOffers.reject(+b.dataset.offerReject,0);if(err)log(err,'hit');else log('Oferta recusada.');mercadoPanel();});
  }

  let moveMode=null, moveFrom=null;
  function coordPanel(){
    const p=$('panel'), f=World.fac[0], mine=Coord.mine();
    $('selName').textContent='Coordenação';
    $('selSub').textContent='Dependências, pedidos e acordos entre facções.';
    const prof=Coord.profile(0);
    let h=`<div class="block"><h3>Seu papel</h3><div class="coordCard"><div class="nm">${prof.role}</div><div class="ct">Você não precisa produzir tudo. Especialização cria motivos para negociar com outros jogadores.</div></div></div>`;
    h+=`<div class="block"><h3>Dependências</h3><div>`;
    for(const [need,label] of prof.needs){
      const partner=(typeof label==='number')?World.fac[label]:Object.values(World.fac).find(x=>x.short===label);
      if(!partner||!partner.alive) continue;
      const rel=World.relation(0,partner.id);
      h+=`<div class="dep"><div><b>${need==='buyers'?'Compradores':need==='contracts'?'Contratos':need==='logi'?'Transporte':need==='maintenance'?'Manutenção':GOODS[need]?.name||need}</b><div class="ct">${partner.short} · ${rel}</div></div><span class="depNeed">${rel==='aliada'?'disponível':'negociar'}</span></div>`;
    }
    h+=`</div><div class="hint" style="margin-top:7px">Dependências não bloqueiam o jogo agora; elas orientam o futuro multiplayer. Em uma partida com players, preços, prazos e logística deverão ser combinados entre organizações.</div></div>`;
    h+=`<div class="block"><h3>Pedidos entre facções</h3>`;
    if(!mine.length) h+=`<div class="hint">Nenhuma proposta. Envie uma para outro jogador ou responda às que chegarem.</div>`;
    for(const r of mine.slice(-8).reverse()){
      const other=r.from===0?World.fac[r.to]:World.fac[r.from];
      h+=`<div class="coordCard" style="margin-bottom:7px"><div class="row"><span>${r.from===0?'Você → ':'← '}${other.short}</span><b>${r.state}</b></div><div class="ct">${Coord.describe(r)}${r.note?' · '+r.note:''}</div>`;
      if(r.to===0&&r.state==='pendente') h+=`<div class="btnrow" style="margin-top:6px"><button data-req-accept="${r.id}">Aceitar</button><button data-req-reject="${r.id}" class="danger">Recusar</button></div>`;
      if(r.state==='aceita'&&r.good) h+=`<div class="hint" style="margin-top:4px">O pagamento sai automaticamente quando a carga for entregue.</div>`;
      h+=`</div>`;
    }
    h+=`</div>`;
    const goodOpts=Object.keys(GOODS).filter(g=>g!=='energia').map(g=>`<option value="${g}">${GOODS[g].name}</option>`).join('');
    h+=`<div class="block"><h3>Enviar proposta</h3>
      <div class="item"><span>Firma</span><select id="coordTo" style="background:#1a3b43;color:var(--text);border:1px solid #2b5964;border-radius:4px;padding:4px">${World.fac.filter(x=>x.id!==0).map(x=>`<option value="${x.id}">${x.short}</option>`).join('')}</select></div>
      <div class="item"><span>Direção</span><select id="coordKind" style="background:#1a3b43;color:var(--text);border:1px solid #2b5964;border-radius:4px;padding:4px"><option value="venda">Vender para eles</option><option value="compra">Comprar deles</option></select></div>
      <div class="item"><span>Bem</span><select id="coordGood" style="background:#1a3b43;color:var(--text);border:1px solid #2b5964;border-radius:4px;padding:4px">${goodOpts}</select></div>
      <div class="item"><span>Quantidade</span><input id="coordQty" type="number" min="1" value="25" style="width:90px;background:#102d33;color:var(--text);border:1px solid #2b5964;border-radius:4px;padding:5px"></div>
      <div class="item"><span>Preço/un</span><input id="coordPrice" type="number" min="1" value="50" style="width:90px;background:#102d33;color:var(--text);border:1px solid #2b5964;border-radius:4px;padding:5px"></div>
      <div class="item"><span>Observação</span><input id="coordNote" placeholder="prazo ou condição" style="flex:1;min-width:0;background:#102d33;color:var(--text);border:1px solid #2b5964;border-radius:4px;padding:5px"></div>
      <button id="coordSend" style="width:100%">Enviar proposta</button>
      <div class="hint" style="margin-top:6px">Ao ser aceita, a proposta vira uma venda real: a firma vendedora precisa ter estoque do bem e transportá-lo até a compradora. O pagamento só é feito quando a entrega é concluída, pelo preço combinado aqui — não pelo preço de mercado do momento.</div></div>`;
    p.innerHTML=h;
    p.querySelectorAll('[data-req-accept]').forEach(b=>b.onclick=()=>{Coord.accept(+b.dataset.reqAccept);log('Proposta aceita. Se houver carro de apoio livre na origem, o transporte já começa sozinho.');coordPanel();});
    p.querySelectorAll('[data-req-reject]').forEach(b=>b.onclick=()=>{Coord.reject(+b.dataset.reqReject);log('Proposta recusada.');coordPanel();});
    const send=$('coordSend'); if(send) send.onclick=()=>{
      const to=+$('coordTo').value, kind=$('coordKind').value, good=$('coordGood').value,
        qty=+$('coordQty').value, unitPrice=+$('coordPrice').value, note=$('coordNote').value.trim();
      Coord.openRequest(0,to,kind,good,qty,unitPrice,note);
      log(`Proposta enviada para ${World.fac[to].short}.`);
      coordPanel();
    };
  }
  function notifPanel(){
    const p=$('panel'); $('selName').textContent='Central de avisos'; $('selSub').textContent='Acordos, território, rivais, polícia e logística.';
    let h=`<div class="block"><div class="btnrow"><button id="notifReadAll">Marcar tudo como lido</button><button id="notifClear" class="danger">Limpar histórico</button></div></div>`;
    h+=`<div class="block">${Notifications.render()}</div>`; p.innerHTML=h;
    const ra=$('notifReadAll'); if(ra) ra.onclick=()=>{Notifications.markAllRead();notifPanel();};
    const cl=$('notifClear'); if(cl) cl.onclick=()=>{Notifications.clear();notifPanel();};
    p.querySelectorAll('[data-nact]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); Notifications.act(+b.dataset.nact); });
    p.querySelectorAll('[data-nid]').forEach(el=>el.onclick=()=>{
      const id=+el.dataset.nid;
      Notifications.markRead(id);
      el.classList.remove('unread');
    });
  }
  function panel(){ if(tab==='terr') terrPanel(); else if(tab==='logi') logiPanel(); else if(tab==='notif') notifPanel(); else if(tab==='mercado') mercadoPanel(); else if(tab==='coord') coordPanel(); else if(tab==='painel') painelPanel(); else facPanel(); }

  const side=$('side'), sideToggle=$('sideToggle');
  function setSide(open){ side.classList.toggle('collapsed',!open); if(sideToggle){sideToggle.textContent=open?'❯':'❮';sideToggle.title=open?'Fechar painel lateral':'Abrir painel lateral';sideToggle.setAttribute('aria-label',sideToggle.title);} }
  if(sideToggle) sideToggle.onclick=()=>setSide(side.classList.contains('collapsed'));
  document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>{
    tab=b.dataset.tab; document.querySelectorAll('#tabs button').forEach(x=>x.classList.toggle('on',x===b)); setSide(true); panel();
  });
  const notifBell=$('notifBell'); if(notifBell) notifBell.onclick=()=>Notifications.openCenter();
  const zoomIn=$('zoomIn'),zoomOut=$('zoomOut'),zoomReset=$('zoomReset'),roadLayer=$('roadLayer');
  if(zoomIn) zoomIn.onclick=e=>{e.stopPropagation();Render.zoomBy(1.25);};
  if(zoomOut) zoomOut.onclick=e=>{e.stopPropagation();Render.zoomBy(0.8);};
  if(zoomReset) zoomReset.onclick=e=>{e.stopPropagation();Render.resetView();};
  if(roadLayer) roadLayer.onclick=e=>{e.stopPropagation();RoadNet.toggle();roadLayer.classList.toggle('on',RoadNet.visible);Render.draw();};
  Render.cv.addEventListener('wheel',e=>{e.preventDefault();Render.zoomAt(e.deltaY<0?1.12:0.89,e.clientX,e.clientY);},{passive:false});
  document.querySelectorAll('[data-sp]').forEach(b=>b.onclick=()=>{
    World.speed=+b.dataset.sp; document.querySelectorAll('[data-sp]').forEach(x=>x.classList.toggle('on',x===b));
  });
  addEventListener('keydown',e=>{
    const tag=document.activeElement?.tagName;
    const editing=['INPUT','SELECT','TEXTAREA'].includes(tag)||document.activeElement?.isContentEditable;
    if(e.key.toLowerCase()==='i' && !editing){ setSide(side.classList.contains('collapsed')); return; }
    if(e.code==='Space' && !editing){
      e.preventDefault();
      document.querySelector(World.speed===0?'[data-sp="1"]':'[data-sp="0"]').click();
    }
  });
  addEventListener('resize',()=>{Render.fit();Render.draw();});

  const mapPointers=new Map();
  let mapGesture=null;
  function hitTerritory(clientX,clientY){
    const [x,y]=Render.toWorld(clientX,clientY);
    if(!MapData.isLand(x,y)) return null;
    for(const t of World.terr) if(MapData.inPoly([x,y],t.poly)) return t;
    return null;
  }
  function handleMapTap(clientX,clientY){
    if(World.over) return;
    const hit=hitTerritory(clientX,clientY);
    if(!hit){ World.selected=null; moveMode=null; panel(); return; }
    if(routeWiz){
      if(!routeWiz.a) routeWiz.a=hit.id;
      else if(!routeWiz.b && hit.id!==routeWiz.a) routeWiz.b=hit.id;
      panel(); return;
    }
    if(moveMode && moveFrom && hit.id!==moveFrom){
      const u=World.at(moveFrom,0,moveMode)[0];
      const sea=false;
      const p=World.path(moveFrom,hit.id,sea);
      if(!p) log('Sem caminho terrestre até lá. Ilhas exigem transporte marítimo.','hit');
      else { u.state='moving'; u.path=p; u.roadPoints=null; u.roadIndex=0; log(`${UNITS[moveMode].name} a caminho de ${hit.name} (${p.length} trecho${p.length>1?'s':''}).`); }
      moveMode=null; World.selected=hit.id; panel(); return;
    }
    World.selected=hit.id; moveMode=null; panel();
  }
  function pointerDistance(a,b){return Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);}
  function pointerMid(a,b){return [(a.clientX+b.clientX)/2,(a.clientY+b.clientY)/2];}
  Render.cv.addEventListener('pointerdown',e=>{
    if(World.over) return;
    Render.cv.setPointerCapture?.(e.pointerId);
    mapPointers.set(e.pointerId,e);
    if(mapPointers.size===1){
      mapGesture={mode:'pan',startX:e.clientX,startY:e.clientY,lastX:e.clientX,lastY:e.clientY,moved:false};
    }else if(mapPointers.size===2){
      const [a,b]=[...mapPointers.values()];
      mapGesture={mode:'pinch',lastDist:pointerDistance(a,b),lastMid:pointerMid(a,b)};
    }
  });
  Render.cv.addEventListener('pointermove',e=>{
    if(!mapPointers.has(e.pointerId)) return;
    mapPointers.set(e.pointerId,e);
    if(mapPointers.size===2){
      const [a,b]=[...mapPointers.values()];
      const mid=pointerMid(a,b),dist=pointerDistance(a,b);
      if(!mapGesture||mapGesture.mode!=='pinch') mapGesture={mode:'pinch',lastDist:dist,lastMid:mid};
      if(mapGesture.lastDist>0){
        Render.zoomAt(dist/mapGesture.lastDist,mid[0],mid[1]);
        Render.panBy(mid[0]-mapGesture.lastMid[0],mid[1]-mapGesture.lastMid[1]);
      }
      mapGesture.lastDist=dist;mapGesture.lastMid=mid;
      e.preventDefault();return;
    }
    if(mapPointers.size===1&&mapGesture?.mode==='pan'){
      const dx=e.clientX-mapGesture.lastX,dy=e.clientY-mapGesture.lastY;
      if(Math.hypot(e.clientX-mapGesture.startX,e.clientY-mapGesture.startY)>7) mapGesture.moved=true;
      if(mapGesture.moved){Render.panBy(dx,dy);e.preventDefault();}
      mapGesture.lastX=e.clientX;mapGesture.lastY=e.clientY;
    }
  });
  function finishPointer(e){
    const wasSingle=mapPointers.size===1;
    const moved=!!mapGesture?.moved;
    mapPointers.delete(e.pointerId);
    if(wasSingle&&!moved&&mapPointers.size===0) handleMapTap(e.clientX,e.clientY);
    if(mapPointers.size===1){
      const a=[...mapPointers.values()][0];mapGesture={mode:'pan',startX:a.clientX,startY:a.clientY,lastX:a.clientX,lastY:a.clientY,moved:true};
    }else if(mapPointers.size===0) mapGesture=null;
  }
  Render.cv.addEventListener('pointerup',finishPointer);
  Render.cv.addEventListener('pointercancel',finishPointer);

  function overlay(title,sub,html){ $('overlayCard').innerHTML=`<h1>${title}</h1><p>${sub}</p>${html}`; $('overlay').classList.add('on'); }
  /* Jogo infinito: só se chega aqui pela queda da firma do jogador. */
  function end(won,f){
    World.over=true; World.speed=0;
    // Registra o que as IAs aprenderam nesta partida (a firma mais rica que
    // sobrou é a "vencedora" para fins de retenção de aprendizado).
    const rivals=World.fac.filter(x=>x.id!==0&&x.alive).sort((a,b)=>Greed.wealth(b.id)-Greed.wealth(a.id));
    AI.commitMeta(rivals.length?rivals[0].id:null);
    const days=Math.floor(World.h/24)+1;
    let rec={bestFortune:0,bestDays:0,runs:0}, newRec=false;
    try{ const raw=localStorage.getItem('peninsula_records_v1'); if(raw){ const r=JSON.parse(raw); if(r&&typeof r==='object') rec={...rec,...r}; } }catch(e){}
    if(World.peakFortune>rec.bestFortune){ rec.bestFortune=World.peakFortune; newRec=true; }
    if(days>rec.bestDays) rec.bestDays=days;
    rec.runs=(rec.runs||0)+1;
    try{ localStorage.setItem('peninsula_records_v1',JSON.stringify(rec)); }catch(e){}
    const last=World.chronicle.slice(-6).reverse();
    overlay('Sua firma caiu',`Dia ${days}. Você chegou ao nível ${Greed.tier(0)} de cobiça, com pico de fortuna de ${money(World.peakFortune)} (dia ${World.peakDay}).`,
      `${last.length?`<div class="hint" style="margin:8px 0"><b>Os últimos golpes</b><ol style="margin:6px 0 0 18px;padding:0">${last.map(c=>`<li>Dia ${Math.floor(c.h/24)+1}: ${c.txt}</li>`).join('')}</ol></div>`:''}
       <div class="hint" style="margin:8px 0">Recorde de fortuna: <b>${money(rec.bestFortune)}</b>${newRec?' — <b>novo recorde!</b>':''} · maior sobrevivência: <b>${rec.bestDays}</b> dias · partidas: ${rec.runs}</div>
       <button id="again">Recomeçar</button>`);
    $('again').onclick=()=>{ $('overlay').classList.remove('on'); Game.start(); };
  }
  return {log,banner,hud,panel,overlay,end,reset(){moveMode=null;routeWiz=null;opCount=1;opDraft=null;tab='terr';
    const lg=$('log'); if(lg) lg.innerHTML='';
    document.querySelectorAll('#tabs button').forEach(x=>x.classList.toggle('on',x.dataset.tab==='terr'));}};
})();

