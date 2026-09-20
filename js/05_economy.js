/* ================================= Prod ================================= */
const Prod = {
  tick(dh){
    for(const t of World.terr){
      if(t.owner===null) continue;
      // A produção de bocaria em si (insumo→bocaria, cultivo, etc.) é toda
      // responsabilidade do FactorySystem — um único sistema, um único lugar
      // para balancear. Aqui só sobram obras/recrutamentos e a dissipação
      // natural de desordem e conflito do território.
      if(t.works.length){
        const w=t.works[0]; w.p+=dh;
        if(w.p>=w.need){
          t.works.shift();
          if(w.type==='build'){ t.buildings[w.k]=true; if(t.owner===0) UI.log(`<b>${BUILD[w.k].name}</b> pronto em ${t.name}.`); }
          if(w.type==='unit'){ World.spawnUnit(t.owner,w.k,t.id); if(t.owner===0) UI.log(`${UNITS[w.k].name} disponível em ${t.name}.`); }
          if(w.type==='veh'){ World.spawnVeh(t.owner,w.k,t.id); if(t.owner===0) UI.log(`${VEHICLES[w.k].name} saiu da garagem em ${t.name}.`); }
          if(w.type==='infra'){ t.infra++; t.demand=World.demandOf(t); if(t.owner===0) UI.log(`Infraestrutura de ${t.name} agora é nível ${t.infra}.`); }
          if(w.type==='factory'){ t.factory.level=Math.min(5,(t.factory.level||1)+1); if(t.owner===0) UI.log(`<b>${FACTORIES[t.factory.kind].name}</b> de ${t.name} ampliada para nível ${t.factory.level}.`,'win'); }
        }
      }
      t.unrest=Math.max(0,t.unrest-2.4*dh);
      t.fighting=Math.max(0,t.fighting-dh);
    }
  }
};

