/* ================================ World ================================= */
const World = {
  h:6, uid:1, terr:[], ix:{}, fac:[], units:[], veh:[], ops:[], trades:[], loans:[], events:[], shortages:[], relations:{}, coordination:{requests:[],seq:1}, supplyOffers:[], purchaseOffers:[], over:false, speed:1, selected:null, statsTimer:0, stats:{money:[],net:[],territory:[],heat:[],income:[],upkeep:[]}, vacancies:[], greed:{}, peakFortune:0, peakDay:1, chronicle:[],

  /* "Crônica" da partida: linha do tempo curta de golpes/eventos marcantes
     contra o jogador (traição, batida, abandono de território por falta de
     caixa, perda de território por influência...), usada pela tela de fim de
     jogo (UI.end) para mostrar "os últimos golpes". Chamada por vários
     módulos (06_influence, 09_police_city, 11_alerts_rules) — antes não
     existia de fato (só World.chronicle.slice era lido em 14_ui.js), então
     qualquer chamada a World.chron(...) derrubava o jogo em runtime com
     "World.chron is not a function". */
  chron(txt){
    this.chronicle.push({h:this.h,txt});
    if(this.chronicle.length>40) this.chronicle.shift();
  },

  reset(){
    const {list,ix}=MapData.build();
    this.terr=list; this.ix=ix; this.units=[]; this.veh=[]; this.ops=[]; this.trades=[]; this.loans=[]; this.events=[]; this.shortages=[]; this.supplyOffers=[];
    this.items=[]; // Physical items
    this.h=6; this.uid=1; this.over=false; this.selected=null; this.purchaseOffers=[]; this.statsTimer=0; this.stats={money:[],net:[],territory:[],heat:[],income:[],upkeep:[]};
    this.chronicle=[];
    // Sem estas três linhas, Rules.tick → Succession.tick/Greed.tick liam
    // World.vacancies/World.greed/World.peakFortune ainda `undefined` no
    // primeiro tick da partida (o objeto World nunca os declarava fora do
    // reset), derrubando o jogo com "Cannot read properties of undefined
    // (reading 'length')" já no Dia 1.
    this.vacancies=[]; this.greed={}; this.peakFortune=0; this.peakDay=Math.floor(this.h/24)+1;
    this.fac=FACTIONS.map(f=>({...f, money:9000, heat:0, alive:true, hold:0, lastOp:-200, drivers:0,admins:2,credit:0,reputation:50}));
    this.relations={}; this.coordination={requests:[],seq:1};
    if(typeof Notifications!=='undefined') Notifications.clear();
    // Sem isto, uma nova partida herdaria a personalidade já evoluída (ou
    // regredida) da partida anterior — cada firma precisa sortear um
    // temperamento novo a cada início de jogo.
    if(typeof AI!=='undefined') AI.resetAll();
    Supply.reset(); PurchaseOffers.reset();
    for(let a=0;a<this.fac.length;a++) for(let b=0;b<this.fac.length;b++) this.relations[`${a}:${b}`]=a===b?'aliada':'neutra';
    // Um parceiro comercial inicial permite testar o sistema imediatamente.
    this.relations['0:1']=this.relations['1:0']='aliada';

    // Ilha de verdade: antes t.island vinha sempre `false` de MapData.build()
    // e todo o sistema de ilha (bônus de defesa, exigência de lancha em Ops,
    // rota marítima obrigatória em World.path) nunca disparava. Agora a
    // malha real (RoadNet, que já sabe separar componentes de terra
    // conectados por estrada/vau de até FORD_MAX px) decide: um território
    // é ilha se não está na mesma massa de terra que 'centro' (sede da
    // facção 0, certamente continental). Isso ativa o sistema com geografia
    // real do mapa em vez de uma lista inventada de nomes.
    RoadNet.ensure();
    for(const t of list) t.island=!RoadNet.sameComponent(t.id,'centro');

    for(const t of list){
      t.owner=null; t.stock={}; for(const g of GK) t.stock[g]=0;
      t.buildings={}; for(const b in BUILD) t.buildings[b]=false;
      t.pointStock={}; for(const g of SELLABLE) t.pointStock[g]=0;
      t.pointCap=80; t.heat=0; t.eventMult=1;
      // priceMult: markup que o DONO do território define livremente sobre
      // o preço-base da Boca (1 = preço de mercado). Jogador e IA podem
      // subir para lucrar mais por unidade ou baixar para vender mais
      // rápido — ambos com consequências reais (ver Econ.setMarkup/tick).
      t.priceMult={}; for(const g of SELLABLE) t.priceMult[g]=1;
      t.works=[];                       // obras e recrutamentos em andamento
      // Cada território tem UMA única função econômica, definida pelo seu
      // tipo — nunca as duas ao mesmo tempo (ex.: um Porto nunca também
      // roda uma fábrica). Só territórios do tipo 'sitio' (matéria-prima
      // crua) ou 'oficina' (industrial) recebem uma fábrica; Porto, Boca e
      // Bairro têm seus próprios papéis exclusivos (importar, escoar,
      // arrecadar) e não produzem nada.
      if(t.type==='sitio'||t.type==='oficina'){
        const fk=FACTORY_BY_TERRITORY[t.id]||(t.type==='sitio'?'roca':'oficina');
        t.factory={kind:fk,level:1,active:false,produced:0,lastOutput:0,bottleneck:null,stuckSince:0,lastCost:0};
      } else {
        t.factory=null;
      }
      t.inf={0:0,1:0,2:0,3:0};
      t.unrest=0; t.fighting=0;
      t.price={}; for(const g of SELLABLE) t.price[g]=1;
      t.demand=this.demandOf(t);
    }
    for(const f of this.fac){
      const t=ix[f.home];
      t.owner=f.id; t.inf[f.id]=80; t.buildings.ponto=true; t.buildings.deposito=true;
      // Estoque inicial cobre um pouco de cada insumo industrial (fuel,
      // ammo, insumo) para dar folego até a primeira rota de suprimento
      // ser organizada — sem isso, quem nasce numa Oficina/Refinaria/
      // Armaria ficaria travado no minuto zero, incapaz de produzir nada.
      t.stock.fuel=320; t.stock.ammo=90; t.stock.insumo=120; t.stock.quimico=40;
      this.spawnUnit(f.id,'vapor',t.id); this.spawnUnit(f.id,'vapor',t.id);
      this.spawnUnit(f.id,'seguranca',t.id);
      this.spawnVeh(f.id,'van',t.id);
      if(f.id===0) this.spawnVeh(f.id,'van',t.id);
      f.drivers=World.veh.filter(v=>v.f===f.id).length; f.patrimony=World.veh.filter(v=>v.f===f.id).reduce((a,v)=>a+VEHICLES[v.kind].cost,0);
    }
  },
  demandOf(t){
    const scale=Math.max(.35,t.pop/6000), d={};
    const p={
      enseadaazul:{cinza:.78,ambar:.46,rubra:.14}, farol:{cinza:.42,ambar:.30,rubra:.10},
      marina:{cinza:1.18,ambar:.72,rubra:.24}, caisnorte:{cinza:.55,ambar:.44,rubra:.16},
      pontaverde:{cinza:.62,ambar:.30,rubra:.08}, costaleste:{cinza:.86,ambar:.50,rubra:.16},
      centro:{cinza:1.75,ambar:1.02,rubra:.40}, geriba:{cinza:1.30,ambar:1.00,rubra:.30},
      joaofernandes:{cinza:.82,ambar:.92,rubra:.38}, manguinhos:{cinza:.62,ambar:.48,rubra:.16},
      canto:{cinza:1.10,ambar:.56,rubra:.18}, ferradura:{cinza:.88,ambar:.62,rubra:.22},
      rasa:{cinza:.55,ambar:.22,rubra:.05}, tucuns:{cinza:.48,ambar:.18,rubra:.04}, brava:{cinza:.68,ambar:.50,rubra:.17}
    }[t.id] || (t.type==='boca'?{cinza:1.35,ambar:.78,rubra:.27}:t.type==='bairro'?{cinza:.82,ambar:.28,rubra:.07}:{cinza:.15,ambar:.05,rubra:.01});
    for(const g of SELLABLE) d[g]=(p[g]||0)*scale;
    return d;
  },
  cap(t){ return 260*t.infra + (t.buildings.deposito?(BUILD.deposito.capBonus||0):0); },
  load(t){ let s=0; for(const g of GK) s+=t.stock[g]; return s; },
  defBonus(t){
    let b=t.island?0.2:0;
    if(t.buildings.refugio) b+=BUILD.refugio.defBonus||0;
    if(t.buildings.ponto) b+=0.1;
    b += (t.inf[t.owner]||0)/300;
    // Guarnição: cada unidade de defesa (UNITS[].def) presente e ociosa no
    // território soma à defesa dele — antes o bônus de defesa vinha só de
    // construções e influência, e as unidades de guarnição não faziam
    // NENHUMA diferença fora do combate direto já em andamento. Agora
    // manter pessoal parado ali de propósito também protege o território.
    const garrison=t.owner!=null?this.units.filter(u=>u.loc===t.id&&u.f===t.owner&&u.state==='idle'):[];
    for(const u of garrison) b+=(typeof Personnel!=='undefined'?Personnel.stat(u,'def'):(UNITS[u.kind]?.def||0))*0.6;
    return b;
  },
  owned(f){ return this.terr.filter(t=>t.owner===f); },
  at(tid,f,kind){ return this.units.filter(u=>u.loc===tid && u.state==='idle' && (f===undefined||u.f===f) && (!kind||u.kind===kind)); },
  /* Itens fisicamente presentes (não equipados, não em trânsito num
     veículo) num território — fonte usada por Logi.assignItem/UI para
     saber o que pode ser equipado ou embarcado ali. */
  itemsAt(tid,f){ return (this.items||[]).filter(i=>i.loc===tid && !i.equippedBy && (f===undefined||f===null||i.owner===f)); },
  relation(a,b){ return this.relations[`${a}:${b}`]||'neutra'; },
  setRelation(a,b,r){ this.relations[`${a}:${b}`]=r; this.relations[`${b}:${a}`]=r; },

  spawnUnit(f,kind,tid){
    const U=UNITS[kind], t=this.ix[tid];
    const ap=RoadNet.accessPoint(tid);
    const u={id:this.uid++,f,kind,hp:U.hp,maxhp:U.hp,loc:tid,state:'idle',
      x:ap?ap[0]:t.center[0],y:ap?ap[1]:t.center[1],path:[],ammo:0,op:null,roadPoints:null,roadIndex:0};
    // Cada Vapor/Contenção nasce como PERSONAGEM (nome, personalidade, cargo,
    // lealdade, inventário) — não só um número no exército da facção.
    if(typeof Personnel!=='undefined') Personnel.birth(u);
    this.units.push(u); return u;
  },
  spawnVeh(f,kind,tid){
    const t=this.ix[tid];
    const V=VEHICLES[kind];
    const ap=!V.sea?RoadNet.accessPoint(tid):null;
    const v={id:this.uid++,f,kind,loc:tid,x:ap?ap[0]:t.center[0],y:ap?ap[1]:t.center[1],
      cargo:{},qty:0,fuel:Math.round(V.fuelCap*0.7),condition:100,path:[],route:null,phase:'idle',note:'',tradeId:null,lastRoadEventH:-999,roadPoints:[],roadIndex:0};
    for(const g of GK) v.cargo[g]=0;
    this.veh.push(v); return v;
  },
  dist(a,b){ const A=this.ix[a].center,B=this.ix[b].center; return Math.hypot(A[0]-B[0],A[1]-B[1]); },
  path(from,to,sea,fid=null){
    const ok=id=>{ const t=this.ix[id]; return !!t && (t.island ? !!sea : true); };
    if(!ok(to)||!ok(from)) return null;
    if(!sea){
      return RoadNet.territorySequence(from,to);
    }
    const dist={},prev={},open=new Set(this.terr.map(t=>t.id));
    for(const t of this.terr) dist[t.id]=Infinity;
    dist[from]=0;
    while(open.size){
      let c=null,best=Infinity;
      for(const id of open){ if(dist[id]<best){best=dist[id];c=id;} }
      if(c===null||best===Infinity) break;
      open.delete(c); if(c===to) break;
      const cur=this.ix[c];
      for(const n of cur.neighbors){ if(!open.has(n)||!ok(n)) continue;
        const nt=this.ix[n]; let risk=0;
        if(fid!==null&&fid!==undefined){if(nt.owner!=null&&nt.owner!==fid)risk+=230;else if(nt.owner==null)risk+=22;risk+=(nt.unrest||0)*1.8;}
        const edge=this.dist(c,n)*(1+risk/1000),nd=dist[c]+edge;
        if(nd<dist[n]){dist[n]=nd;prev[n]=c;}
      }
    }
    if(dist[to]===Infinity)return null;const p=[];let k=to;while(k!==from){p.unshift(k);k=prev[k];if(k===undefined)return null;}return p;
  },
  pathDiagnose(from,to,fid=null){
    const a=this.ix[from], b=this.ix[to];
    if(!a||!b) return {ok:false,reason:'Território inválido.'};
    if(a.island||b.island) return {ok:false,reason:'Rota terrestre não se aplica: extremidade é território insular (exige lancha).'};
    return RoadNet.diagnose(from,to,fid);
  },
  roadRoute(from,to,fid=null){ return RoadNet.safeRoute(from,to,fid); },
  pathLen(p,from){ let d=0,c=from; for(const n of p){ d+=this.dist(c,n); c=n; } return d; },
  upkeep(fid){
    let u=0;
    for(const t of this.owned(fid)){
      u+=t.pop/1000*1.9+t.infra*2.2;
      for(const b in t.buildings) if(t.buildings[b]) u+=BUILD[b].upkeep;
    }
    for(const x of this.units) if(x.f===fid) u+=(typeof Personnel!=='undefined'?Personnel.upkeepOf(x):UNITS[x.kind].upkeep);
    for(const v of this.veh) if(v.f===fid) u+=VEHICLES[v.kind].upkeep+(v.condition<70?1.5:0);
    u+=(this.fac[fid]?.admins||0)*3;
    u+=Math.max(0,this.veh.filter(v=>v.f===fid).length-(this.fac[fid]?.drivers||0))*8;
    return u;
  },
  financialSnapshot(fid=0){
    const mine=this.owned(fid); let income=0;
    for(const t of mine){
      const mult=(1-t.unrest/110)*Math.min(1,(t.inf[fid]||0)/70);
      for(const g of SELLABLE) income+=Math.min(t.pointStock?.[g]>0?(t.demand[g]||0)*mult:0,(t.demand[g]||0))*GOODS[g].base*t.price[g]*(0.8+t.val*0.14);
      if(t.type==='bairro'||t.type==='boca') income+=t.pop/1000*0.55*Math.min(1,(t.inf[fid]||0)/80);
    }
    const upkeep=this.upkeep(fid);
    return {income,upkeep,net:income-upkeep};
  },
  recordStats(force=false){
    this.statsTimer+=1;
    if(!force && this.statsTimer<1) return;
    this.statsTimer=0;
    const f=this.fac[0]; if(!f) return;
    const snap=this.financialSnapshot(0);
    const push=(k,v)=>{this.stats[k].push({h:this.h,v:Number(v)||0});if(this.stats[k].length>36)this.stats[k].shift();};
    push('money',f.money); push('net',snap.net); push('income',snap.income); push('upkeep',snap.upkeep);
    push('territory',this.owned(0).length); push('heat',f.heat);
  },

  /* Poda listas que só crescem (trades concluídas/canceladas, eventos já
     exibidos). Sem isto, uma partida de muitas horas acumula esses arrays
     indefinidamente — cada JSON.stringify (ex.: World.save) e cada laço que
     percorre World.trades/World.events fica mais lento com o tempo. Negócios
     ainda em andamento (accepted/transporting) nunca são removidos. */
  trim(){
    if(this.trades.length>250){
      const active=this.trades.filter(t=>t.status==='accepted'||t.status==='transporting');
      const done=this.trades.filter(t=>t.status==='delivered'||t.status==='cancelled').slice(-150);
      this.trades=active.concat(done);
    }
    if(this.events.length>150) this.events=this.events.slice(-120);
    if(this.loans.length>200) this.loans=this.loans.slice(-150);
  },

  /* ============================ Save / Load ============================= */
  /* World é um objeto de dados simples (as "funções" abaixo são as únicas
     propriedades não serializáveis, e JSON.stringify as ignora sozinho).
     Não há referências circulares reais: `ix` aponta para os MESMOS objetos
     já presentes em `terr`, então excluí-lo do JSON (ele é reconstruído no
     load) evita duplicar o mapa inteiro no save sem perder nada. */
  SAVE_KEY:'peninsula_save_v1',
  save(){
    try{
      const json=JSON.stringify(this, (k,v)=> k==='ix' ? undefined : v);
      localStorage.setItem(this.SAVE_KEY, json);
      return true;
    }catch(e){
      console.error('[World.save] não foi possível salvar:', e);
      return false;
    }
  },
  hasSaved(){
    try{ return !!localStorage.getItem(this.SAVE_KEY); }
    catch(e){ return false; }
  },
  /* Restaura os dados salvos por cima do World atual. Como World já existe
     (com seus métodos) quando isto roda, Object.assign só sobrescreve as
     propriedades de DADOS presentes no save — os métodos (reset, save,
     spawnUnit, etc.) não estão no JSON e permanecem intactos. */
  loadSaved(){
    try{
      const raw=localStorage.getItem(this.SAVE_KEY);
      if(!raw) return false;
      const data=JSON.parse(raw);
      Object.assign(this, data);
      this.ix={};
      for(const t of this.terr) this.ix[t.id]=t;
      // Compatibilidade com saves anteriores ao sistema de itens físicos —
      // sem isto, World.items ficaria `undefined` e qualquer leitura
      // (itemsAt, Personnel.stat, Logi.assignItem) derrubaria o jogo.
      if(!this.items) this.items=[];
      if(typeof Notifications!=='undefined') Notifications.clear();
      return true;
    }catch(e){
      console.error('[World.loadSaved] não foi possível carregar:', e);
      return false;
    }
  },
  clearSaved(){
    try{ localStorage.removeItem(this.SAVE_KEY); return true; }
    catch(e){ return false; }
  },
};
