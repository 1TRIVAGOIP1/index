/* ============================== RoadNet ================================= */
/*
  MALHA TERRESTRE V40 — reconstrução estrutural.

  Diagnóstico das versões anteriores (V38/V39):
    • Os dados OSM só cobrem o oeste/centro da península. Leste (Azeda, Azedinha,
      Brava, Olho de Boi, Forno, Foca) e várias sedes não tinham NENHUMA rua; o
      código "ancorava" cada território a um único nó, às vezes 160 px dentro de
      outro território, por uma aresta reta virtual. Toda rota daquela região
      passava por um ponto único e por linhas retas.
    • "Terra" era testada contra polígonos + 5 px de tolerância, com custo
      O(territórios × vértices) por amostra: a construção levava ~170 s e era
      refeita a cada World.reset() (a identidade de World.terr muda).
    • Quatro arestas atravessavam água (26–38 px); João Fernandinho só era
      alcançável por uma "costura" falsa.
    • O movimento era território-a-território: cada trecho era replanejado a
      partir da posição real, com destino "qualquer nó do território" — a
      unidade parava na borda, replanejava, e a rota planejada nunca era a
      rota executada (vai-e-volta, rota inicial ≠ rota percorrida).
    • O combustível era estimado por distância entre centros, muito menor que
      o percurso real → veículos ficavam sem combustível na estrada.

  Solução (esta versão):
    1. A verdade de "terra" é um raster 1536×1024 gerado UMA vez a partir dos
       polígonos territoriais (scanline). Testar terra é O(1).
    2. Grade de navegação (4 px) sobre toda a terra + ruas OSM validadas contra
       o raster. Ruas têm custo menor que a terra aberta, então a rota prefere
       ruas mas nunca fica presa: onde a rua acaba, a grade continua.
    3. Cada território tem UM ponto de acesso interior, garantido em terra.
    4. Componentes conexos são calculados; vãos de água de até 12 px são
       tratados como vau explícito; qualquer coisa maior é ilha de verdade e a
       rota é corretamente impossível.
    5. A* de origem única → destino único. A rota completa é planejada UMA vez
       e percorrida até o fim (RoadNet.follow). Trechos fora de rua são
       suavizados por linha de visada validada no raster.
    6. A malha é estática: construída uma vez, sobrevive a World.reset().
*/
const RoadNet=(()=>{
  const W=1536,H=1024,CELL=4;
  const CLASS_COST=[0.78,0.84,0.90,0.92,1.00,1.06,1.16,1.12,1.30,1.55];
  const OFFROAD=1.9, LINK=2.1, FORD=2.6, MIN_COST=0.75;
  const FORD_MAX=12;           // vão máximo (px) tratado como vau
  const OSM_TOL=2;             // tolerância (px) para ruas OSM na borda da costa
  const K_GRID=0,K_OSM=1,K_LINK=2,K_FORD=3;

  let ready=false,terr=[],terrIdx={};
  let T=null,DW=null;                       // rótulo de território / distância à água
  let GW=0,GH=0,gid=null;
  let N=0,nx=null,ny=null,nl=null;          // nós: x, y, rótulo (território+1)
  let off=null,adjTo=null,adjCost=null,adjKind=null;
  let comp=null,compCount=0,compSize=[];
  let access={};                            // territoryId -> nó de acesso
  let osmDraw=[],trails=[],visible=true,fordCount=0;
  let stamp=null,gs=null,pv=null,pk=null,closed=null,curStamp=0,NG=0;
  const seqCache=new Map();

  /* ------------------------------ raster ---------------------------------- */
  function fillTerritories(){
    T=new Uint8Array(W*H);
    /* Rasterização conservadora (cobre todo pixel tocado, 2 varreduras por
       linha): polígonos vizinhos se sobrepõem em ≤1 px em vez de deixar
       costuras de "água" de 1 px entre territórios. */
    terr.forEach((t,k)=>{
      const p=t.poly,n=p.length;let mn=1e9,mx=-1e9;
      for(const q of p){if(q[1]<mn)mn=q[1];if(q[1]>mx)mx=q[1];}
      for(let y=Math.max(0,Math.floor(mn));y<=Math.min(H-1,Math.ceil(mx));y++){
        for(const off of [.25,.75]){
          const yy=y+off,xs=[];
          for(let i=0,j=n-1;i<n;j=i++){
            const a=p[i],b=p[j];
            if((a[1]>yy)!==(b[1]>yy))xs.push(b[0]+(yy-b[1])*(a[0]-b[0])/(a[1]-b[1]));
          }
          xs.sort((a,b)=>a-b);
          for(let a=0;a+1<xs.length;a+=2){
            const x0=Math.max(0,Math.floor(xs[a])),x1=Math.min(W-1,Math.ceil(xs[a+1])-1);
            for(let x=x0;x<=x1;x++){const i=y*W+x;if(!T[i])T[i]=k+1;}
          }
        }
      }
    });
  }
  /* Distância (xadrez) até a água, saturada em 255. Fora do mapa não conta. */
  function distanceToWater(){
    DW=new Uint8Array(W*H);
    for(let i=0;i<W*H;i++)DW[i]=T[i]?255:0;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const i=y*W+x;if(!DW[i])continue;let m=DW[i];
      if(x>0&&DW[i-1]+1<m)m=DW[i-1]+1;
      if(y>0){
        if(DW[i-W]+1<m)m=DW[i-W]+1;
        if(x>0&&DW[i-W-1]+1<m)m=DW[i-W-1]+1;
        if(x<W-1&&DW[i-W+1]+1<m)m=DW[i-W+1]+1;
      }
      DW[i]=m;
    }
    for(let y=H-1;y>=0;y--)for(let x=W-1;x>=0;x--){
      const i=y*W+x;if(!DW[i])continue;let m=DW[i];
      if(x<W-1&&DW[i+1]+1<m)m=DW[i+1]+1;
      if(y<H-1){
        if(DW[i+W]+1<m)m=DW[i+W]+1;
        if(x<W-1&&DW[i+W+1]+1<m)m=DW[i+W+1]+1;
        if(x>0&&DW[i+W-1]+1<m)m=DW[i+W-1]+1;
      }
      DW[i]=m;
    }
  }
  const px=(x,y)=>{const ix=Math.round(x),iy=Math.round(y);return(ix<0||iy<0||ix>=W||iy>=H)?0:T[iy*W+ix];};
  const dwAt=(x,y)=>{const ix=Math.round(x),iy=Math.round(y);return(ix<0||iy<0||ix>=W||iy>=H)?0:DW[iy*W+ix];};
  /* Terra com tolerância de r px (usada só para validar ruas OSM). */
  function nearLand(x,y,r){
    if(px(x,y))return true;
    for(let d=1;d<=r;d++)for(const [dx,dy] of [[d,0],[-d,0],[0,d],[0,-d],[d,d],[-d,-d],[d,-d],[-d,d]])
      if(px(x+dx,y+dy))return true;
    return false;
  }
  function segNear(ax,ay,bx,by,r,step=2){
    const d=Math.hypot(bx-ax,by-ay),n=Math.max(1,Math.ceil(d/step));
    for(let i=0;i<=n;i++){const k=i/n;if(!nearLand(ax+(bx-ax)*k,ay+(by-ay)*k,r))return false;}
    return true;
  }
  /* Linha de visada estrita sobre terra com folga de 2 px da água. */
  function segClear(ax,ay,bx,by){
    const d=Math.hypot(bx-ax,by-ay),n=Math.max(1,Math.ceil(d/1.5));
    for(let i=0;i<=n;i++){const k=i/n;if(dwAt(ax+(bx-ax)*k,ay+(by-ay)*k)<2)return false;}
    return true;
  }
  function terrAt(x,y){
    if(!T)ensure();      // durante build() o raster já existe: sem recursão
    let l=px(x,y);
    if(!l)for(let r=1;r<=3&&!l;r++)for(let dy=-r;dy<=r&&!l;dy++)for(let dx=-r;dx<=r;dx++){
      if(Math.max(Math.abs(dx),Math.abs(dy))!==r)continue;
      const v=px(x+dx,y+dy);if(v){l=v;break;}
    }
    return l?terr[l-1].id:null;
  }
  const labelNear=(x,y)=>{const id=terrAt(x,y);return id?terrIdx[id]+1:0;};

  /* ------------------------------ construção ------------------------------ */
  function build(){
    terr=MapData.build().list;
    terrIdx={};terr.forEach((t,k)=>terrIdx[t.id]=k);
    fillTerritories();distanceToWater();

    /* Nós: grade sobre a terra + nós OSM. Listas simples; CSR no final. */
    const X=[],Y=[],L=[];
    GW=Math.ceil(W/CELL);GH=Math.ceil(H/CELL);
    gid=new Int32Array(GW*GH).fill(-1);
    const cpx=g=>Math.min(W-1,g*CELL+(CELL>>1));
    for(let gy=0;gy<GH;gy++)for(let gx=0;gx<GW;gx++){
      const x=cpx(gx),y=cpx(gy),i=y*W+x;
      if(DW[i]>=2){gid[gy*GW+gx]=X.length;X.push(x);Y.push(y);L.push(T[i]);}
    }
    NG=X.length;
    const EA=[],EB=[],EC=[],EK=[];
    const addE=(a,b,c,k)=>{EA.push(a);EB.push(b);EC.push(c);EK.push(k);};

    fordCount=0;
    for(let gy=0;gy<GH;gy++)for(let gx=0;gx<GW;gx++){
      const a=gid[gy*GW+gx];if(a<0)continue;
      for(const [dx,dy] of [[1,0],[0,1],[1,1],[-1,1]]){
        const ax=gx+dx,ay=gy+dy;
        if(ax<0||ay<0||ax>=GW||ay>=GH)continue;
        const b=gid[ay*GW+ax];if(b<0)continue;
        if(dx&&dy&&(gid[gy*GW+ax]<0||gid[ay*GW+gx]<0))continue;   // não corta quina de água
        const d=Math.hypot(X[a]-X[b],Y[a]-Y[b]);
        const wet=!px((X[a]+X[b])/2,(Y[a]+Y[b])/2);
        if(wet)fordCount++;
        addE(a,b,d*(wet?FORD:OFFROAD),wet?K_FORD:K_GRID);
      }
    }

    /* Ruas OSM: só as que cabem em terra (tolerância pequena). */
    const osmId=new Int32Array(OSM_ROAD_NODES.length).fill(-1);
    OSM_ROAD_NODES.forEach((p,i)=>{
      if(!nearLand(p[0],p[1],OSM_TOL))return;
      osmId[i]=X.length;X.push(p[0]);Y.push(p[1]);L.push(labelNear(p[0],p[1]));
    });
    osmDraw=[];
    for(const raw of OSM_ROAD_EDGES){
      const a=osmId[raw[0]],b=osmId[raw[1]];if(a<0||b<0||a===b)continue;
      if(!segNear(X[a],Y[a],X[b],Y[b],OSM_TOL))continue;
      const d=Math.hypot(X[a]-X[b],Y[a]-Y[b]);
      addE(a,b,d*(CLASS_COST[raw[2]]??1.2),K_OSM);
      osmDraw.push([X[a],Y[a],X[b],Y[b],raw[2]]);
    }
    /* Cada nó de rua se liga aos 2 nós de grade mais próximos (≤14 px). */
    for(let i=NG;i<X.length;i++){
      const gx=Math.floor(X[i]/CELL),gy=Math.floor(Y[i]/CELL),cand=[];
      for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
        const cx=gx+dx,cy=gy+dy;if(cx<0||cy<0||cx>=GW||cy>=GH)continue;
        const g=gid[cy*GW+cx];if(g<0)continue;
        const d=Math.hypot(X[g]-X[i],Y[g]-Y[i]);
        if(d<=14&&segNear(X[i],Y[i],X[g],Y[g],OSM_TOL,3))cand.push([d,g]);
      }
      cand.sort((p,q)=>p[0]-q[0]);
      for(const [d,g] of cand.slice(0,2))addE(i,g,Math.max(.5,d)*LINK,K_LINK);
    }

    /* Componentes (union-find) + reparo de vãos curtos como vau explícito. */
    const total=X.length,par=new Int32Array(total);for(let i=0;i<total;i++)par[i]=i;
    const find=a=>{while(par[a]!==a){par[a]=par[par[a]];a=par[a];}return a;};
    for(let e=0;e<EA.length;e++){const a=find(EA[e]),b=find(EB[e]);if(a!==b)par[a]=b;}
    const sz=new Map();for(let i=0;i<NG;i++){const r=find(i);sz.set(r,(sz.get(r)||0)+1);}
    let mainRoot=-1,mainSize=-1;for(const [r,s] of sz)if(s>mainSize){mainSize=s;mainRoot=r;}
    for(const [r,s] of sz){
      if(r===mainRoot)continue;
      let best=null;
      for(let i=0;i<NG;i++){
        if(find(i)!==r)continue;
        const gx=Math.floor(X[i]/CELL),gy=Math.floor(Y[i]/CELL),R=Math.ceil(FORD_MAX/CELL)+1;
        for(let dy=-R;dy<=R;dy++)for(let dx=-R;dx<=R;dx++){
          const cx=gx+dx,cy=gy+dy;if(cx<0||cy<0||cx>=GW||cy>=GH)continue;
          const g=gid[cy*GW+cx];if(g<0||find(g)!==mainRoot)continue;
          const d=Math.hypot(X[g]-X[i],Y[g]-Y[i]);
          if(d<=FORD_MAX&&(!best||d<best.d))best={a:i,b:g,d};
        }
      }
      if(best){addE(best.a,best.b,best.d*FORD,K_FORD);fordCount++;par[find(best.a)]=find(best.b);}
    }

    /* CSR */
    N=total;nx=Float32Array.from(X);ny=Float32Array.from(Y);nl=Uint8Array.from(L);
    const deg=new Int32Array(N+1);
    for(let e=0;e<EA.length;e++){deg[EA[e]]++;deg[EB[e]]++;}
    off=new Int32Array(N+1);for(let i=0;i<N;i++)off[i+1]=off[i]+deg[i];
    const fill=off.slice(0,N);adjTo=new Int32Array(off[N]);adjCost=new Float32Array(off[N]);adjKind=new Uint8Array(off[N]);
    for(let e=0;e<EA.length;e++){
      let p=fill[EA[e]]++;adjTo[p]=EB[e];adjCost[p]=EC[e];adjKind[p]=EK[e];
      p=fill[EB[e]]++;adjTo[p]=EA[e];adjCost[p]=EC[e];adjKind[p]=EK[e];
    }
    stamp=new Int32Array(N);closed=new Int32Array(N);gs=new Float64Array(N);pv=new Int32Array(N);pk=new Uint8Array(N);curStamp=0;

    computeComponents();
    pickAccesses();
    buildTrails();
    ready=true;
  }
  function ensure(){if(!ready)build();return ready;}

  function computeComponents(){
    comp=new Int32Array(N).fill(-1);compCount=0;compSize=[];
    for(let s=0;s<N;s++){
      if(comp[s]>=0)continue;
      let n=0;const st=[s];comp[s]=compCount;
      while(st.length){const c=st.pop();n++;
        for(let p=off[c];p<off[c+1];p++){const t=adjTo[p];if(comp[t]<0){comp[t]=compCount;st.push(t);}}}
      compSize.push(n);compCount++;
    }
  }

  /* Um acesso interior por território: o nó de grade mais próximo do centro,
     de preferência com folga em relação à água e à divisa. */
  function pickAccesses(){
    access={};
    terr.forEach((t,k)=>{
      let best=-1,bd=Infinity,bestLoose=-1,bl=Infinity;
      for(let i=0;i<NG;i++){
        if(nl[i]!==k+1)continue;
        const d=Math.hypot(nx[i]-t.center[0],ny[i]-t.center[1]);
        if(d<bl){bl=d;bestLoose=i;}
        if(d<bd&&DW[Math.round(ny[i])*W+Math.round(nx[i])]>=5){
          const ok=[[6,0],[-6,0],[0,6],[0,-6]].every(([dx,dy])=>{const v=px(nx[i]+dx,ny[i]+dy);return v===k+1;});
          if(ok){bd=d;best=i;}
        }
      }
      const id=best>=0?best:bestLoose;
      if(id>=0)access[t.id]=id;
    });
  }

  /* --------------------------------- A* ----------------------------------- */
  class Heap{
    constructor(){this.k=[];this.v=[];}
    push(key,val){const k=this.k,v=this.v;let i=k.length;k.push(key);v.push(val);
      while(i){const p=(i-1)>>1;if(k[p]<=key)break;k[i]=k[p];v[i]=v[p];i=p;}k[i]=key;v[i]=val;}
    pop(){const k=this.k,v=this.v;if(!k.length)return -1;const top=v[0],lk=k.pop(),lv=v.pop();
      if(k.length){let i=0;for(;;){let l=i*2+1;if(l>=k.length)break;const r=l+1,c=(r<k.length&&k[r]<k[l])?r:l;if(k[c]>=lk)break;k[i]=k[c];v[i]=v[c];i=c;}k[i]=lk;v[i]=lv;}
      return top;}
    get size(){return this.k.length;}
  }
  function riskTable(fid){
    const rm=new Float64Array(terr.length+1).fill(1);
    if(fid==null||typeof World==='undefined'||!World.ix)return rm;
    terr.forEach((t,k)=>{
      const w=World.ix[t.id];if(!w)return;
      let risk=0;
      if(w.owner!=null&&w.owner!==fid)risk+=190;else if(w.owner==null)risk+=14;
      risk+=(w.unrest||0)*1.15;
      rm[k+1]=1+risk/1000;
    });
    return rm;
  }
  function astar(seeds,goal,fid){
    const rm=riskTable(fid),gxp=nx[goal],gyp=ny[goal],heap=new Heap();
    curStamp++;
    for(const [id,c] of seeds){
      if(stamp[id]!==curStamp||c<gs[id]){stamp[id]=curStamp;gs[id]=c;pv[id]=-1;pk[id]=K_GRID;
        heap.push(c+Math.hypot(nx[id]-gxp,ny[id]-gyp)*MIN_COST,id);}
    }
    let closedGoal=false;
    while(heap.size){
      const c=heap.pop();
      if(closed[c]===curStamp)continue;
      closed[c]=curStamp;
      if(c===goal){closedGoal=true;break;}
      const gc=gs[c];
      for(let p=off[c];p<off[c+1];p++){
        const t=adjTo[p],ng=gc+adjCost[p]*rm[nl[t]];
        if(stamp[t]!==curStamp||ng<gs[t]-1e-9){
          stamp[t]=curStamp;gs[t]=ng;pv[t]=c;pk[t]=adjKind[p];
          heap.push(ng+Math.hypot(nx[t]-gxp,ny[t]-gyp)*MIN_COST,t);
        }
      }
    }
    if(!closedGoal)return null;
    const ids=[];let k=goal;
    for(let guard=0;k!==-1&&guard<N+5;guard++){ids.push(k);k=pv[k];}
    ids.reverse();
    const kinds=ids.map(id=>pk[id]);   // kinds[i]: aresta que chegou a ids[i]
    kinds[0]=K_LINK;
    return {ids,kinds};
  }

  /* Nós de grade candidatos para "encaixar" um ponto qualquer na malha. */
  function snapSeeds(x,y){
    const gx=Math.min(GW-1,Math.max(0,Math.floor(x/CELL))),gy=Math.min(GH-1,Math.max(0,Math.floor(y/CELL)));
    for(let r=0;r<=40;r++){
      const found=[];
      for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
        if(Math.max(Math.abs(dx),Math.abs(dy))!==r)continue;
        const cx=gx+dx,cy=gy+dy;if(cx<0||cy<0||cx>=GW||cy>=GH)continue;
        const g=gid[cy*GW+cx];if(g<0)continue;
        found.push([Math.hypot(nx[g]-x,ny[g]-y),g]);
      }
      if(found.length){
        found.sort((a,b)=>a[0]-b[0]);
        return found.slice(0,3).map(([d,g])=>[g,d*OFFROAD]);
      }
    }
    return null;
  }

  /* Suaviza trechos fora de rua por linha de visada validada no raster.
     kinds[i] descreve a aresta que chega a pts[i]. */
  function smooth(pts,kinds){
    const isOff=k=>k===K_GRID||k===K_LINK;
    const op=[pts[0]],ok=[kinds[0]];let i=0;
    while(i<pts.length-1){
      if(!isOff(kinds[i+1])){op.push(pts[i+1]);ok.push(kinds[i+1]);i++;continue;}
      let runEnd=i+1;while(runEnd+1<pts.length&&isOff(kinds[runEnd+1]))runEnd++;
      let next=i+1;
      for(let j=Math.min(runEnd,i+60);j>i+1;j--)if(segClear(pts[i][0],pts[i][1],pts[j][0],pts[j][1])){next=j;break;}
      op.push(pts[next]);ok.push(K_GRID);i=next;
    }
    return {pts:op,kinds:ok};
  }
  function dedupe(sm){
    const p=[sm.pts[0]],k=[sm.kinds[0]];
    for(let i=1;i<sm.pts.length;i++){const q=p[p.length-1];if(Math.hypot(sm.pts[i][0]-q[0],sm.pts[i][1]-q[1])>0.35){p.push(sm.pts[i]);k.push(sm.kinds[i]);}}
    return {pts:p,kinds:k};
  }
  function expand(res,startPt){
    const pts=[],kinds=[];
    if(startPt){pts.push([startPt[0],startPt[1]]);kinds.push(K_LINK);}
    res.ids.forEach((id,i)=>{pts.push([nx[id],ny[id]]);kinds.push(i===0?K_LINK:res.kinds[i]);});
    return dedupe(smooth(pts,kinds));
  }
  const polyline=(res,startPt)=>expand(res,startPt).pts;

  /* --------------------------------- API ---------------------------------- */
  /* Rota completa do ponto (x,y) até o acesso do território `to`. */
  function routeFromPoint(x,y,to,fid=null){
    ensure();
    const goal=access[to];if(goal===undefined)return null;
    const seeds=snapSeeds(x,y);if(!seeds)return null;
    if(!seeds.some(([id])=>comp[id]===comp[goal]))return null;
    const res=astar(seeds.filter(([id])=>comp[id]===comp[goal]),goal,fid);
    if(!res)return null;
    const pts=polyline(res,[x,y]);
    return pts.length>=2?pts:[[x,y],[nx[goal],ny[goal]]];
  }
  function route(from,to,fid=null){
    ensure();
    if(from===to||access[from]===undefined)return null;
    const a=access[from];
    return routeFromPoint(nx[a],ny[a],to,fid);
  }
  const safeRoute=route;
  function length(pts){let d=0;if(pts)for(let i=1;i<pts.length;i++)d+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);return d;}

  /* Avança `o` (x,y,roadPoints,roadIndex) até `dist` px pela rota. Devolve o
     quanto realmente andou; roadIndex>=roadPoints.length significa chegada. */
  function follow(o,dist){
    const rp=o.roadPoints;if(!rp||!rp.length)return 0;
    let moved=0,i=Math.max(1,o.roadIndex||1);
    while(dist>1e-6&&i<rp.length){
      const dx=rp[i][0]-o.x,dy=rp[i][1]-o.y,d=Math.hypot(dx,dy);
      if(d<=dist){o.x=rp[i][0];o.y=rp[i][1];dist-=d;moved+=d;i++;}
      else{o.x+=dx/d*dist;o.y+=dy/d*dist;moved+=dist;dist=0;}
    }
    o.roadIndex=i;return moved;
  }

  /* Sequência de territórios atravessados (informativa, para UI/IA). */
  function territorySequence(from,to){
    ensure();
    const key=from+'|'+to;if(seqCache.has(key))return seqCache.get(key)&&seqCache.get(key).slice();
    const pts=route(from,to,null);
    if(!pts){seqCache.set(key,null);return null;}
    const runs=[];let curId=null,len=0;
    for(let i=1;i<pts.length;i++){
      const d=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]),n=Math.max(1,Math.ceil(d/2));
      for(let s=1;s<=n;s++){
        const k=s/n,id=terrAt(pts[i-1][0]+(pts[i][0]-pts[i-1][0])*k,pts[i-1][1]+(pts[i][1]-pts[i-1][1])*k);
        if(!id)continue;
        if(id===curId)len+=d/n;else{if(curId)runs.push([curId,len]);curId=id;len=d/n;}
      }
    }
    if(curId)runs.push([curId,len]);
    const seq=[];let last=from;
    for(const [id,l] of runs){if(id!==last&&(l>=8||id===to)){if(seq[seq.length-1]!==id)seq.push(id);last=id;}}
    if(!seq.length||seq[seq.length-1]!==to)seq.push(to);
    seqCache.set(key,seq);return seq.slice();
  }

  function accessPoint(tid){ensure();const a=access[tid];return a===undefined?null:[nx[a],ny[a]];}
  function sameComponent(from,to){
    ensure();const a=access[from],b=access[to];
    return a!==undefined&&b!==undefined&&comp[a]===comp[b];
  }
  function diagnose(from,to,fid=null){
    ensure();
    const out={from,to,fromAccess:access[from]!==undefined?1:0,toAccess:access[to]!==undefined?1:0,sameComponent:false,ok:false,reason:null};
    if(!out.fromAccess){out.reason=`Território de origem (${from}) sem ponto de acesso em terra.`;return out;}
    if(!out.toAccess){out.reason=`Território de destino (${to}) sem ponto de acesso em terra.`;return out;}
    out.sameComponent=sameComponent(from,to);
    if(!out.sameComponent){out.reason='Origem e destino estão em massas de terra separadas por água (vão maior que '+FORD_MAX+' px).';return out;}
    const rp=route(from,to,fid);
    if(!rp||rp.length<2){out.reason='Mesma massa de terra, mas o A* não fechou a rota (inesperado).';return out;}
    out.ok=true;return out;
  }

  /* Trilhas: trechos fora de rua usados pelas ligações entre vizinhos, para
     que o jogador veja por onde a malha realmente passa nas áreas sem OSM. */
  function buildTrails(){
    trails=[];
    const seen=new Set();
    for(const t of terr)for(const n of t.neighbors||[]){
      const k=t.id<n?t.id+'|'+n:n+'|'+t.id;if(seen.has(k))continue;seen.add(k);
      const a=access[t.id],b=access[n];if(a===undefined||b===undefined||comp[a]!==comp[b])continue;
      const res=astar([[a,0]],b,null);if(!res)continue;
      const sm=expand(res,null);
      let run=[];
      const flush=()=>{if(run.length>1&&length(run)>=24)trails.push(run);run=[];};
      for(let i=1;i<sm.pts.length;i++){
        if(sm.kinds[i]===K_OSM){flush();continue;}
        if(!run.length)run.push(sm.pts[i-1]);
        run.push(sm.pts[i]);
      }
      flush();
    }
  }

  function draw(ctx,zoom=1){
    if(!visible)return;ensure();
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
    const showRes=zoom>=1.55,showLocal=zoom>=2.15;
    const styles=[['rgba(244,210,143,.62)',2.4,e=>e[4]<=1],['rgba(226,194,137,.45)',1.7,e=>e[4]===2||e[4]===3],
      ['rgba(224,214,185,.24)',.95,e=>e[4]>=4&&((e[4]<=5&&showRes)||(e[4]>=6&&showLocal))]];
    for(const [col,lw,pred] of styles){
      ctx.strokeStyle=col;ctx.lineWidth=lw;ctx.beginPath();
      for(const e of osmDraw)if(pred(e)){ctx.moveTo(e[0],e[1]);ctx.lineTo(e[2],e[3]);}
      ctx.stroke();
    }
    ctx.strokeStyle='rgba(226,194,137,.34)';ctx.lineWidth=1.5;ctx.setLineDash([3,5]);ctx.beginPath();
    for(const tr of trails){ctx.moveTo(tr[0][0],tr[0][1]);for(let i=1;i<tr.length;i++)ctx.lineTo(tr[i][0],tr[i][1]);}
    ctx.stroke();
    ctx.restore();
  }
  function toggle(){visible=!visible;return visible;}
  function stats(){
    ensure();
    return {nodes:N,edges:adjTo.length/2,components:compCount,mainComponent:Math.max(...compSize),fords:fordCount,
      osmEdges:osmDraw.length,trails:trails.length,accessTerritories:Object.keys(access).length,territories:terr.length};
  }
  return {build,ensure,route,safeRoute,routeFromPoint,follow,length,territorySequence,terrAt,accessPoint,
    sameComponent,diagnose,stats,draw,toggle,get visible(){return visible;}};
})();
