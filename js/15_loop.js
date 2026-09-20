/* ================================= Loop ================================= */
const Game=(()=>{
  let acc=0,last=performance.now(),ui=0,saveT=0;
  function step(dh){
    World.h+=dh;
    Prod.tick(dh); FactorySystem.tick(dh); Econ.tick(dh); Supply.tick(dh); PurchaseOffers.tick(dh); Logi.tick(dh); City.tick(dh); City.cleanup(); Influence.tick(dh);
    Ops.tick(dh); Police.tick(dh); Personnel.tick(dh); AI.tick(dh); Rules.tick(dh); World.recordStats(); World.trim();
  }
  function frame(now){
    try{
      const raw=Math.min(0.25,(now-last)/1000); last=now;
      if(!document.getElementById('overlay')?.classList.contains('on') && !World.over&&World.speed>0){
        acc+=raw*World.speed*CONF.hoursPerRealSecond;
        let g=0; const st=CONF.tickReal;
        while(acc>=st&&g++<400){ step(st); acc-=st; }
      }
      Render.draw();
      ui+=raw; if(ui>0.8){ ui=0; Notifications.scan(); UI.hud(); }
      // Autosave: só enquanto há partida em andamento (menu fechado, sem
      // fim de jogo). 30 s reais é frequente o bastante para não perder
      // muito numa queda de energia, e raro o bastante para não pesar.
      saveT+=raw;
      if(saveT>30 && !document.getElementById('overlay')?.classList.contains('on') && !World.over){
        saveT=0; World.save();
      }
    }catch(e){
      // Um catch LOCAL não sofre a redação que o browser aplica ao evento
      // window.onerror para <script src> em file:// — aqui e.message/e.stack
      // vêm completos, com o arquivo e a linha reais do módulo que quebrou.
      const box=document.getElementById('bootError'), txt=document.getElementById('bootErrorText');
      if(box){
        box.style.display='flex';
        if(txt) txt.textContent=`Falha em EXECUÇÃO (não no boot) — Dia ${Math.floor(World.h/24)+1}, ${String(Math.floor(World.h%24)).padStart(2,'0')}h\n\n${(e && e.stack) || (e && e.message) || String(e)}`;
      }
      console.error('[Game.frame] exceção capturada em runtime:', e);
      return; // não reagenda requestAnimationFrame — pausa com o erro visível em vez de repetir o crash
    }
    requestAnimationFrame(frame);
  }
  function start(){
    const configuredName=FACTIONS[0].name, configuredShort=FACTIONS[0].short;
    World.reset();
    World.recordStats(true);
    World.fac[0].name=configuredName; World.fac[0].short=configuredShort;
    UI.reset(); Render.fit(); World.speed=1;
    document.querySelectorAll('[data-sp]').forEach(x=>x.classList.toggle('on',x.dataset.sp==='1'));
    UI.hud(); UI.panel();
    UI.log('Você administra uma <b>firma fictícia</b> com sede no Centro. Outras firmas disputam influência e território.');
  }
  return {start,frame};
})();