/* ================================= Econ ================================= */
const Econ = {
  tick(dh){
    for(const f of World.fac){
      f.money-=World.upkeep(f.id)*dh;
      f.heat=Math.max(0,f.heat-CONF.heatDecay*dh);
      // Colapso tem cooldown: sem isso, Econ.tick roda a cada passo de
      // simulação (0.05h) e uma facção presa em caixa muito negativo perdia
      // território em cascata em frações de segundo real, sem chance de
      // reagir. Agora só pode colapsar de novo depois de CONF.collapseCd
      // horas de jogo, dando tempo do jogador (ou da própria IA) reagir
      // entre uma perda territorial e outra.
      if(f.money<-4000 && f.alive && World.h-(f.lastCollapseH??-999)>=CONF.collapseCd) this.collapse(f);
    }
    const day=Math.floor(World.h/24)+1, season=1+Math.sin(day*Math.PI/9)*.12;
    for(const t of World.terr){
      t.heat=Math.max(0,(t.heat||0)-.025*dh);
      t.eventMult=t.eventMult||1;
      const base=World.demandOf(t);
      for(const g of SELLABLE){
        const excess=(t.pointStock[g]||0)/Math.max(.5,base[g]*18);
        t.demand[g]=Math.max(.001,base[g]*season*t.eventMult*(1-t.heat/180));
        t.price[g]=Math.max(.38,Math.min(1.25,t.price[g]+.006*dh-Math.min(.55,excess)*.010*dh));
      }
      if(t.owner===null) continue;
      const f=World.fac[t.owner], control=Math.min(1,(t.inf[t.owner]||0)/70), mult=(1-t.unrest/110)*control;
      if(mult<=0) continue;
      if(t.buildings.ponto){
        for(const g of SELLABLE){
          const pm=t.priceMult?.[g]||1;
          // Elasticidade: preço acima do mercado (pm>1) afasta clientela —
          // vende menos, mas cada unidade rende mais. Preço abaixo (pm<1)
          // atrai volume, mas corta a margem. A quem define o preço cabe
          // decidir entre lucro por unidade e velocidade de escoamento.
          const elastic=Math.max(0.12,1-(pm-1)*0.95);
          // Elasticidade cruzada entre vizinhos: se um território vizinho de
          // OUTRA facção vende o mesmo bem mais barato, uma fração da demanda
          // local "vaza" para lá — cliente atravessa a fronteira por preço
          // melhor. `diff` é a diferença percentual de preço (pm em relação
          // ao vizinho mais barato); o vazamento cresce com essa diferença,
          // a um teto de 35% para não esvaziar completamente a demanda local
          // por causa de um único vizinho promocional.
          let leak=0;
          for(const nId of (t.neighbors||[])){
            const n=World.ix[nId];
            if(!n||n.owner==null||n.owner===t.owner||!n.buildings.ponto) continue;
            const npm=n.priceMult?.[g]||1;
            if(npm<pm-0.02){
              const diff=(pm-npm)/pm;
              leak=Math.max(leak,Math.min(0.35,diff*0.6));
            }
          }
          const demandHere=t.demand[g]*(1-leak);
          const sold=Math.min(t.pointStock[g],demandHere*mult*elastic*dh);
          if(sold<=0) continue;
          t.pointStock[g]-=sold;
          const unitPrice=GOODS[g].base*t.price[g]*pm*(.8+t.val*.14);
          f.money+=sold*unitPrice;
          // Preço abusivo chama mais atenção — cobrar muito acima do
          // mercado gera desordem e pressão policial extra, não só nas
          // costas do vendedor mas no próprio território.
          const gouge=Math.max(0,pm-1);
          t.unrest=Math.min(100,t.unrest+gouge*sold*0.35*dh);
          t.heat=Math.min(100,t.heat+sold*(g==='rubra'?.75:g==='ambar'?.28:.10)*(1+gouge*0.6));
          f.heat=Math.min(CONF.heatMax,f.heat+sold*(g==='rubra'?.55:g==='ambar'?.22:.07)*(1+gouge*0.6));
        }
      }
      if(t.type==='bairro'||t.type==='boca') f.money+=t.pop/1000*.55*control*dh*(1-t.heat/150);
    }
    this.serviceLoans(dh);
  },


  /* Preço unitário de compra no porto: base do bem × modificador do porto
     (evento 'Greve no porto' encarece o abastecimento externo). */
  portPrice(t,g){
    // base × evento (greve) × cota (porto vazio encarece até +50%).
    const q=(t&&t.importStock&&typeof Scarcity!=='undefined')?Scarcity.quotaMult(t,g):1;
    return Math.round(GOODS[g].buy*((t&&t.portMult)||1)*q);
  },
  buy(t,g,qty){
    const f=World.fac[t.owner];
    if(t.type!=='porto'||!GOODS[g].buy) return 'Só portos compram do abastecimento externo.';
    // Escassez externa: o bem simplesmente não está sendo importado.
    const blocked=(typeof Scarcity!=='undefined')?Scarcity.blockReason(g):null;
    if(blocked) return blocked;
    const room=World.cap(t)-World.load(t);
    const quota=(t.importStock&&typeof Scarcity!=='undefined')?Math.floor(Scarcity.importStock(t,g)):Infinity;
    if(quota<=0) return `A cota de ${GOODS[g].name} deste porto está esgotada — ela se recompõe aos poucos.`;
    qty=Math.min(qty,Math.floor(room),quota);
    if(qty<=0) return 'Sem espaço de estoque aqui.';
    const cost=qty*this.portPrice(t,g);
    if(f.money<cost) return 'Dinheiro insuficiente.';
    f.money-=cost; t.stock[g]+=qty;
    if(t.importStock&&typeof Scarcity!=='undefined') Scarcity.consume(t,g,qty);
    return null;
  },

  distribute(t,g,qty){
    if(!t||t.owner===null) return 'Comunidade sem controle.';
    if(!t.buildings.ponto) return 'Construa um Boca para distribuir carga.';
    if(!SELLABLE.includes(g)) return 'Essa bocaria não é distribuída em Bocas.';
    qty=Math.min(Math.max(0,qty||0),t.stock[g],Math.max(0,80-t.pointStock[g]));
    if(qty<=0) return 'Sem carga disponível ou a Boca já está cheia.';
    t.stock[g]-=qty;
    t.pointStock[g]+=qty;
    return null;
  },

  /* Preço é decisão livre de quem controla a Boca — jogador ou IA. Subir o
     preço aumenta a margem por unidade mas reduz o volume vendido (ver
     elasticidade no Econ.tick) e, se o aumento for muito acima do mercado,
     gera desordem e chama atenção extra da polícia. Baixar o preço vende
     mais rápido, mas reduz a margem — útil para escoar excedente antes que
     estrague em estoque ou vire alvo de operação policial. */
  setMarkup(t,g,mult){
    if(!t||t.owner===null) return 'Comunidade sem controle.';
    if(!SELLABLE.includes(g)) return 'Essa bocaria não tem preço de Boca.';
    if(!t.buildings.ponto) return 'Construa uma Boca para definir preço.';
    mult=Math.max(0.55,Math.min(1.75,Number(mult)||1));
    const old=t.priceMult[g]||1;
    t.priceMult[g]=mult;
    // Mudança brusca de preço é notada na hora — reajustes graduais
    // passam despercebidos, saltos grandes agitam o território.
    const shock=Math.abs(mult-old);
    if(shock>0.12) t.unrest=Math.min(100,t.unrest+shock*14);
    return null;
  },

  createTrade(seller,buyer,good,qty,unitPrice,origin,requireAlly=true){
    if(seller===buyer) return 'Não é possível vender para a própria firma.';
    if(requireAlly && World.relations[`${seller}:${buyer}`]!=='aliada') return 'Movimento direto exige uma firma aliada.';
    if(!GOODS[good] || qty<=0 || unitPrice<=0) return 'Oferta inválida.';
    if(good==='energia') return 'Energia não é transportável — só pode ser usada no próprio território que a produz.';
    const t=World.ix[origin];
    if(!t || t.owner!==seller) return 'A origem precisa ser um território seu.';
    if((t.stock[good]||0)<qty) return 'Estoque insuficiente na origem.';
    const buyerFac=World.fac[buyer];
    if(buyerFac.money<qty*unitPrice) return 'A firma compradora não possui caixa suficiente para essa compra.';
    t.stock[good]-=qty;
    const trade={id:World.uid++,seller,buyer,good,qty,unitPrice,origin,dest:buyerFac.home,
      loaded:0,delivered:0,status:'accepted',vehicleId:null,createdH:World.h,completedH:null};
    World.trades.push(trade);
    return null;
  },

  /* Usado por acordos de Coordenação: o preço e a quantidade já foram
     negociados explicitamente entre as duas facções (proposta aceita), então
     o vínculo de aliança não é exigido aqui — é a negociação direta em si
     que autoriza a venda. O pagamento sai normalmente quando a entrega for
     concluída (Logi.finishTrade), pelo preço combinado na proposta. */
  fulfillDeal(sellerId,buyerId,good,qty,unitPrice,originId){
    return this.createTrade(sellerId,buyerId,good,qty,unitPrice,originId,false);
  },

  loan(lender,borrower,amount,hours,rate=.15){
    if(lender===borrower||amount<=0||hours<=0) return 'Empréstimo inválido.';
    if(World.relation(lender,borrower)!=='aliada') return 'Empréstimos exigem aliança.';
    if(World.fac[lender].money<amount) return 'Credor sem caixa.';
    World.fac[lender].money-=amount; World.fac[borrower].money+=amount;
    World.loans.push({id:World.uid++,lender,borrower,principal:amount,due:World.h+hours,total:amount*(1+rate),status:'active'});
    World.fac[borrower].credit++; return null;
  },
  serviceLoans(dh){
    for(const l of World.loans.filter(x=>x.status==='active'&&World.h>=x.due)){
      const a=World.fac[l.lender],b=World.fac[l.borrower];
      if(b.money>=l.total){b.money-=l.total;a.money+=l.total;l.status='paid';UI.log(`Crédito liquidado: ${a.short} recebeu ${money(l.total)}.`);}
      else {b.reputation=Math.max(0,b.reputation-8);l.status='default';UI.log(`⚠️ ${b.short} não conseguiu honrar um crédito.`,'hit');}
    }
  },

  cancelTrade(trade){
    if(!trade||trade.status==='delivered'||trade.status==='cancelled') return;
    const t=World.ix[trade.origin];
    const v=trade.vehicleId?World.veh.find(x=>x.id===trade.vehicleId):null;
    const inVehicle=v?Math.max(0,v.cargo[trade.good]||0):0;
    const unshipped=Math.max(0,trade.qty-trade.delivered-inVehicle);
    if(t && t.owner===trade.seller) t.stock[trade.good]+=unshipped+inVehicle;
    if(v){ v.cargo[trade.good]=0; v.qty=Math.max(0,v.qty-inVehicle); v.tradeId=null; v.route=null; v.phase='idle'; v.note=''; }
    trade.status='cancelled';
  }
};

