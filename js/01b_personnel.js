/* =============================== Personnel =============================== */
/* Cada Vapor ou Contenção deixa de ser só um número dentro do exército da
   facção: ao nascer (World.spawnUnit → Personnel.birth), ganha nome,
   personalidade, lealdade inicial, cargo (rank 0) e um inventário próprio.
   Dali em diante:
     • Personnel.stat(u,campo) é a ÚNICA fonte de atk/def/inf/speed efetivos
       — lida por Ops.combat, Ops.tick (marcha), Influence.tick e
       World.defBonus. Cargo, personalidade, equipamento, experiência e
       ferimento entram todos na mesma conta, sem duplicar combate ou
       influência em paralelo.
     • Personnel.upkeepOf(u) substitui o UNITS[kind].upkeep cru em
       World.upkeep, somando salário do cargo e manutenção de equipamento.
     • Personnel.tick(dh), chamado por 15_loop.js junto dos demais sistemas,
       cuida de experiência, desempenho, deriva de lealdade, deserção e
       promoção automática — para jogador e IA igualmente.
   Cargo e trilha de progressão: o arquétipo de combate/produção continua
   sendo u.kind (vapor/seguranca — é o que Render, Ops e Influence já sabem
   desenhar/calcular); u.rank é o degrau dentro da trilha desse arquétipo
   (TRACKS[kind][rank]), com nome de cargo, requisitos de promoção e
   multiplicadores próprios. Isso evita reescrever UNITS/Render/Ops do zero
   para cada novo cargo — cada cargo é só um multiplicador a mais sobre a
   base que já existe. */