World.reset(); World.recordStats(true); UI.reset(); Render.fit(); World.speed=0; UI.hud();
function mainMenu(){
  const choices=World.terr.filter(t=>!['centro','manguinhos','geriba','brava'].includes(t.id)).slice(0,12);
  // Continuar partida: só aparece quando existe um save válido no
  // navegador. Fica ACIMA do formulário de nova partida para não ser
  // confundido com ele — clicar em "Começar jogo" sempre inicia do zero.
  const continueBlock=World.hasSaved()?`<div class="menuActions" style="margin-bottom:14px">
      <button type="button" data-menu-action="continue">Continuar partida salva</button>
      <button type="button" class="ghost" data-menu-action="wipe">Apagar save</button>
    </div>
    <p class="menuNote" style="margin-bottom:18px">Há uma partida salva automaticamente no seu navegador. "Nova partida" abaixo substitui esse save assim que você jogar.</p>`:'';
  UI.overlay('','',`<div class="menuCard">
    <div class="menuLogo">Península · administração territorial</div>
    ${continueBlock}
    <h1 class="menuTitle">Nova partida</h1>
    <p>O mundo fica pausado nesta tela. Nada produz, nenhum veículo se move e nenhum evento ocorre até você confirmar o início.</p>
    <div class="menuGrid">
      <div class="menuField full"><label for="cfgName">Nome da facção</label><input id="cfgName" maxlength="32" value="Coletivo da Armação" placeholder="Ex.: União da Península" autocomplete="off"></div>
      <div class="menuField"><label for="cfgShort">Nome curto</label><input id="cfgShort" maxlength="16" value="Armação" placeholder="Ex.: União" autocomplete="off"></div>
      <div class="menuField"><label for="cfgFocus">Perfil inicial</label><select id="cfgFocus"><option value="comercio">Movimento e distribuição</option><option value="logistica">Apoio e circulação</option><option value="territorio">Domínio territorial</option></select></div>
      <div class="menuField full"><label for="cfgHome">Território inicial</label><select id="cfgHome">${choices.map(t=>`<option value="${t.id}">${t.name} · ${t.type||'complexo'} · infraestrutura ${t.infra}</option>`).join('')}</select></div>
    </div>
    <div id="startPreview" class="menuNote"><b>Escolha o território inicial.</b> A sede define onde sua partida começa. O mapa só será liberado após confirmar.</div>
    <div class="menuActions"><button type="button" data-menu-action="start">Começar jogo</button><button type="button" class="ghost" data-menu-action="how">Como jogar</button></div>
  </div>`);
  const nameEl=menuEl('cfgName'); if(nameEl)setTimeout(()=>nameEl.focus(),0);
  const home=menuEl('cfgHome'); if(home)home.addEventListener('change',()=>{const t=World.ix[home.value];const p=menuEl('startPreview');if(t&&p)p.innerHTML=`<b>${t.name}</b><br>Infraestrutura ${t.infra} · população ${Math.round(t.pop)} · fábrica: ${(FACTORIES[t.factory?.kind||FACTORY_BY_TERRITORY[t.id]||'cannabis']?.name)||'Unidade'}.`});
}

/* Painel flutuante de Salvar/Carregar, injetado direto no <body> — não
   depende de nenhum elemento do HTML principal, então funciona mesmo sem
   tocar em peninsula_v38_modular.html. */
function injectSaveControls(){
  if(document.getElementById('saveCtrlBox')) return;
  const box=document.createElement('div');
  box.id='saveCtrlBox';
  box.style.cssText='position:fixed;right:10px;bottom:10px;z-index:9999;display:flex;gap:6px;font:12px Archivo,sans-serif;';
  box.innerHTML=`<button type="button" id="btnManualSave" style="padding:6px 10px;border-radius:6px;border:none;background:#1f3d33;color:#fff6e2;cursor:pointer;opacity:.92">💾 Salvar</button>`;
  document.body.appendChild(box);
  document.getElementById('btnManualSave').onclick=()=>{
    const ok=World.save();
    if(typeof UI!=='undefined' && UI.log) UI.log(ok?'Partida salva neste navegador.':'Falha ao salvar (armazenamento local indisponível).', ok?null:'hit');
  };
}

/* Menu usa delegação de eventos: os botões continuam funcionando mesmo quando
   o conteúdo do overlay é reconstruído. O helper fica local a este bloco para
   não depender do $ privado do módulo UI. */