/* ========================== Abastecimento fictício ==================== */
/* Ofertas abstratas de jogo. Não representam fornecedores, rotas ou métodos reais. */
const Supply = (()=>{
  let offers=[];
  let nextId=1;
  const goods=['cinza','ambar','rubra'];
  function reset(){ offers=[]; nextId=1; }
  function makeOffer(){
    const g=goods[Math.floor(Math.random()*goods.length)];
    const qty=25+Math.floor(Math.random()*76);
    const mult=g==='cinza'?(0.68+Math.random()*.20):g==='ambar'?(0.76+Math.random()*.24):(0.82+Math.random()*.28);
    const unit=Math.round(GOODS[g].base*mult);
    const o={id:nextId++,good:g,qty,unitPrice:unit,expires:World.h+12+Math.random()*14,created:World.h,state:'available'};
    offers.push(o);
    if(typeof Notifications!=='undefined') Notifications.push('economy','Nova oferta de abastecimento',`${qty} de ${GOODS[g].name} por ${money(unit)}/unidade.`,0,`supply-${o.id}`);
    if(typeof UI!=='undefined') UI.log(`<b>Oferta de abastecimento</b>: ${qty} de ${GOODS[g].name} disponível para sua firma.`);
  }
  function tick(dh){
    if(World.h>7 && offers.length<3 && Math.random()<0.018*dh) makeOffer();
    for(const o of offers) if(o.state==='available'&&World.h>=o.expires) o.state='expired';
    offers=offers.filter(o=>o.state!=='expired' || World.h-o.expires<2);
  }
  function list(){ return offers.filter(o=>o.state==='available'); }
  function accept(id,tid){
    const o=offers.find(x=>x.id===id&&x.state==='available');
    if(!o) return 'Essa oferta não está mais disponível.';
    const t=World.ix[tid], f=World.fac[0];
    if(!t||t.owner!==0||t.type!=='porto') return 'Escolha uma Boca de chegada sua.';
    const room=World.cap(t)-World.load(t);
    if(room<o.qty) return `Espaço insuficiente: a oferta exige ${o.qty} de capacidade livre.`;
    const total=o.qty*o.unitPrice;
    if(f.money<total) return `Caixa insuficiente: a oferta custa ${money(total)}.`;
    f.money-=total; t.stock[o.good]+=o.qty; o.state='accepted'; o.acceptedAt=World.h; o.dest=tid;
    if(typeof Notifications!=='undefined') Notifications.push('economy','Abastecimento recebido',`${o.qty} de ${GOODS[o.good].name} chegaram a ${t.name}.`,0,`supply-ok-${o.id}`);
    if(typeof UI!=='undefined') UI.log(`Abastecimento recebido em <b>${t.name}</b>: ${o.qty} de ${GOODS[o.good].name}.`,'win');
    return null;
  }
  function forceStarter(){
    if(!offers.length){ makeOffer(); }
  }
  return {reset,tick,list,accept,forceStarter};
})();

