/* ================================= Logi ================================= */
/* Nada aparece no destino: carro de apoio carrega no origem, gasta combustível
   do estoque local ao partir, leva horas na estrada e descarrega no destino.
   Terra: a rota COMPLETA é planejada uma vez pelo RoadNet (A*) e percorrida até
   o fim; `loc` acompanha o território realmente atravessado. Mar: navegação
   livre entre territórios, como no design original. */
const Logi = {
  /* Falhas que nenhuma espera resolve: cancelam a rota em vez de repetir. */
  TERMINAL: ['rota terrestre indisponível','rota excede a autonomia do tanque'],

  assign(v,a,b,good,amount){
    if(!v) return 'Carro de apoio inválido.';
    const sea=VEHICLES[v.kind].sea;
    if(!World.path(a,b,sea,v.f)||!World.path(b,a,sea,v.f)) return 'Não há rota possível para esse carro de apoio.';
    if(!GOODS[good] && good !== 'item') return 'Bocaria inválida.';
    // Mesma regra de Econ.createTrade: Energia não é transportável, só pode
    // ser usada no próprio território que a produz. Antes o assistente de
    // rota manual (routeWiz) não aplicava essa checagem e deixava montar uma
    // rota de Energia que funcionava mecanicamente — contradizendo a regra.
    if(good==='energia') return 'Energia não é transportável — só pode ser usada no próprio território que a produz.';
    v.tradeId=null;
    v.route={a,b,good,amount:amount||VEHICLES[v.kind].cap};
    v.phase = v.loc===a?'load':'toA';
    v.note='';
    return null;
  },

  /* Transporte de um item físico entre territórios. Diferente de assign()
     (que move quantidade de um bem fungível do estoque), aqui a carga é UMA
     entidade única e rastreável: enquanto em trânsito, item.loc fica `null`
     e item.inTransitVeh aponta para o carro de apoio — o item nunca deixa
     de existir nem se duplica, só muda de lugar (ver tick() abaixo). */
  assignItem(v,a,b,itemId){
    if(!v) return 'Carro de apoio inválido.';
    if(v.route||v.path.length) return 'Carro de apoio já está ocupado.';
    const item = World.items?.find(i => i.id === itemId);
    if(!item || item.loc !== a) return 'Item não encontrado na origem.';
    if(item.equippedBy) return 'Item está equipado e não pode ser movido sozinho.';
    const sea=VEHICLES[v.kind].sea;
    if(!World.path(a,b,sea,v.f)||!World.path(b,a,sea,v.f)) return 'Não há rota possível para esse carro de apoio.';
    v.tradeId=null;
    v.route={a,b,good:'item',itemId,amount:1};
    v.phase = v.loc===a?'load':'toA';
    v.note='transportando item';
    return null;
  },

  assignTrade(v,trade){
    if(!v||v.f!==trade.seller) return 'Esse carro de apoio não pertence ao vendedor.';
    if(trade.status!=='accepted') return 'A venda não está pronta para transporte.';
    const sea=VEHICLES[v.kind].sea;
    if(!World.path(trade.origin,trade.dest,sea,v.f)) return 'Esse carro de apoio não consegue alcançar o destino da entrega.';
    if(v.route||v.path.length) return 'Carro de apoio já está ocupado.';
    v.tradeId=trade.id;
    v.route={a:trade.origin,b:trade.dest,good:trade.good,amount:trade.qty};
    v.phase=v.loc===trade.origin?'load':'toA';
    v.note='carregamento comercial';
    trade.status='transporting';
    trade.vehicleId=v.id;
    return null;
  },

  refuel(v,amount){
    if(!v||v.loc===null) return 'O carro de apoio precisa estar em um território para abastecer.';
    const t=World.ix[v.loc];
    if(t.owner!==v.f) return 'Só é possível abastecer em território controlado pela firma.';
    const room=Math.max(0,VEHICLES[v.kind].fuelCap-v.fuel);
    const give=Math.min(room, Math.max(0,amount||room), t.stock.fuel);
    if(give<=0) return 'Não há combustível disponível ou o tanque já está cheio.';
    t.stock.fuel-=give; v.fuel+=give; v.note='';
    return null;
  },

  /* Combustível necessário para ir de `a` até `b`. Terra: comprimento REAL da
     rota (a estimativa antiga usava a distância entre centros e subestimava o
     percurso, deixando veículos sem combustível no meio da estrada). */
  requiredFuel(v,a,b){
    const V=VEHICLES[v.kind];
    if(a===b) return 0;
    if(V.sea){
      const p=World.path(a,b,true,v.f);
      if(!p) return Infinity;
      return World.pathLen(p,a)*V.burn/10;
    }
    const rp=RoadNet.route(a,b,v.f);
    if(!rp) return Infinity;
    return RoadNet.length(rp)*V.burn/10;
  },

  send(v,to){
    const V=VEHICLES[v.kind], sea=V.sea;
    if(sea){
      const p=World.path(v.loc,to,true,v.f);
      if(!p||!p.length) return false;
      const need=this.requiredFuel(v,v.loc,to);
      if(v.fuel+0.001<need){ v.note='tanque insuficiente para a viagem'; return false; }
      v.path=p; v.roadPoints=[]; v.roadIndex=0; v.note='em trânsito';
      return true;
    }
    const rp=RoadNet.routeFromPoint(v.x,v.y,to,v.f);
    if(!rp||rp.length<2){ v.note='rota terrestre indisponível'; return false; }
    const need=RoadNet.length(rp)*V.burn/10*1.08;      // 8% de margem
    if(need>V.fuelCap){ v.note='rota excede a autonomia do tanque'; return false; }
    if(v.fuel+0.001<need && !World.fac[v.f].human) this.refuel(v,need-v.fuel);   // firmas da IA reabastecem sozinhas
    if(v.fuel+0.001<need){ v.note='tanque insuficiente para a viagem'; return false; }
    v.path=[to]; v.roadPoints=rp; v.roadIndex=1; v.note='em trânsito';
    v._cand=null; v._candD=0; v._encTid=null; v.strandedH=0;
    return true;
  },

  hireDriver(fid){
    const f=World.fac[fid]; if(f.money<420) return 'Caixa insuficiente para contratar motorista.';
    f.money-=420; f.drivers=(f.drivers||0)+1; return null;
  },
  hireAdmin(fid){
    const f=World.fac[fid]; if(f.money<520) return 'Caixa insuficiente para contratar gerente.';
    f.money-=520; f.admins=(f.admins||0)+1; return null;
  },
  repair(v){
    if(!v||v.loc===null) return 'O carro de apoio precisa estar em um território.';
    const t=World.ix[v.loc]; if(t.owner!==v.f) return 'A manutenção exige território controlado.';
    if(v.route||v.path.length) return 'O carro de apoio precisa estar parado.';
    if((v.condition||100)>=99) return 'O carro de apoio já está em boas condições.';
    const cost=Math.round((100-v.condition)*14);
    if(World.fac[v.f].money<cost) return `Manutenção custa ${money(cost)}.`;
    World.fac[v.f].money-=cost; v.repairUntil=World.h+Math.max(3,(100-v.condition)*.10); v.note='em manutenção'; return null;
  },

  /* Encerra uma rota que não pode mais ser cumprida, devolvendo carga de venda
     ao estoque quando for o caso. Evita o laço "tenta enviar → falha → tenta". */
  abortRoute(v,why){
    if(v.tradeId){
      const tr=World.trades.find(x=>x.id===v.tradeId);
      if(tr) Econ.cancelTrade(tr);
    }
    // Item físico em trânsito quando a rota é abortada: nunca some — volta a
    // existir no território de origem, exatamente como o estoque fungível
    // já volta em Econ.cancelTrade acima.
    if(v.route && v.route.good==='item'){
      const item=World.items?.find(i=>i.id===v.route.itemId);
      if(item && item.inTransitVeh===v.id){ item.loc=v.route.a; item.inTransitVeh=null; }
    }
    v.route=null; v.tradeId=null; v.phase='idle'; v.path=[]; v.roadPoints=[]; v.roadIndex=0;
    if(v.f===0) UI.log(`<b>${VEHICLES[v.kind].name} #${v.id}</b>: rota cancelada (${why}).`,'hit');
  },

  /* Atualiza `loc` conforme o território realmente atravessado, com histerese
     de 10 px para que roçar numa divisa não gere ida-e-volta de território. */
  trackTerritory(v,travelled){
    const t=RoadNet.terrAt(v.x,v.y);
    if(!t||t===v.loc){ v._cand=null; v._candD=0; return; }
    if(v._cand!==t){ v._cand=t; v._candD=0; }
    v._candD+=travelled;
    if(v._candD>=10){
      v.loc=t; v._cand=null; v._candD=0; v._encTid=t;
      Police.roadEncounter(v,t);
    }
  },

  finishTrade(v){
    const trade=World.trades.find(x=>x.id===v.tradeId);
    if(!trade) return;
    const buyer=World.fac[trade.buyer], seller=World.fac[trade.seller];
    const B=World.ix[trade.dest];
    const room=World.cap(B)-World.load(B);
    const delivered=Math.min(v.qty,Math.max(0,room));
    if(delivered<=0){
      v.note='destino comercial lotado';
      return;
    }
    B.stock[trade.good]+=delivered;
    v.cargo[trade.good]-=delivered;
    v.qty-=delivered;
    trade.delivered+=delivered;
    trade.status=trade.delivered+0.01>=trade.qty?'delivered':'accepted';
    if(trade.delivered+0.01>=trade.qty){
      seller.money+=trade.qty*trade.unitPrice;
      trade.status='delivered';
      trade.completedH=World.h;
      v.tradeId=null; v.route=null; v.phase='idle'; v.note='';
      UI.log(`Venda concluída: <b>${Math.round(trade.qty)} ${GOODS[trade.good].name}</b> entregues a <b>${buyer.short}</b>. +${money(trade.qty*trade.unitPrice)}.`);
    } else if(v.qty<=0.01){
      // Entrega parcial: o mesmo carro de apoio volta à origem e completa o restante.
      v.phase='toA'; v.note='retornando para completar venda';
      this.send(v,trade.origin);
    }
  },

  tick(dh){
    for(const v of World.veh){
      const V=VEHICLES[v.kind], fac=World.fac[v.f];
      const drvIdx=World.veh.filter(x=>x.f===v.f).indexOf(v);
      if(drvIdx>=(fac.drivers||0) && v.path.length===0){ v.note='sem motorista disponível'; continue; }
      if(v.repairUntil && World.h<v.repairUntil){ v.note='em manutenção'; continue; }
      if(v.repairUntil && World.h>=v.repairUntil){ v.repairUntil=0; v.condition=92; v.note=''; }

      if(v.path.length){
        if(!V.sea){
          const dest=v.path[v.path.length-1];
          if(!v.roadPoints || !v.roadPoints.length){
            // Rota perdida (ex.: veículo parado por avaria): replaneja da posição real.
            const rp=RoadNet.routeFromPoint(v.x,v.y,dest,v.f);
            if(!rp || rp.length<2){
              v.path=[];v.route=null;v.phase='idle';v.roadPoints=[];v.roadIndex=0;
              v.note='rota terrestre indisponível';
              UI.log(`<b>${V.name} #${v.id}</b> não encontrou uma rota terrestre válida e permaneceu em terra.`,'hit');
              continue;
            }
            v.roadPoints=rp;v.roadIndex=1;v.note='em trânsito';
          }
          const burnPerPx=V.burn/10;
          const allow=Math.min(V.speed*dh, v.fuel/Math.max(0.00001,burnPerPx));
          if(allow<=0.0001){
            v.fuel=0; v.note='sem combustível na estrada';
            // Socorro: depois de 6 h parado sem combustível, um reboque leva um
            // pouco de combustível (custa caixa). Sem isso o veículo ficaria
            // preso para sempre no meio da rota.
            if(!v.strandedH) v.strandedH=World.h;
            if(World.h-v.strandedH>=6){
              fac.money-=250; v.fuel=Math.min(V.fuelCap,25); v.strandedH=0; v.note='em trânsito';
              if(v.f===0) UI.log(`Socorro rodoviário abasteceu ${V.name} #${v.id} (−${money(250)}).`,'hit');
            }
            continue;
          }
          v.strandedH=0;
          const travelled=RoadNet.follow(v,allow);
          v.fuel=Math.max(0,v.fuel-travelled*burnPerPx);
          v.condition=Math.max(0,(v.condition||100)-travelled*(v.kind==='caminhao'?.0025:.0018));
          if(v.condition<=5){v.path=[];v.route=null;v.phase='idle';v.roadPoints=[];v.roadIndex=0;v.repairUntil=World.h+12;v.note='avariado — manutenção 12h';UI.log(`${V.name} #${v.id} sofreu avaria e ficará 12h em manutenção.`,'hit');continue;}
          if(v.roadIndex>=v.roadPoints.length){
            v.loc=dest; v.path=[]; v.roadPoints=[]; v.roadIndex=0; v.note=''; v._cand=null; v._candD=0;
            if(v._encTid!==dest) Police.roadEncounter(v,dest);
            v._encTid=null;
          } else this.trackTerritory(v,travelled);
          continue;
        }

        // Lanchas continuam com navegação livre pela água.
        const tgt=World.ix[v.path[0]];
        const dx=tgt.center[0]-v.x,dy=tgt.center[1]-v.y,d=Math.hypot(dx,dy);
        const step=V.speed*dh,burnPerPx=V.burn/10;
        const fuelDistance=v.fuel/Math.max(0.00001,burnPerPx),travel=Math.min(step,d,fuelDistance);
        if(travel<=0.0001){v.fuel=0;v.note='sem combustível';continue;}
        if(d>0.001){v.x+=dx/d*travel;v.y+=dy/d*travel;}
        v.fuel=Math.max(0,v.fuel-travel*burnPerPx);
        v.condition=Math.max(0,(v.condition||100)-travel*.0018);
        if(travel+0.001>=d){v.x=tgt.center[0];v.y=tgt.center[1];v.loc=v.path.shift();v.note='';}
        continue;
      }

      if(!v.route) continue;
      const {a,b,good}=v.route;
      const A=World.ix[a], B=World.ix[b];

      if(v.phase==='toA'||v.phase==='toB'){
        const dest=v.phase==='toA'?a:b;
        if(v.loc!==dest){
          if(!this.send(v,dest)){
            if(this.TERMINAL.includes(v.note)) this.abortRoute(v,v.note);
            else if(v.loc!==null && v.fuel<0.01) v.note='sem combustível';
          }
        } else {
          v.phase=v.phase==='toA'?'load':'unload';
        }
        continue;
      }

      if(v.phase==='load' && v.route.good==='item'){
        if(v.loc!==a){ v.phase='toA'; continue; }
        if(A.owner!==v.f){ v.note='origem perdida'; v.route=null; v.phase='idle'; continue; }
        const item=World.items?.find(i=>i.id===v.route.itemId);
        if(!item || item.loc!==a || item.equippedBy){
          v.note=item?'item indisponível':'item não encontrado';
          v.route=null; v.phase='idle'; continue;
        }
        // O item não é duplicado nem desaparece: sai do estoque físico do
        // território (loc=null) e passa a existir DENTRO do carro de apoio
        // (inTransitVeh) até a entrega em b.
        item.loc=null; item.inTransitVeh=v.id;
        v.phase='toB'; v.note='transportando item';
        continue;
      }
      if((v.phase==='unload'||v.loc===b) && v.route.good==='item'){
        if(v.loc!==b){ v.phase='toB'; continue; }
        const item=World.items?.find(i=>i.id===v.route.itemId);
        if(item){ item.loc=b; item.inTransitVeh=null; }
        if(v.f===0 && item) UI.log(`Item entregue em <b>${B.name}</b>: ${(typeof Personnel!=='undefined'?Personnel.ITEMS[item.key]?.name:null)||item.key}.`);
        v.route=null; v.phase='load'; v.note='';
        continue;
      }

      if(v.phase==='load'){
        if(v.loc!==a){ v.phase='toA'; continue; }
        if(A.owner!==v.f){
          v.note='origem perdida';
          if(v.tradeId){
            const tr=World.trades.find(x=>x.id===v.tradeId);
            if(tr) tr.status='cancelled';
            v.tradeId=null;
          }
          v.route=null; continue;
        }
        if(!fac.human && v.fuel<V.fuelCap*0.6) this.refuel(v);   // IA reabastece na origem antes de carregar

        let available=A.stock[good]||0;
        let trade=null;
        if(v.tradeId){
          trade=World.trades.find(x=>x.id===v.tradeId);
          available=trade?trade.qty-trade.loaded:0;
        }
        const take=Math.min(28*dh,V.cap-v.qty,available,v.route.amount-v.qty);

        if(take>0){
          if(trade){
            trade.loaded+=take;
          } else {
            A.stock[good]-=take;
          }
          v.cargo[good]+=take; v.qty+=take; v.note='carregando';
        }

        const targetQty=Math.min(V.cap,v.route.amount);
        if(v.qty>=targetQty-0.4 || (available<0.2 && v.qty>V.cap*0.25)){
          v.phase='toB'; v.note='';
        }
        continue;
      }

      if(v.phase==='unload'||v.loc===b){
        if(v.loc!==b){ v.phase='toB'; continue; }
        v.phase='unload';

        if(v.tradeId){
          this.finishTrade(v);
          if(v.tradeId) {
            const room=World.cap(B)-World.load(B);
            v.note=room<=0.5?'destino comercial lotado':'descarregando';
          }
          continue;
        }

        const room=World.cap(B)-World.load(B);
        const give=Math.min(30*dh,v.cargo[good],Math.max(0,room));
        B.stock[good]+=give; v.cargo[good]-=give; v.qty-=give;
        v.note=room<=0.5?'destino lotado':'descarregando';

        if(v.cargo[good]<=0.3){
          v.qty=Math.max(0,v.qty); v.phase='load'; v.note='';
          this.send(v,a);
        }
        continue;
      }

      v.phase=v.loc===a?'load':'toA';
    }
  }
};