const menuEl=id=>document.getElementById(id);
// Igual ao guard do Render: sem essa verificação, se #overlayCard não existir
// no instante em que este script roda, addEventListener em `null` derruba
// todo o boot com uma exceção não tratada.
const _overlayCardEl=menuEl('overlayCard');
if(_overlayCardEl){
_overlayCardEl.addEventListener('click', e=>{
  const btn=e.target.closest('[data-menu-action],#backMenu');
  if(!btn) return;
  e.preventDefault();
  if(btn.id==='backMenu' || btn.dataset.menuAction==='back'){
    mainMenu();
    return;
  }
  if(btn.dataset.menuAction==='continue'){
    const ok=World.loadSaved();
    if(!ok){
      UI.log('Não foi possível carregar o save (pode estar corrompido ou ter sido removido).','hit');
      mainMenu();
      return;
    }
    UI.reset();
    Render.fit();
    document.querySelectorAll('[data-sp]').forEach(x=>x.classList.toggle('on',x.dataset.sp===String(World.speed)));
    UI.hud();
    UI.panel();
    UI.log('Partida salva restaurada.');
    menuEl('overlay').classList.remove('on');
    return;
  }
  if(btn.dataset.menuAction==='wipe'){
    World.clearSaved();
    mainMenu();
    return;
  }
  if(btn.dataset.menuAction==='how'){
    UI.overlay('Como jogar','Uma visão rápida da dinâmica da comunidade antes de começar.',`<ol><li><b>Comunidade:</b> selecione áreas no mapa para administrar influência, estruturas e estoque.</li><li><b>Logística:</b> carro de apoios transportam bocarias fisicamente e consomem combustível.</li><li><b>Firma:</b> acompanhe caixa, carros de apoio, pessoal e relações.</li><li><b>Coordenação:</b> envie solicitações para outras facções. A ideia é transformar pedidos em acordos, contratos e entregas reais.</li><li><b>Ritmo:</b> use 1× para administrar com calma e acelere quando estiver apenas acompanhando.</li><li><b>Escassez:</b> os portos têm cota finita de cada bem importado e, de tempos em tempos, um bem some do abastecimento externo por um período. Um aviso chega antes — estoque, produção própria e o Mercado são o seu plano B.</li><li><b>Sem vitória:</b> o jogo não tem fim por domínio. Você enriquece, mas a <b>cobiça</b> traz custeio maior, mais polícia, rivais de olho e risco de traição. A partida só acaba quando a sua firma cai. Firmas rivais que perdem tudo saem e outras entram no lugar.</li></ol><div class="hint" style="margin-top:10px"><b>Vocabulário da ambientação:</b> “boca de fumo” é usado aqui como termo de ambientação ficcional; <b>gerente</b> representa uma função administrativa, <b>vapor</b> um vendedor, <b>olheiro</b> observação e <b>contenção</b> defesa. O jogo não representa uma organização criminosa real.</div><button type="button" data-menu-action="back">Voltar ao menu</button>`);
    return;
  }
  if(btn.dataset.menuAction==='start'){
    const name=((menuEl('cfgName')?.value)||'').trim()||'Coletivo da Armação';
    const short=((menuEl('cfgShort')?.value)||'').trim()||name.slice(0,16);
    const focus=menuEl('cfgFocus');
    const profile=focus?.value||'comercio';
    const home=menuEl('cfgHome')?.value||'centro';
    FACTIONS[0].name=name;
    FACTIONS[0].short=short;
    FACTIONS[0].human=true;
    FACTIONS[0].home=home;
    World.clearSaved();
    World.reset();
    // O perfil inicial dá uma pequena vantagem temática, sem mudar as regras centrais.
    if(profile==='comercio'){ World.fac[0].money+=1200; World.fac[0].reputation+=5; }
    if(profile==='logistica'){ World.spawnVeh(0,'van',World.fac[0].home); World.fac[0].drivers=World.veh.filter(v=>v.f===0).length; }
    if(profile==='territorio'){ const home=World.ix[World.fac[0].home]; home.inf[0]=88; World.spawnUnit(0,'seguranca',home.id); }
    UI.reset();
    Render.fit();
    World.speed=1;
    document.querySelectorAll('[data-sp]').forEach(x=>x.classList.toggle('on',x.dataset.sp==='1'));
    UI.hud();
    UI.panel();
    UI.log(`Você administra o <b>${name}</b>. Perfil: ${focus?.selectedOptions?.[0]?.text||'Movimento e distribuição'}.`);
    menuEl('overlay').classList.remove('on');
  }
});
} else {
  console.error('[Menu] Elemento #overlayCard não encontrado — os botões do menu inicial não vão responder, mas o loop do jogo continua.');
}
mainMenu();
injectSaveControls();
requestAnimationFrame(Game.frame);