/* ======================= Complexos especializados ====================== */
/* Cada complexo produz UM bem a partir de zero ou mais insumos. Quando falta
   qualquer insumo da lista, a produção cai para o ritmo do mais escasso —
   é o "gargalo" que força a firma a comprar/transportar o que falta em vez
   de simplesmente esperar. O custo operacional é pago mesmo travado. */
const FactorySystem = (()=>{
  function tick(dh){
    for(const t of World.terr){
      if(!t.factory) continue;
      t.factory.active=t.owner!==null;
      t.factory.lastOutput=0;
      t.factory.lastCost=0;
      t.factory.bottleneck=null;
      if(!t.factory.active) continue;
      const b=FACTORIES[t.factory.kind];
      const f=World.fac[t.owner];
      const lvl=t.factory.level||1;
      const eff=(0.45+0.55*Math.min(1,t.infra/4))*(1+0.18*(lvl-1))*(t.prodMult||1);

      // Custo operacional: pago SEMPRE que a fábrica está ativa, escalando
      // com o nível — independentemente de conseguir produzir ou não. Uma
      // fábrica sem insumo, sem energia, ou sem espaço para escoar o que
      // produz, continua consumindo caixa e gerando prejuízo real.
      const opCost=(b.opCost||0)*lvl*dh;
      if(opCost>0){ f.money-=opCost; t.factory.lastCost=opCost; }

      const room=Math.max(0,World.cap(t)-World.load(t));
      if(room<=0.1) continue;

      // Teto ideal de produção se todos os insumos estivessem disponíveis.
      let q=b.rate*eff*dh;
      for(const inp of (b.inputs||[])){
        const need=q*inp.rate;
        const have=t.stock[inp.good]||0;
        if(have+1e-6<need){
          q=have/Math.max(.0001,inp.rate);
          t.factory.bottleneck=inp.good;
        }
      }
      // Contador de horas travada por falta de insumo — usado por Alerts
      // (prejuízo acumulado) e pela IA (genSupplyChainGoals) para priorizar
      // resolver o gargalo antes que o custeio acumulado fique alto demais.
      // Zera assim que o gargalo desaparece.
      t.factory.stuckSince=t.factory.bottleneck?(t.factory.stuckSince||0)+dh:0;
      q=Math.min(q,room);
      if(q<=0.001) continue;

      for(const inp of (b.inputs||[])) t.stock[inp.good]=Math.max(0,(t.stock[inp.good]||0)-q*inp.rate);

      t.stock[b.output]=(t.stock[b.output]||0)+q;
      t.factory.produced=(t.factory.produced||0)+q;
      t.factory.lastOutput=q;

      // Processar bocaria pesada é arriscado por si só, antes mesmo de
      // vender — calor local e da firma cresce com o volume produzido.
      if(b.risk){
        t.heat=Math.min(100,(t.heat||0)+q*b.risk*0.4);
        f.heat=Math.min(CONF.heatMax,f.heat+q*b.risk*0.18);
      }
    }
  }
  function upgrade(t){
    // Generalizado para qualquer dono (antes só aceitava t.owner===0, ou
    // seja, só o jogador conseguia ampliar fábrica — as firmas de IA nunca
    // tinham como evoluir suas próprias fábricas além do nível 1).
    if(!t||t.owner==null) return 'A fábrica só pode ser ampliada em território controlado.';
    if(!t.factory) return 'Este complexo não possui fábrica.';
    const lvl=t.factory.level||1;
    if(lvl>=5) return 'A fábrica já está no nível máximo.';
    if(t.works.length) return 'O complexo já possui uma obra em andamento.';
    const b=FACTORIES[t.factory.kind];
    // Fábricas mais lucrativas/arriscadas (maior opCost e risco) custam mais
    // para ampliar — a escolha de especialização territorial passa a pesar.
    const mult=1+(b.opCost||1)*0.06+(b.risk||0)*0.05;
    const cost=Math.round((2200+700*lvl)*mult), hours=14+lvl*5;
    const owner=World.fac[t.owner];
    if(!owner||owner.money<cost) return `Caixa insuficiente: ampliar custa ${money(cost)}.`;
    owner.money-=cost;
    t.works.push({type:'factory',p:0,need:hours,k:t.factory.kind});
    return null;
  }
  return {tick,upgrade};
})();