const Personnel = {
  FIRST:['Aline','Bruno','Camila','Diego','Elaine','Fábio','Gabriela','Heitor','Igor','Janaína',
    'Kaique','Larissa','Marcos','Natália','Otávio','Patrícia','Rafael','Sabrina','Tiago','Vanessa',
    'Wagner','Yasmin','Zeca','André','Bianca','Caio','Débora','Everton','Flávia','Gustavo',
    'Helena','Ivo','Júlia','Leandro','Mônica','Nelson','Priscila','Renato','Simone','Thiago'],
  LAST:['Almeida','Barros','Cardoso','Duarte','Farias','Guimarães','Henriques','Ibrahim','Junqueira',
    'Klein','Lopes','Machado','Nogueira','Oliveira','Pereira','Queiroz','Ramos','Siqueira','Teixeira',
    'Ventura','Xavier','Zanetti','Andrade','Batista','Correia','Dantas','Esteves','Fontoura','Gouveia'],

  /* Trilha de cargos por arquétipo. rank 0 é sempre o próprio UNITS[kind]
     base (nome/custo/hora já existentes lá) — as trilhas só descrevem o que
     muda a PARTIR do rank 1. */
  TRACKS:{
    vapor:[
      {name:'Vapor', mult:{atk:1,def:1,inf:1,speed:1}, salary:12},
      {name:'Gerente de Ponto', reqExp:55, reqLoyalty:55, reqPerf:8,  mult:{atk:1,def:1,inf:1.6,speed:1},   salary:32},
      {name:'Gerente Regional', reqExp:150,reqLoyalty:65, reqPerf:20, mult:{atk:1,def:1,inf:2.3,speed:1.1}, salary:60},
    ],
    seguranca:[
      {name:'Contenção', mult:{atk:1,def:1,inf:1,speed:1}, salary:18},
      {name:'Chefe de Segurança', reqExp:65, reqLoyalty:50, reqPerf:10, mult:{atk:1.35,def:1.3,inf:1.2,speed:1.05}, salary:44},
      {name:'Comandante',         reqExp:170,reqLoyalty:60, reqPerf:24, mult:{atk:1.8, def:1.7,inf:1.4,speed:1.1},  salary:80},
    ],
  },

  /* Equipamento individual — efeito real e aditivo sobre a estatística do
     personagem (ver stat()). slot: um item por slot por personagem; equipar
     outro do mesmo slot substitui o anterior (o item antigo NÃO é perdido —
     cai fisicamente no território atual do personagem, ver unequip()).
     minRank: alguns itens só fazem sentido (ou só são liberados) a partir de
     um certo cargo. O catálogo em si mora em 01_config.js (ITEM_CATALOG) —
     única fonte de verdade também para qualquer tela de UI que já leia
     Personnel.ITEMS; mantido aqui como alias para não quebrar nada que
     dependa deste nome. */
  ITEMS: ITEM_CATALOG,

  PERSONALITIES: ['cauteloso', 'ambicioso', 'leal', 'oportunista', 'disciplinado', 'agressivo', 'economico'],

  rnd(){ return Math.max(0,Math.min(1,(Math.random()+Math.random())/2)); },
  randomName(){
    const fn=this.FIRST[Math.floor(Math.random()*this.FIRST.length)];
    const ln=this.LAST[Math.floor(Math.random()*this.LAST.length)];
    return `${fn} ${ln}`;
  },

  /* Chamado por World.spawnUnit logo após criar a unidade: transforma o
     registro genérico em um personagem com identidade própria. */
  birth(u){
    if (u.isIndividual) return u; // Migração segura: evita sobrescrever quem já nasceu
    u.isIndividual = true;
    u.name=this.randomName();
    u.personality=this.PERSONALITIES[Math.floor(Math.random()*this.PERSONALITIES.length)];
    u.traits={coragem:this.rnd(),lealdadeBase:this.rnd(),ambicao:this.rnd(),disciplina:this.rnd(),carisma:this.rnd()};
    u.rank=0;
    u.exp=0; u.performance=0; u.morale=80 + Math.random()*20;
    const rep=World.fac[u.f]?.reputation??50;
    u.loyalty=Math.max(5,Math.min(95,Math.round(40+u.traits.lealdadeBase*35+(rep-50)*0.15)));
    u.status='ativo';
    u.inventory=[];
    return u;
  },

  /* Executa a migração segura de todas as unidades antigas. */
  migrateAll(){
    if(typeof World !== 'undefined' && World.units){
      for(const u of World.units){
        if(u.kind==='vapor' || u.kind==='seguranca'){
          this.birth(u);
        }
      }
    }
  },

  cargoName(u){
    const track=this.TRACKS[u.kind];
    return track?.[u.rank||0]?.name || UNITS[u.kind]?.name || u.kind;
  },
  tier(u){ const track=this.TRACKS[u.kind]; return (track&&track[u.rank||0])||{mult:{atk:1,def:1,inf:1,speed:1},salary:0}; },

  /* Liderança: medida abstrata de jogo (NÃO é uma stat de combate isolada)
     usada por Ops para saber se uma composição tem alguém capaz de
     coordenar o grupo. Cargo (rank) pesa mais que qualquer traço sozinho —
     um Comandante lidera melhor que um Contenção raso mesmo com os mesmos
     traços — mas carisma/disciplina modulam o quanto esse cargo realmente
     rende em coordenação. Não duplica Personnel.stat(): é uma leitura
     agregada separada, só para efeitos de COMPOSIÇÃO de equipe (ver
     08_operations.js), nunca usada como atk/def bruto. */
  leadership(u){
    const rankMult=1+(u.rank||0)*0.5;
    return rankMult*(0.5+0.3*(u.traits?.carisma??0.5)+0.2*(u.traits?.disciplina??0.5));
  },

  /* Projeção serializável e legível de um personagem — atributos efetivos
     (via stat(), já considerando cargo/personalidade/equipamento/ferimento),
     equipamento físico atual e estado. Única porta de leitura "de fora" do
     personagem: qualquer módulo (Ops, UI) que precise mostrar/avaliar um
     personagem usa isto, em vez de reimplementar a leitura de u.* por
     conta própria — o que criaria uma segunda fonte de verdade. */
  summary(u){
    const equip=(u.inventory||[]).map(itemId=>{
      const item=World.items?.find(i=>i.id===itemId); if(!item) return null;
      const tpl=this.ITEMS[item.key];
      return {id:item.id, key:item.key, name:tpl?.name||item.key, slot:tpl?.slot, condition:Math.round(item.condition)};
    }).filter(Boolean);
    return {
      id:u.id, name:u.name, kind:u.kind, cargo:this.cargoName(u), rank:u.rank||0,
      personality:u.personality, traits:u.traits,
      exp:Math.round(u.exp||0), morale:Math.round(u.morale||0), loyalty:Math.round(u.loyalty||0),
      performance:Math.round(u.performance||0), status:u.status||'ativo', state:u.state,
      hp:Math.round(u.hp), maxhp:u.maxhp, leadership:+this.leadership(u).toFixed(2),
      equip,
      stats:{
        atk:+this.stat(u,'atk').toFixed(2), def:+this.stat(u,'def').toFixed(2),
        inf:+this.stat(u,'inf').toFixed(2), speed:+this.stat(u,'speed').toFixed(2)
      }
    };
  },

  /* Estatística efetiva de combate/influência/deslocamento.
     Agora calcula baseando-se nas instâncias físicas de itens. */
  stat(u,field){
    const U=UNITS[u.kind]; if(!U) return 0;
    const t=this.tier(u);
    let v=(U[field]||0)*(t.mult?.[field]??1);
    if(field==='atk') v*=(0.75+0.5*(u.traits?.coragem??0.5));
    if(field==='def') v*=(0.8+0.4*(u.traits?.disciplina??0.5));
    if(field==='inf') v*=(0.85+0.3*(u.traits?.carisma??0.5));
    let weightPenalty=0;
    for(const itemId of (u.inventory||[])){ 
      const item = World.items?.find(i => i.id === itemId);
      if(item){
        const template = this.ITEMS[item.key];
        if(template && template[field]){
          let bonus = template[field];
          // Degradação de atributo baseado no estado de conservação (abaixo
          // de 50% perde efetividade) — mesmo campo usado por Items.tick.
          if(bonus > 0 && item.condition < 50) bonus *= (item.condition / 50);
          // Confiabilidade: um item malfeito/desgastado rende menos ataque
          // efetivo mesmo com a peça inteira — não é só sorte narrativa.
          if(field==='atk' && template.reliab) bonus*=template.reliab;
          v += bonus;
        }
        if(field==='speed' && template) weightPenalty+=(template.weight||0);
      } 
    }
    if(field==='speed' && weightPenalty>0) v*=Math.max(0.5,1-weightPenalty*0.03);
    if(field==='atk'||field==='def') v*=(1+Math.min(0.25,(u.exp||0)/400)); // veterania
    if(u.status==='ferido') v*=0.55;
    return v;
  },

  upkeepOf(u){
    const U=UNITS[u.kind]; if(!U) return 0;
    const t=this.tier(u);
    let up=U.upkeep+(t.salary||0)*0.6;
    for(const itemId of (u.inventory||[])){ 
      const item = World.items?.find(i => i.id === itemId);
      if(item) {
         const template = this.ITEMS[item.key];
         if(template) up+=(template.cost||0)*0.004; 
      }
    }
    return up;
  },

  eligiblePromotion(u){
    const track=this.TRACKS[u.kind]; if(!track) return null;
    const next=track[(u.rank||0)+1]; if(!next) return null;
    if((u.exp||0)>=(next.reqExp||0) && (u.loyalty||0)>=(next.reqLoyalty||0) && (u.performance||0)>=(next.reqPerf||0)) return next;
    return null;
  },
  promote(u){
    const next=this.eligiblePromotion(u);
    if(!next) return 'Ainda não elegível para promoção.';
    u.rank=(u.rank||0)+1;
    u.loyalty=Math.min(100,(u.loyalty||50)+6); 
    if(u.f===0 && typeof UI!=='undefined') UI.log(`<b>${u.name}</b> foi promovido a <b>${next.name}</b>.`,'win');
    return null;
  },
  fire(u){
    const i=World.units.indexOf(u); if(i<0) return 'Personagem não encontrado.';
    // Drop all items before firing
    for(const itemId of [...(u.inventory||[])]) this.unequip(u, itemId);
    World.units.splice(i,1);
    if(u.f===0 && typeof UI!=='undefined') UI.log(`<b>${u.name}</b> (${this.cargoName(u)}) foi dispensado.`);
    return null;
  },
  desert(u){
    const i=World.units.indexOf(u); if(i<0) return;
    // Drop all items
    for(const itemId of [...(u.inventory||[])]) this.unequip(u, itemId);
    World.units.splice(i,1);
    if(u.f===0){
      if(typeof UI!=='undefined') UI.log(`<b>${u.name}</b> (${this.cargoName(u)}) abandonou a firma — lealdade esgotada.`,'hit');
      if(typeof Notifications!=='undefined') Notifications.push('threat','Deserção',`${u.name} deixou a organização por falta de lealdade.`,1,`desert-${u.id}`);
    }
  },
  
  /* Fabricação de Item Físico — a ÚNICA porta de entrada de equipamento na
     economia. Nada aparece por mágica: exige caixa real da firma (fonte de
     verdade: World.fac[].money) e estoque físico de 'armas' NO TERRITÓRIO
     (fonte de verdade: t.stock, o mesmo estoque usado por Econ/Logi/Prod) —
     não é um contador paralelo. O item nasce fisicamente ali (loc:tId), sem
     dono individual ainda; só passa a valer algo quando um personagem
     presente no MESMO território o equipar (ver equip()). */
  craftItem(tId, itemKey, fId){
    const template = this.ITEMS[itemKey]; if(!template) return 'Item inválido.';
    const f = World.fac[fId]; const t = World.ix[tId];
    if(!f || !t) return 'Erro interno.';
    if(t.owner!==fId) return 'A fabricação exige um território sob controle da firma.';
    if(f.money < template.cost) return `Caixa insuficiente (${money(template.cost)} necessários).`;
    if(template.reqArmas && (t.stock.armas || 0) < template.reqArmas) return `Estoque de armas insuficiente (${template.reqArmas} necessários).`;
    
    f.money -= template.cost;
    if(template.reqArmas) t.stock.armas -= template.reqArmas;
    
    if(!World.items) World.items = [];
    const item = {
      id: World.uid++,
      key: itemKey,
      condition: 100,
      loc: tId,
      owner: fId,
      equippedBy: null
    };
    World.items.push(item);
    if(fId===0 && typeof UI!=='undefined') UI.log(`<b>${template.name}</b> fabricado em ${t.name}.`);
    return item;
  },

  /* Equipa uma instância física do item. */
  equip(u, itemId){
    const item = World.items?.find(i => i.id === itemId);
    if(!item) return 'Item físico não encontrado.';
    if(item.loc !== u.loc && item.loc !== null) return 'O item não está no mesmo território que o personagem.';
    if(item.equippedBy) return 'Este item já está equipado por alguém.';
    if(item.owner !== u.f) return 'Este item pertence a outra firma.';
    
    const template = this.ITEMS[item.key];
    if(template.kind && template.kind!==u.kind) return `${template.name} exige a linha de ${UNITS[template.kind]?.name||template.kind}.`;
    if((u.rank||0)<(template.minRank||0)) return 'Cargo insuficiente para este equipamento.';
    
    // Unequip item in the same slot
    const oldItemId = (u.inventory||[]).find(k => {
      const oldItem = World.items?.find(i => i.id === k);
      return oldItem && this.ITEMS[oldItem.key].slot === template.slot;
    });
    if(oldItemId) this.unequip(u, oldItemId);
    
    item.equippedBy = u.id;
    item.loc = null; // follows the character
    u.inventory = u.inventory || [];
    u.inventory.push(itemId);
    return null;
  },
  
  /* Desequipa uma instância física, devolvendo ao território. */
  unequip(u, itemId){
    if(!u.inventory || !u.inventory.includes(itemId)) return 'Este personagem não possui esse item.';
    u.inventory = u.inventory.filter(k => k !== itemId);
    const item = World.items?.find(i => i.id === itemId);
    if(item){
      item.equippedBy = null;
      item.loc = u.loc; // Drops in the character's current location
    }
    return null;
  },

  /* Transferência direta entre dois personagens PRESENTES no mesmo
     território — não move o item no mapa, só troca de mãos (a mudança de
     território de um item sempre passa pela logística real, ver
     Logi.assignItem). Reaproveita equip/unequip, então todas as mesmas
     checagens (slot, cargo mínimo, arquétimo) valem aqui também. */
  transferItem(fromU, toU, itemId){
    if(!fromU || !toU) return 'Personagem inválido.';
    if(fromU.loc!==toU.loc || fromU.loc===null) return 'Os personagens precisam estar no mesmo território.';
    if(!(fromU.inventory||[]).includes(itemId)) return 'Este personagem não possui esse item.';
    const err1=this.unequip(fromU,itemId); if(err1) return err1;
    const err2=this.equip(toU,itemId);
    if(err2){ this.equip(fromU,itemId); return err2; } // reverte se o destino recusar
    return null;
  },

  /* Descarte explícito: tira o item de qualquer inventário (se equipado) e
     o deixa fisicamente largado no território indicado — usado por "perder
     item" em combate/deserção e por decisões manuais do jogador. */
  dropItem(itemId, atLoc){
    const item = World.items?.find(i=>i.id===itemId);
    if(!item) return 'Item físico não encontrado.';
    if(item.equippedBy){
      const u=World.units.find(x=>x.id===item.equippedBy);
      if(u) this.unequip(u,itemId);
    }
    item.loc = atLoc ?? item.loc;
    item.equippedBy = null;
    return null;
  },

  /* Manutenção contínua de todo o pessoal do jogo — experiência, desempenho,
     deriva de lealdade, deserção e promoção automática. Promoção é aplicada
     assim que elegível (para jogador e IA igualmente) em vez de exigir uma
     tela de aprovação dedicada: o resultado aparece no log/ficha do
     personagem, e o requisito em si (exp+lealdade+desempenho reais) é o que
     importa para o pedido de "progressão por mérito". */
  tick(dh){
    for(const u of World.units){
      if(u.f==null || u.f<0) continue;
      if(!u.isIndividual) this.birth(u); // Migração sob demanda no loop
      const f=World.fac[u.f]; if(!f) continue;
      u.exp=(u.exp||0)+0.15*dh*(u.state==='idle'?0.4:1);
      const upk=World.upkeep(u.f);
      const healthy=f.money>upk*30;
      u.morale=Math.max(0,Math.min(100,(u.morale||80)+dh*(healthy?0.5:-1.0)));
      u.performance=Math.max(0,Math.min(60,(u.performance||0)+dh*(healthy?0.06:-0.03)));
      const wantsGrowth=((u.traits?.ambicao??0.5)-0.5)*(this.eligiblePromotion(u)?0.02:-0.03);
      u.loyalty=Math.max(0,Math.min(100,(u.loyalty??60)+((healthy?0.02:-0.06)+wantsGrowth)*dh));
      if(u.morale<30) u.loyalty=Math.max(0, u.loyalty - 0.2*dh); // Impacto da moral na lealdade
      
      if(u.loyalty<18 && u.state==='idle' && Math.random()<0.002*dh*(1.5-(u.traits?.disciplina??0.5))){
        this.desert(u); continue;
      }
      // Recuperação: só em repouso (idle), nunca durante preparo/marcha/
      // combate. Ferido recupera mais devagar até sair do status.
      if(u.state==='idle' && (u.hp||0)<(u.maxhp||0)){
        u.hp=Math.min(u.maxhp, u.hp+(u.status==='ferido'?0.8:1.6)*dh);
        if(u.status==='ferido' && u.hp>=u.maxhp*0.7) u.status='ativo';
      }
      if(this.eligiblePromotion(u)) this.promote(u);

      // Desgaste de equipamento: peças em uso ativo (marcha, preparo, combate)
      // se desgastam; ociosas praticamente não. Combate desgasta mais rápido
      // (ver Ops.combat, que já reduz u.ammo — aqui é o desgaste do OBJETO
      // físico, não da munição consumível).
      for(const itemId of (u.inventory||[])){
        const item=World.items?.find(i=>i.id===itemId); if(!item) continue;
        const wear=u.state==='idle'?0.01:(u.state==='moving'||u.state==='prep'?0.06:0.02);
        item.condition=Math.max(0,item.condition-wear*dh);
        // Peça sucateada: além de perder quase todo o efeito (ver stat()),
        // uma fração ínfima por hora se perde de vez — reforça que
        // "perder item" é uma consequência real, não só cosmética.
        if(item.condition<=0 && Math.random()<0.01*dh){
          this.unequip(u,itemId);
          const idx=World.items.indexOf(item); if(idx>=0) World.items.splice(idx,1);
          if(u.f===0 && typeof UI!=='undefined') UI.log(`${this.ITEMS[item.key]?.name||item.key} de <b>${u.name}</b> se perdeu de tão desgastado.`,'hit');
        }
      }
    }
  },

  /* Manutenção física de uma peça — mesma lógica de custo de Logi.repair
     para veículos: caixa real da firma, sem reembolso mágico de condição. */
  repairItem(itemId, fId){
    const item=World.items?.find(i=>i.id===itemId); if(!item) return 'Item físico não encontrado.';
    if(item.condition>=99) return 'O item já está em boas condições.';
    const f=World.fac[fId]; if(!f) return 'Firma inválida.';
    const template=this.ITEMS[item.key];
    const cost=Math.round((100-item.condition)*(template?.cost||100)*0.006);
    if(f.money<cost) return `Manutenção custa ${money(cost)}.`;
    f.money-=cost; item.condition=100;
    return null;
  },
};
