/* =============================== Render ================================= */
const Render=(()=>{
  // O lookup do canvas acontecia direto no topo do módulo: se #cv ainda não
  // existisse no DOM nesse instante (ordem/tempo de carregamento da página),
  // `cv.getContext` explodia com uma exceção não tratada e derrubava todo o
  // boot do jogo sem mensagem útil ("Script error."). Agora o módulo detecta
  // essa falta, avisa no console com uma causa clara e todo método público
  // vira um no-op seguro em vez de propagar a exceção — o resto do jogo
  // (World, UI, Loop) continua inicializando normalmente.
  const cv=document.getElementById('cv');
  const ctx=cv?cv.getContext('2d'):null;
  if(!cv||!ctx){
    console.error('[Render] Elemento <canvas id="cv"> não encontrado ou sem contexto 2D — a renderização do mapa ficará desativada, mas o restante do jogo continua.');
    const noop=()=>{};
    return {fit:noop,draw:noop,toWorld:()=>[0,0],zoomAt:noop,zoomBy:noop,resetView:noop,panBy:noop,get scale(){return 1;},cv:cv||null};
  }
  const W=1536,H=1024,view={s:1,ox:0,oy:0,baseS:1,baseOx:0,baseOy:0};
  const mapImg=new Image(); let mapReady=false; mapImg.onload=()=>{mapReady=true;draw();}; mapImg.src=BUZIOS_MAP_IMAGE;
  const territoryLayer=document.createElement('canvas'); territoryLayer.width=W; territoryLayer.height=H;
  const territoryCtx=territoryLayer.getContext('2d');
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  // ---------------------------------------------------------------------
  // Rastreamento leve de movimento (apenas visual): guarda a última posição
  // conhecida de cada unidade/veículo para derivar orientação e um pequeno
  // "trail" de deslocamento, sem tocar em nenhum dado de jogo. WeakMap evita
  // qualquer vazamento de memória — entradas somem sozinhas quando o objeto
  // de jogo é descartado.
  const motion=new WeakMap();
  function trackMotion(obj){
    let m=motion.get(obj);
    if(!m){ m={px:obj.x,py:obj.y,ang:0,moving:false}; motion.set(obj,m); }
    const dx=obj.x-m.px, dy=obj.y-m.py;
    const d2=dx*dx+dy*dy;
    if(d2>0.02){
      const targetAng=Math.atan2(dy,dx);
      // suaviza a rotação (menor caminho angular) em vez de saltar de ângulo
      let diff=targetAng-m.ang; while(diff>Math.PI)diff-=Math.PI*2; while(diff<-Math.PI)diff+=Math.PI*2;
      m.ang+=diff*0.35;
      m.moving=d2>0.05;
    } else { m.moving=false; }
    m.px=obj.x; m.py=obj.y;
    return m;
  }

  function limits(r,s){
    const minX=r.width-W*s, minY=r.height-H*s;
    const ox=s<=view.baseS+0.0001 ? (r.width-W*s)/2 : clamp(view.ox,minX-40,r.width+40);
    const oy=s<=view.baseS+0.0001 ? (r.height-H*s)/2 : clamp(view.oy,minY-40,r.height+40);
    return [ox,oy];
  }
  function fit(){
    const r=cv.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
    cv.width=Math.max(1,Math.round(r.width*dpr));cv.height=Math.max(1,Math.round(r.height*dpr));ctx.setTransform(dpr,0,0,dpr,0,0);
    view.baseS=Math.min(r.width/W,r.height/H);
    view.s=view.baseS;view.baseOx=(r.width-W*view.s)/2;view.baseOy=(r.height-H*view.s)/2;
    view.ox=view.baseOx;view.oy=view.baseOy;
    updateZoomUI();
  }
  function updateZoomUI(){
    const el=document.getElementById('zoomReadout');
    if(el) el.textContent=Math.round((view.s/Math.max(view.baseS,0.0001))*100)+'%';
  }
  function zoomAt(factor,sx,sy){
    const r=cv.getBoundingClientRect();
    const old=view.s;
    const next=clamp(old*factor,Math.max(view.baseS,0.0001),view.baseS*3.5);
    if(Math.abs(next-old)<0.00001) return;
    const wx=(sx-r.left-view.ox)/old, wy=(sy-r.top-view.oy)/old;
    view.s=next;
    view.ox=(sx-r.left)-wx*next; view.oy=(sy-r.top)-wy*next;
    const [ox,oy]=limits(r,next);view.ox=ox;view.oy=oy;
    updateZoomUI();draw();
  }
  function zoomBy(factor){
    const r=cv.getBoundingClientRect();zoomAt(factor,r.left+r.width/2,r.top+r.height/2);
  }
  function resetView(){fit();draw();}
  function panBy(dx,dy){
    const r=cv.getBoundingClientRect();
    if(view.s<=view.baseS+0.0001){view.ox=view.baseOx;view.oy=view.baseOy;return;}
    view.ox+=dx;view.oy+=dy;
    const minX=r.width-W*view.s,minY=r.height-H*view.s;
    view.ox=clamp(view.ox,minX-40,r.width+40);view.oy=clamp(view.oy,minY-40,r.height+40);
    draw();
  }
  const toWorld=(px,py)=>{const r=cv.getBoundingClientRect();return [(px-r.left-view.ox)/view.s,(py-r.top-view.oy)/view.s];};
  const path=p=>{ctx.beginPath();ctx.moveTo(p[0][0],p[0][1]);for(let i=1;i<p.length;i++)ctx.lineTo(p[i][0],p[i][1]);ctx.closePath();};
  function rr(x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}

  // Mistura leve de cor com branco/preto (para variações sutis de tonalidade
  // entre facções sem depender de cores neon). Puramente visual.
  function shade(hex,amt){
    const c=hex.replace('#','');
    if(c.length!==6) return hex;
    const n=parseInt(c,16);
    let r=(n>>16)&255,g=(n>>8)&255,b=n&255;
    r=clamp(Math.round(r+(amt>0?(255-r)*amt:r*amt)),0,255);
    g=clamp(Math.round(g+(amt>0?(255-g)*amt:g*amt)),0,255);
    b=clamp(Math.round(b+(amt>0?(255-b)*amt:b*amt)),0,255);
    return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
  }

  // Pontos de poeira/reflexo pré-gerados uma única vez (custo fixo, sem
  // alocação por frame). Posição é fixa; só opacidade/deslocamento vertical
  // oscilam com o tempo — efeito puramente visual, nenhum dado de jogo.
  const MOTES=Array.from({length:18},(_,i)=>({
    x:40+((i*337)%(W-80)), y:40+((i*211)%(H-80)),
    r:1.1+((i*53)%10)/10, spd:6000+((i*777)%4000), ph:(i*97)%1000,
  }));
  function drawMotes(now){
    ctx.save();
    for(const m of MOTES){
      const a=0.05+0.05*Math.sin(now/m.spd+m.ph);
      const dy=Math.sin(now/m.spd*1.7+m.ph)*6;
      ctx.fillStyle=`rgba(255,246,226,${Math.max(0,a)})`;
      ctx.beginPath(); ctx.arc(m.x,m.y+dy,m.r,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  function draw(){
    const r=cv.getBoundingClientRect();
    const now=performance.now();
    ctx.clearRect(0,0,r.width,r.height);
    ctx.save();ctx.translate(view.ox,view.oy);ctx.scale(view.s,view.s);ctx.textAlign='center';
    const zoomWorld=view.s/Math.max(view.baseS,.0001);

    // ---- MAPA -----------------------------------------------------------
    if(mapReady) ctx.drawImage(mapImg,0,0,W,H);
    else { ctx.fillStyle='#9fc9f5';ctx.fillRect(0,0,W,H); }
    // Leve vinheta/atmosfera para dar profundidade sem escurecer o mapa —
    // mais suave no centro, um pouco mais forte nas bordas.
    ctx.fillStyle='rgba(4,18,24,.10)';ctx.fillRect(0,0,W,H);
    const vg=ctx.createRadialGradient(W/2,H/2,H*0.28,W/2,H/2,H*0.72);
    vg.addColorStop(0,'rgba(3,14,18,0)'); vg.addColorStop(1,'rgba(2,10,13,.22)');
    ctx.fillStyle=vg; ctx.fillRect(0,0,W,H);

    // Poeira/luz ambiente flutuando sobre o mapa — só atmosfera, custo fixo
    // (18 pontos pré-computados uma única vez, reaproveitados todo frame;
    // nenhuma alocação nova, nenhum estado de jogo lido além de World.h para
    // dar a impressão de tempo passando). Puramente decorativo.
    drawMotes(now);

    // Vinheta de pressão policial: um vermelho muito sutil nas bordas quando
    // o calor da firma do jogador está alto — só transmite a mesma
    // informação que já existe em #heatFill/#heatTxt, de forma ambiental.
    // Não altera CONF.raidAt nem nenhuma regra; é só leitura de World.fac[0].
    if(World.fac && World.fac[0]){
      const heat=Math.max(0,Math.min(100,World.fac[0].heat||0));
      if(heat>55){
        const t=(heat-55)/45; // 0..1
        const pulse=0.5+0.5*Math.sin(now/(900-t*400));
        const hv=ctx.createRadialGradient(W/2,H/2,H*0.32,W/2,H/2,H*0.74);
        hv.addColorStop(0,'rgba(180,40,25,0)');
        hv.addColorStop(1,`rgba(180,40,25,${(0.05+0.10*t)*(0.7+0.3*pulse)})`);
        ctx.fillStyle=hv; ctx.fillRect(0,0,W,H);
      }
    }

    // Título/HUD do mapa
    ctx.save();
    ctx.shadowColor='rgba(0,0,0,.35)'; ctx.shadowBlur=10; ctx.shadowOffsetY=2;
    ctx.fillStyle='rgba(5,24,30,.72)';rr(22,18,280,34,8);ctx.fill();
    ctx.restore();
    ctx.strokeStyle='rgba(232,184,75,.35)';ctx.lineWidth=1;rr(22,18,280,34,8);ctx.stroke();
    ctx.fillStyle='#fff6e2';ctx.font='700 14px Archivo,sans-serif';ctx.fillText('PENÍNSULA · BÚZIOS VIVO',162,40);

    // ---- ESTRADAS ---------------------------------------------------------
    // Malha rodoviária: camada discreta, independente do domínio.
    // (RoadNet permanece intocado — apenas encapsulado numa leve sombra para
    // dar mais profundidade sem alterar a lógica/traçado das vias.)
    ctx.save();
    ctx.lineCap='round';
    ctx.shadowColor='rgba(0,0,0,.25)'; ctx.shadowBlur=2*Math.min(1,zoomWorld);
    RoadNet.draw(ctx,zoomWorld);
    ctx.restore();

    // Rotas ativas seguem a malha e destacam cada trecho realmente usado.
    // Feedback sutil: leve pulso na opacidade + um pequeno "brilho" de
    // deslocamento correndo ao longo do traço (puramente decorativo).
    ctx.save();
    ctx.lineCap='round';
    const dashPhase=-(now/45)%15;
    const routePulse=0.62+0.14*Math.sin(now/480);
    for(const v of World.veh){ if(v.f!==0||!v.route||VEHICLES[v.kind].sea) continue;
      // Só o trecho AINDA por percorrer: antes a linha voltava até o início da rota.
      const pts=v.roadPoints&&v.roadPoints.length?v.roadPoints.slice(Math.max(1,v.roadIndex||1)):((World.roadRoute(v.route.a,v.route.b,v.f))||[]);
      if(pts.length){
        ctx.lineWidth=3.2; ctx.setLineDash([]); ctx.lineDashOffset=0;
        ctx.strokeStyle='rgba(20,10,2,.28)';
        ctx.beginPath();ctx.moveTo(v.x,v.y);for(const q of pts)ctx.lineTo(q[0],q[1]);ctx.stroke();
        ctx.lineWidth=2.2; ctx.setLineDash([7,8]); ctx.lineDashOffset=dashPhase;
        ctx.strokeStyle=`rgba(232,184,75,${routePulse})`;
        ctx.beginPath();ctx.moveTo(v.x,v.y);for(const q of pts)ctx.lineTo(q[0],q[1]);ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.restore();

    const sel=World.selected?World.ix[World.selected]:null;

    // ---- TERRITÓRIOS ------------------------------------------------------
    /*
       Camada territorial: as células são desenhadas fora do canvas principal
       e recortadas pela máscara de terra. Assim nenhuma cor de facção entra no
       oceano e as fronteiras continuam exatamente compartilhadas.
       Ajuste visual: preenchimento com leve gradiente radial por território
       (em vez de cor chapada) e traço de fronteira em duas camadas — uma
       linha externa escura fina que separa territórios vizinhos com clareza,
       e a cor da facção por cima, mais fina. Isso deixa as fronteiras legíveis
       mesmo entre facções com cores próximas, sem poluir o mapa.
    */
    territoryCtx.clearRect(0,0,W,H);
    const tpath=p=>{territoryCtx.beginPath();territoryCtx.moveTo(p[0][0],p[0][1]);for(let i=1;i<p.length;i++)territoryCtx.lineTo(p[i][0],p[i][1]);territoryCtx.closePath();};
    for(const t of World.terr){
      const f=t.owner!=null?World.fac[t.owner]:null;
      const [cx,cy]=t.center;
      const infl=f?Math.min(1,(t.inf[t.owner]||0)/100):0;

      tpath(t.poly);
      if(f){
        const g=territoryCtx.createRadialGradient(cx,cy,4,cx,cy,90);
        g.addColorStop(0,shade(f.color,0.12));
        g.addColorStop(1,shade(f.color,-0.08));
        territoryCtx.fillStyle=g;
        territoryCtx.globalAlpha=0.22+0.16*infl;
      } else {
        territoryCtx.fillStyle='#ffffff';
        territoryCtx.globalAlpha=0.02;
      }
      territoryCtx.fill();
      territoryCtx.globalAlpha=1;

      // fronteira dupla: base escura (separa vizinhos) + linha de cor por cima
      tpath(t.poly);
      territoryCtx.lineWidth=sel&&sel.id===t.id?2.4:1.6;
      territoryCtx.strokeStyle='rgba(4,14,17,.55)';
      territoryCtx.stroke();
      tpath(t.poly);
      territoryCtx.lineWidth=sel&&sel.id===t.id?3.6:0.9;
      territoryCtx.strokeStyle=sel&&sel.id===t.id?'#fff6e2':(f?f.color:'rgba(230,239,229,.30)');
      territoryCtx.stroke();

      if(sel&&sel.id===t.id){
        territoryCtx.save();
        territoryCtx.globalAlpha=.16+.06*Math.sin(now/260);
        territoryCtx.shadowColor=f?f.color:'#fff6e2'; territoryCtx.shadowBlur=22;
        tpath(t.poly); territoryCtx.fillStyle=f?f.color:'#fff6e2'; territoryCtx.fill();
        territoryCtx.restore();
      }
    }
    if(MapData.landReady){
      territoryCtx.globalCompositeOperation='destination-in';
      territoryCtx.drawImage(MapData.landImg,0,0,W,H);
      territoryCtx.globalCompositeOperation='source-over';
    }
    ctx.drawImage(territoryLayer,0,0);

    /* Os nomes já existem no mapa-base. O jogo só mostra rótulos adicionais
       quando são úteis: território selecionado, território dominado ou zoom.
    */
    for(const t of World.terr){
      const f=t.owner!=null?World.fac[t.owner]:null;
      const [cx,cy]=t.center;
      const showLabel=(sel&&sel.id===t.id) || zoomWorld>=1.8;
      if(!showLabel) continue;
      ctx.save();
      const pulse=.5+.5*Math.sin(now/520+(t.id?t.id.length:0));
      const label=t.name;
      ctx.font='700 11px Archivo,sans-serif';
      const lw=Math.max(66,ctx.measureText(label).width+16);
      ctx.shadowColor='rgba(0,0,0,.4)'; ctx.shadowBlur=6; ctx.shadowOffsetY=1;
      ctx.fillStyle='rgba(6,23,28,.80)'; rr(cx-lw/2,cy-34,lw,20,6); ctx.fill();
      ctx.shadowColor='transparent'; ctx.shadowBlur=0; ctx.shadowOffsetY=0;
      if(sel&&sel.id===t.id){ ctx.strokeStyle='rgba(255,246,226,.5)'; ctx.lineWidth=1; rr(cx-lw/2,cy-34,lw,20,6); ctx.stroke(); }
      ctx.fillStyle='#fff6e2'; ctx.fillText(label,cx,cy-20);
      if(f){
        ctx.font='800 8.5px Archivo,sans-serif'; ctx.fillStyle=f.color; ctx.fillText(f.short.toUpperCase(),cx,cy-7);
        const w=56, ip=Math.min(1,(t.inf[t.owner]||0)/100);
        ctx.fillStyle='rgba(8,24,26,.72)'; rr(cx-w/2,cy+1,w,4,2); ctx.fill();
        ctx.fillStyle=f.color; rr(cx-w/2,cy+1,w*ip,4,2); ctx.fill();
      } else if(sel&&sel.id===t.id){
        ctx.font='600 9px Archivo,sans-serif'; ctx.fillStyle='#e8d8b5'; ctx.fillText(TYPES[t.type].name,cx,cy-7);
      }
      if(t.unrest>8){
        ctx.beginPath();ctx.arc(cx,cy,12+2*pulse,0,Math.PI*2);ctx.strokeStyle='rgba(226,102,75,.85)';ctx.lineWidth=2;ctx.stroke();
      }
      ctx.restore();
    }

    // ---- PERSONAGENS / UNIDADES --------------------------------------------
    // Diferenciação visual: em preparo (halo pulsante), em deslocamento
    // (leve inclinação/orientação na direção do movimento + sombra alongada),
    // parado/indisponível (opacidade reduzida). Nenhuma dessas leituras é
    // nova — só ficam mais claras visualmente; os dados (u.state, u.path,
    // u.loc) continuam sendo os mesmos já calculados pelo jogo.
    for(const u of World.units){
      if(u.loc===null && !u.path.length) continue;
      const col=World.fac[u.f].color;
      const m=trackMotion(u);
      const moving=m.moving || (u.path&&u.path.length>0);
      ctx.save();ctx.translate(u.x,u.y);

      // sombra de contato — alongada levemente na direção do movimento
      ctx.save();
      if(moving) ctx.rotate(m.ang);
      ctx.fillStyle='rgba(4,14,18,.5)';
      ctx.beginPath();ctx.ellipse(0,3,moving?8.5:6.5,4.2,0,0,Math.PI*2);ctx.fill();
      ctx.restore();

      ctx.globalAlpha = (u.state==='idle'||u.state==='unavailable') ? 0.72 : 1;
      ctx.fillStyle=col;ctx.strokeStyle='rgba(6,20,24,.9)';ctx.lineWidth=1.3;
      if(u.kind==='vapor'){ctx.beginPath();ctx.arc(0,0,4.6,0,Math.PI*2);}
      else { ctx.save(); if(moving) ctx.rotate(m.ang*0.18); rr(-4.5,-5.5,9,11,2); ctx.restore(); }
      ctx.fill();ctx.stroke();
      ctx.globalAlpha=1;

      // halo de preparo (operação em curso) — pulso suave, sem custo extra
      if(u.state==='prep'){
        const p=.5+.5*Math.sin(now/260);
        ctx.strokeStyle=`rgba(255,246,226,${0.55+0.35*p})`;ctx.lineWidth=1.6;ctx.beginPath();ctx.arc(0,0,8.5+1.5*p,0,Math.PI*2);ctx.stroke();
      }
      // pequeno indicador de deslocamento: dois "passos" atrás da unidade
      if(moving){
        ctx.fillStyle=`${col}55`;
        ctx.beginPath();ctx.arc(-Math.cos(m.ang)*7,-Math.sin(m.ang)*7,1.6,0,Math.PI*2);ctx.fill();
      }
      if(u.hp<u.maxhp){ ctx.fillStyle='rgba(0,0,0,.5)';ctx.fillRect(-7,-10,14,2.6);
        ctx.fillStyle='#74cf9a';ctx.fillRect(-7,-10,14*(u.hp/u.maxhp),2.6);}
      ctx.restore();
    }

    // ---- VEÍCULOS -----------------------------------------------------------
    // Orientação segue a direção real do deslocamento; forma alongada
    // reforça a sensação de movimento ao longo das estradas. Estado parado
    // (sem rota / fuel baixo) recebe feedback visual mais discreto.
    for(const v of World.veh){
      const m=trackMotion(v);
      const moving=m.moving;
      ctx.save();ctx.translate(v.x,v.y);

      ctx.save();
      if(moving) ctx.rotate(m.ang);
      ctx.fillStyle='rgba(4,14,18,.5)';
      ctx.beginPath();ctx.ellipse(0,3,moving?10:8,4.6,0,0,Math.PI*2);ctx.fill();
      ctx.restore();

      ctx.save();
      if(moving) ctx.rotate(m.ang);
      ctx.fillStyle=World.fac[v.f].color;ctx.strokeStyle='rgba(6,20,24,.9)';ctx.lineWidth=1.3;
      if(v.kind==='lancha'){ ctx.beginPath();ctx.moveTo(8,0);ctx.lineTo(-5,-5);ctx.lineTo(-2,0);ctx.lineTo(-5,5);ctx.closePath(); }
      else { rr(-8,-4,16,8,2); }
      ctx.fill();ctx.stroke();
      // leve destaque de "frente" do veículo
      ctx.fillStyle='rgba(255,255,255,.35)';
      if(v.kind==='lancha'){ ctx.beginPath();ctx.arc(6,0,1.4,0,Math.PI*2);ctx.fill(); }
      else { ctx.fillRect(5,-3,2.4,6); }
      ctx.restore();

      ctx.textAlign='center';
      if(v.qty>0.5){ const g=Object.keys(v.cargo).find(k=>v.cargo[k]>0.5);
        ctx.fillStyle=g?GOODS[g].color:'#fff';ctx.font='700 9px Archivo,sans-serif';
        ctx.fillText(Math.round(v.qty),0,-10); }
      if(v.fuel<VEHICLES[v.kind].fuelCap*0.15){
        const p=.5+.5*Math.sin(now/220);
        ctx.strokeStyle=`rgba(226,102,75,${0.6+0.3*p})`;ctx.lineWidth=1.8;ctx.beginPath();ctx.arc(0,0,11,0,Math.PI*2);ctx.stroke();
      } else if(!moving && v.route){
        // aguardando/parado com rota pendente: leve indicador discreto
        ctx.fillStyle='rgba(255,246,226,.55)';
        ctx.beginPath();ctx.arc(0,-12,1.6,0,Math.PI*2);ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  }
  return {fit,draw,toWorld,zoomAt,zoomBy,resetView,panBy,get scale(){return view.s;},cv};
})();
