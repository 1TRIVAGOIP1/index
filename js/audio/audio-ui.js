/* ============================================================================
   PENÍNSULA — INTEGRAÇÃO DE ÁUDIO (camada de acoplamento, aditiva e opcional)
   ----------------------------------------------------------------------------
   Este arquivo conecta o motor sintetizado (audio-engine.js) aos elementos
   de interface que JÁ EXISTEM no jogo — sem editar 14_ui.js, 15_loop.js nem
   qualquer outro arquivo protegido. Duas técnicas, ambas somente leitura em
   relação ao DOM/estado do jogo:

     1) Delegação de eventos no `document` (capture): qualquer clique em
        <button> já presente na página (menu, abas, velocidade, sino de
        notificação, "Salvar" etc.) dispara um som de clique. Não criamos
        nenhum listener novo NOS elementos — só ouvimos o que já borbulha.

     2) Um "monkey patch" leve e defensivo em `UI.log`: como UI.log já é o
        canal por onde o jogo narra eventos importantes (com uma classe CSS
        'win'/'hit'/'cop' opcional — ver uso em 06_influence.js, 09, 11 etc.),
        interceptamos a MESMA função depois que 14_ui.js já a definiu, tocamos
        um efeito sonoro coerente com a classe, e then chamamos a função
        original sem alterá-la. Se UI ou UI.log não existir por algum motivo,
        tudo aqui vira no-op silencioso — o jogo nunca depende deste arquivo.

   Nada aqui roda por frame nem entra no game loop: só listeners de DOM e um
   pequeno setInterval de baixa frequência para o widget de volume (a cada
   poucos segundos, só para refletir mute/volume caso mudem por outra aba).
   ========================================================================== */
(function(){
  'use strict';
  function whenReady(fn){
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',fn,{once:true});
    else fn();
  }

  whenReady(function(){
    if(typeof window.PenAudio==='undefined') return; // motor de áudio ausente — degrada em silêncio

    /* ---- 1) Desbloqueio por gesto do usuário (política de autoplay) ---- */
    let unlocked=false;
    function tryUnlock(){
      if(unlocked) return; unlocked=true;
      PenAudio.unlock();
      window.removeEventListener('pointerdown',tryUnlock,true);
      window.removeEventListener('keydown',tryUnlock,true);
    }
    window.addEventListener('pointerdown',tryUnlock,true);
    window.addEventListener('keydown',tryUnlock,true);

    /* ---- 2) Som de clique/seleção em qualquer botão já existente ---- */
    document.addEventListener('click',function(ev){
      const btn=ev.target.closest && ev.target.closest('button, [data-menu-action], [data-tab], #notifBell, #mapControls button');
      if(!btn) return;
      if(btn.id&&btn.id==='audioMuteBtn') return; // o próprio widget tem seu som específico
      if(btn.closest('#tabs')) PenAudio.sfx('tab');
      else PenAudio.sfx('click');
    },true);

    /* ---- 3) Ganchos sonoros no log narrativo (sem editar 14_ui.js) ---- */
    // Espera até UI existir (ordem de scripts já garante isso, mas o guard
    // evita qualquer exceção caso a ordem mude no futuro).
    if(typeof UI!=='undefined' && typeof UI.log==='function' && !UI.log.__penAudioWrapped){
      const originalLog=UI.log.bind(UI);
      const wrapped=function(msg,cls){
        if(cls==='win') PenAudio.sfx('territory_gain');
        else if(cls==='hit') PenAudio.sfx('territory_lose');
        else if(cls==='cop') PenAudio.sfx('notify_attn');
        return originalLog(msg,cls);
      };
      wrapped.__penAudioWrapped=true;
      UI.log=wrapped;
    }

    /* ---- 3b) Pulso visual discreto no sino ao chegar uma notificação ---- */
    // Mesmo princípio do gancho em UI.log: embrulha Notifications.push (já
    // definida por 13_coord_notifications.js) sem alterar aquele arquivo,
    // só para acrescentar uma classe CSS temporária no sino existente.
    if(typeof Notifications!=='undefined' && typeof Notifications.push==='function' && !Notifications.push.__penFxWrapped){
      const originalPush=Notifications.push.bind(Notifications);
      const wrappedPush=function(...args){
        const bell=document.getElementById('notifBell');
        if(bell){ bell.classList.remove('nbellPulse'); void bell.offsetWidth; bell.classList.add('nbellPulse'); }
        return originalPush(...args);
      };
      wrappedPush.__penFxWrapped=true;
      Notifications.push=wrappedPush;
    }

    /* ---- 4) Widget flutuante de volume/mute ---- */
    // Canto inferior-esquerdo — o botão de salvar (15_loop.js) já ocupa o
    // inferior-direito, então não há sobreposição.
    if(!document.getElementById('audioCtrlBox')){
      const box=document.createElement('div');
      box.id='audioCtrlBox';
      box.style.cssText='position:fixed;left:10px;bottom:10px;z-index:9999;display:flex;align-items:center;gap:6px;font:12px Archivo,system-ui,sans-serif;';
      const p=PenAudio.getPrefs();
      box.innerHTML=
        `<button type="button" id="audioMuteBtn" title="Ativar/mudo" aria-label="Ativar ou silenciar áudio"
           style="padding:6px 9px;border-radius:6px;border:none;background:#1f3d33;color:#fff6e2;cursor:pointer;opacity:.92;min-width:34px">${p.muted?'🔇':'🔊'}</button>
         <div id="audioVolPop" style="display:none;background:#14181c;border:1px solid #262c31;border-radius:8px;padding:8px 10px;gap:6px;flex-direction:column;box-shadow:0 8px 20px rgba(0,0,0,.4)">
           <label style="display:flex;align-items:center;gap:6px;color:#eceff1">🎵 <input type="range" id="audioVolMusic" min="0" max="100" value="${Math.round(p.music*100)}" style="width:90px"></label>
           <label style="display:flex;align-items:center;gap:6px;color:#eceff1">🔔 <input type="range" id="audioVolSfx" min="0" max="100" value="${Math.round(p.sfx*100)}" style="width:90px"></label>
         </div>`;
      document.body.appendChild(box);

      const muteBtn=box.querySelector('#audioMuteBtn');
      const pop=box.querySelector('#audioVolPop');
      let popOpen=false;
      muteBtn.addEventListener('click',function(e){
        e.stopPropagation();
        const nowMuted=PenAudio.toggleMute();
        muteBtn.textContent=nowMuted?'🔇':'🔊';
        if(!nowMuted) PenAudio.sfx('confirm');
      });
      muteBtn.addEventListener('contextmenu',function(e){
        e.preventDefault();
        popOpen=!popOpen; pop.style.display=popOpen?'flex':'none';
      });
      // Em telas de toque (sem botão direito), um toque longo abre o popup.
      let pressT=null;
      muteBtn.addEventListener('touchstart',()=>{ pressT=setTimeout(()=>{ popOpen=true; pop.style.display='flex'; },420); },{passive:true});
      muteBtn.addEventListener('touchend',()=>{ if(pressT) clearTimeout(pressT); });
      document.addEventListener('click',(e)=>{ if(popOpen && !box.contains(e.target)){ popOpen=false; pop.style.display='none'; } });

      box.querySelector('#audioVolMusic').addEventListener('input',function(){ PenAudio.setMusicVolume(this.value/100); });
      box.querySelector('#audioVolSfx').addEventListener('input',function(){ PenAudio.setSfxVolume(this.value/100); PenAudio.sfx('click'); });
    }
  });
})();