/* ======================= Mercado (bidirecional) ========================= */
/* O Mercado é o comprador E o fornecedor de última instância — para TODAS as
   firmas, não só o jogador. Cada oferta pertence a uma firma (`o.fid`) e tem
   uma direção:
     dir:'buy'  → o Mercado COMPRA da firma (a firma vende excedente).
                  Preço pior que negociar direto com um aliado, mas sempre há
                  comprador. Bem industrial exige Posto de Mercado na origem.
     dir:'sell' → o Mercado VENDE à firma (a firma compra o que lhe falta),
                  sempre por MAIS que o preço de porto — é o "plano B" quando o
                  porto está longe, em greve ou quando a firma nem tem porto.
                  Só bens industriais, entregues num Posto de Mercado da firma
                  (a carga aparece ali, como no abastecimento externo).
   As IAs recebem ofertas do mesmo jeito e decidem por AI.marketTrade(); antes
   só o jogador tinha acesso, o que empobrecia artificialmente a economia das
   firmas rivais. Notificações e logs continuam restritos ao jogador. */
const PurchaseOffers = (()=>{
  const buyers=['Mercado externo','Rede de distribuição','Comprador regional','Casa comercial'];
  const sellers=['Atacadista regional','Importador externo','Distribuidora do porto','Casa de suprimentos'];
  const MARKETABLE=[...SELLABLE,...INDUSTRIAL];
  let seq=1;
  function reset(){seq=1;}
  const hasPosto=fid=>World.owned(fid).some(t=>t.buildings.mercado);
  const isPlayer=fid=>fid===0;
  const refPrice=g=>SELLABLE.includes(g)?GOODS[g].base:GOODS[g].buy*0.6;

  function makeBuy(fid,extra=0){
    const owned=World.owned(fid);
    if(!owned.length) return null;
    const stocked=MARKETABLE.filter(g=>owned.some(t=>(t.stock[g]||0)>8 && (SELLABLE.includes(g)||t.buildings.mercado||isPlayer(fid))));
    // Firmas da IA só recebem oferta de algo que realmente têm pra vender;
    // o jogador mantém o comportamento antigo (fallback em bocaria).
    if(!stocked.length && !isPlayer(fid)) return null;
    const pool=stocked.length?stocked:SELLABLE;
    const g=pool[Math.floor(Math.random()*pool.length)];
    const qty=12+Math.floor(Math.random()*49);
    const base=GOODS[g].base||GOODS[g].buy||40;
    let mult=0.92+Math.random()*0.42+extra;
    if(World.h<(World.marketBoostUntil||0)) mult+=0.16;
    let unit=Math.max(1,Math.round(base*mult*(SELLABLE.includes(g)?1:0.6))); // industrial vende mais barato que bocaria
    // Bem importável em falta lá fora: quem TEM estoque vende bem mais caro.
    if(INDUSTRIAL.includes(g) && typeof Scarcity!=='undefined') unit=Math.round(unit*Scarcity.marketPremium(g,'buy'));
    const o={id:seq++,fid,dir:'buy',buyer:buyers[Math.floor(Math.random()*buyers.length)],good:g,qty,unitPrice:unit,
      expires:World.h+10+Math.random()*12,created:World.h,state:'pending',risk:Math.random()<.22?'alto':'normal'};
    World.purchaseOffers.push(o);
    if(isPlayer(fid)){
      if(typeof Notifications!=='undefined') Notifications.push('economy','Nova oferta de compra',`${o.buyer} quer ${qty} de ${GOODS[g].name} por ${money(unit)}/unidade.`,1,`buy-offer-${o.id}`);
      if(typeof UI!=='undefined') UI.log(`<b>Nova oferta de compra</b>: ${o.buyer} · ${qty} ${GOODS[g].name}.`);
    }
    return o;
  }

  /* O que a firma mais provavelmente precisa: insumos das suas fábricas, com
     prioridade para os que já estão em gargalo. */
  function neededGoods(fid){
    const out=[];
    for(const t of World.owned(fid)){
      if(!t.factory||!t.factory.active) continue;
      const fb=FACTORIES[t.factory.kind];
      for(const i of (fb.inputs||[])){
        if(!GOODS[i.good].buy) continue;             // energia/cocaína etc. não são importáveis
        const w=(t.factory.bottleneck===i.good?3:1)+((t.stock[i.good]||0)<25?1:0);
        for(let k=0;k<w;k++) out.push(i.good);
      }
    }
    return out;
  }
  function makeSell(fid,extra=0){
    if(!World.owned(fid).length) return null;
    const need=neededGoods(fid);
    const importable=INDUSTRIAL.filter(g=>GOODS[g].buy);
    const pool=(need.length&&Math.random()<0.75)?need:importable;
    const g=pool[Math.floor(Math.random()*pool.length)];
    const qty=20+Math.floor(Math.random()*61);
    let unit=Math.max(1,Math.round(GOODS[g].buy*(1.12+Math.random()*0.30)+extra));
    // Em escassez o Mercado ainda vende — mas cobra o preço da falta.
    if(typeof Scarcity!=='undefined') unit=Math.round(unit*Scarcity.marketPremium(g,'sell'));
    const o={id:seq++,fid,dir:'sell',seller:sellers[Math.floor(Math.random()*sellers.length)],good:g,qty,unitPrice:unit,
      expires:World.h+12+Math.random()*12,created:World.h,state:'pending',risk:'normal'};
    World.purchaseOffers.push(o);
    if(isPlayer(fid)){
      if(typeof Notifications!=='undefined') Notifications.push('economy','Mercado oferece fornecimento',`${o.seller} vende ${qty} de ${GOODS[g].name} por ${money(unit)}/unidade (entrega num Posto de Mercado).`,1,`sell-offer-${o.id}`,{label:'Abrir Mercado',tab:'mercado'});
      if(typeof UI!=='undefined') UI.log(`<b>Oferta de fornecimento</b>: ${o.seller} · ${qty} ${GOODS[g].name}.`);
    }
    return o;
  }

  function tick(dh){
    for(const o of World.purchaseOffers) if(o.state==='pending'&&World.h>=o.expires){ o.state='expired'; o.closedH=World.h; }
    World.purchaseOffers=World.purchaseOffers.filter(o=>o.state==='pending'||World.h-(o.closedH??o.expires)<4);
    if(World.h<=8) return;
    for(const f of World.fac){
      if(!f.alive||!World.owned(f.id).length) continue;
      const pend=World.purchaseOffers.filter(o=>o.fid===f.id&&o.state==='pending');
      const nBuy=pend.filter(o=>o.dir==='buy').length, nSell=pend.length-nBuy;
      if(nBuy<3 && Math.random()<0.025*dh) makeBuy(f.id);
      // Oferta de fornecimento só faz sentido para quem tem onde recebê-la.
      if(nSell<2 && hasPosto(f.id) && Math.random()<0.012*dh) makeSell(f.id);
    }
  }
  /* Usado por eventos de mundo (City): injeta oportunidades imediatas. */
  function burst(kind,n,extra){
    for(const f of World.fac){
      if(!f.alive||!World.owned(f.id).length) continue;
      if(kind==='sell' && !hasPosto(f.id)) continue;
      for(let i=0;i<n;i++) (kind==='sell'?makeSell:makeBuy)(f.id,extra||0);
    }
  }
  function available(fid=0){return World.purchaseOffers.filter(o=>o.fid===fid&&o.state==='pending');}
  /* Complexos aptos a fornecer o bem desta oferta de COMPRA: tem estoque (>0)
     e, se o bem for industrial, também tem Posto de Mercado. */
  function eligibleOrigins(o){
    return World.owned(o.fid).filter(t=>(t.stock[o.good]||0)>0.01 && (!INDUSTRIAL.includes(o.good)||t.buildings.mercado));
  }
  function totalAvailable(o){
    return eligibleOrigins(o).reduce((s,t)=>s+(t.stock[o.good]||0),0);
  }
  /* Territórios da firma onde uma oferta de VENDA do Mercado pode ser recebida. */
  function sellDestinations(o){
    return World.owned(o.fid).filter(t=>t.buildings.mercado && World.cap(t)-World.load(t)>=o.qty);
  }

  /* originId é só uma PREFERÊNCIA (de onde tirar primeiro): consome do complexo
     preferido e completa automaticamente nos demais elegíveis. */
  function acceptBuy(o,originId){
    const fid=o.fid, f=World.fac[fid];
    const elig=eligibleOrigins(o);
    if(!elig.length){
      if(INDUSTRIAL.includes(o.good) && World.owned(fid).some(t=>(t.stock[o.good]||0)>0.01))
        return `Vender ${GOODS[o.good].name} exige um Posto de Mercado em algum complexo com estoque do bem.`;
      return `Nenhum complexo tem ${GOODS[o.good].name} em estoque no momento.`;
    }
    const total=elig.reduce((s,t)=>s+(t.stock[o.good]||0),0);
    if(total+0.001<o.qty) return `Estoque insuficiente somando os complexos: há ${Math.floor(total)}, faltam ${Math.ceil(o.qty-total)}.`;
    const ordered=elig.slice().sort((a,b)=>(b.stock[o.good]||0)-(a.stock[o.good]||0));
    if(originId){
      const idx=ordered.findIndex(t=>t.id===originId);
      if(idx>0){ const [pref]=ordered.splice(idx,1); ordered.unshift(pref); }
    }
    let remaining=o.qty; const used=[];
    for(const t of ordered){
      if(remaining<=0.001) break;
      const take=Math.min(t.stock[o.good],remaining);
      if(take<=0) continue;
      t.stock[o.good]-=take; remaining-=take; used.push({name:t.name,take});
    }
    const totalPay=o.qty*o.unitPrice;
    f.money+=totalPay;
    f.reputation=Math.max(0,Math.min(100,f.reputation+(o.risk==='alto'?-1:1)));
    f.heat=Math.min(CONF.heatMax,f.heat+(o.risk==='alto'?2.5:.8));
    o.state='accepted';o.origin=used.map(u=>u.name).join(', ');o.completedH=World.h;o.closedH=World.h;o.total=totalPay;
    if(isPlayer(fid)){
      const src=used.length>1?` (retirado de ${used.map(u=>`${Math.round(u.take)} em ${u.name}`).join(', ')})`:'';
      Notifications.push('economy','Oferta aceita',`${o.qty} de ${GOODS[o.good].name} vendidos por ${money(totalPay)}${src}.`,0,`buy-ok-${o.id}`);
    }
    return null;
  }
  function acceptSell(o,destId){
    const fid=o.fid, f=World.fac[fid];
    const dests=World.owned(fid).filter(t=>t.buildings.mercado);
    if(!dests.length) return 'Receber fornecimento do Mercado exige um Posto de Mercado.';
    const t=destId?World.ix[destId]:null;
    const dest=(t&&t.owner===fid&&t.buildings.mercado)?t:dests.slice().sort((a,b)=>(World.cap(b)-World.load(b))-(World.cap(a)-World.load(a)))[0];
    const room=World.cap(dest)-World.load(dest);
    if(room<o.qty) return `Espaço insuficiente em ${dest.name}: a oferta exige ${o.qty} de capacidade livre.`;
    const total=o.qty*o.unitPrice;
    if(f.money<total) return `Caixa insuficiente: a oferta custa ${money(total)}.`;
    f.money-=total; dest.stock[o.good]+=o.qty;
    o.state='accepted';o.origin=dest.name;o.completedH=World.h;o.closedH=World.h;o.total=total;
    if(isPlayer(fid)) Notifications.push('economy','Fornecimento recebido',`${o.qty} de ${GOODS[o.good].name} chegaram a ${dest.name} por ${money(total)}.`,0,`sell-ok-${o.id}`);
    return null;
  }
  /* `placeId`: para oferta de compra é a origem preferida; para oferta de
     venda é o Posto de Mercado que vai receber a carga. `fid` é opcional
     (padrão: dono da oferta) e serve de trava contra aceitar oferta alheia. */
  function accept(id,placeId,fid){
    const o=World.purchaseOffers.find(x=>x.id===id&&x.state==='pending');
    if(!o) return 'Essa oferta já expirou ou foi encerrada.';
    if(fid!==undefined && fid!==null && fid!==o.fid) return 'Essa oferta é de outra firma.';
    return o.dir==='sell'?acceptSell(o,placeId):acceptBuy(o,placeId);
  }
  function reject(id,fid){
    const o=World.purchaseOffers.find(x=>x.id===id&&x.state==='pending');
    if(!o) return 'Essa oferta já expirou ou foi encerrada.';
    if(fid!==undefined && fid!==null && fid!==o.fid) return 'Essa oferta é de outra firma.';
    o.state='rejected'; o.closedH=World.h;
    if(isPlayer(o.fid)){
      if(o.risk==='alto') World.fac[0].heat=Math.max(0,World.fac[0].heat-.5);
      Notifications.push('economy','Oferta recusada',o.dir==='sell'?`${o.seller} não recebeu resposta.`:`${o.buyer} não recebeu a carga de ${GOODS[o.good].name}.`,0,`buy-no-${o.id}`);
    }
    return null;
  }
  function forceStarter(){ if(!World.purchaseOffers.some(o=>o.fid===0)) makeBuy(0); }
  return {reset,tick,available,accept,reject,forceStarter,eligibleOrigins,totalAvailable,sellDestinations,burst,refPrice,hasPosto};
})();
