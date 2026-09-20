/* ============================================================================
   PENÍNSULA — MOTOR DE ÁUDIO (camada isolada, 100% aditiva)
   ----------------------------------------------------------------------------
   Este arquivo NÃO lê nem escreve em World, não conhece regras de jogo e não
   é chamado pelo game loop (15_loop.js permanece intocado). Ele só expõe uma
   API global (`PenAudio`) que outros módulos — inclusive scripts futuros —
   podem chamar para tocar efeitos e controlar a trilha ambiente.

   Por que sintetizado (WebAudio puro) em vez de arquivos .mp3/.ogg:
     - zero assets para hospedar/errar caminho (funciona em file:// também);
     - tamanho ~0 KB de mídia;
     - fácil variar timbre/altura a cada chamada (evita fadiga por repetição).

   Política de autoplay dos navegadores: um AudioContext só pode ser
   iniciado/retomado depois de um gesto do usuário. Este módulo cria o
   contexto sob demanda (lazy) e expõe `PenAudio.unlock()` para quem quiser
   forçar o desbloqueio a partir do primeiro clique/tecla — ver
   js/audio/audio-ui.js, que já faz isso automaticamente.

   Preferências (mute, volumes) persistem em localStorage sob uma chave
   própria, sem tocar em World.save()/World.hasSaved() (que são só de estado
   de partida) — áudio é preferência do NAVEGADOR, não da partida.
   ========================================================================== */
(function(global){
  'use strict';
  const LS_KEY='pen_audio_prefs_v1';

  function loadPrefs(){
    try{
      const raw=localStorage.getItem(LS_KEY);
      if(!raw) return {muted:false,master:0.8,music:0.55,sfx:0.85};
      const p=JSON.parse(raw);
      return {
        muted: !!p.muted,
        master: clamp01(p.master ?? 0.8),
        music:  clamp01(p.music  ?? 0.55),
        sfx:    clamp01(p.sfx    ?? 0.85),
      };
    }catch(e){ return {muted:false,master:0.8,music:0.55,sfx:0.85}; }
  }
  function savePrefs(){ try{ localStorage.setItem(LS_KEY,JSON.stringify(prefs)); }catch(e){ /* armazenamento indisponível — segue sem persistir */ } }
  function clamp01(v){ v=Number(v); if(!isFinite(v))return 0; return Math.max(0,Math.min(1,v)); }

  const prefs=loadPrefs();

  let ctx=null, masterGain=null, musicGain=null, sfxGain=null;
  let musicNodes=null, musicRunning=false;
  const cooldowns=Object.create(null); // anti-repetição: menor intervalo entre o mesmo som

  function ensureCtx(){
    if(ctx) return ctx;
    const AC=global.AudioContext||global.webkitAudioContext;
    if(!AC) return null; // navegador sem WebAudio — degrada para silêncio total, sem erro
    ctx=new AC();
    masterGain=ctx.createGain(); masterGain.gain.value=prefs.muted?0:prefs.master;
    masterGain.connect(ctx.destination);
    musicGain=ctx.createGain(); musicGain.gain.value=prefs.music; musicGain.connect(masterGain);
    sfxGain=ctx.createGain(); sfxGain.gain.value=prefs.sfx; sfxGain.connect(masterGain);
    return ctx;
  }

  // Chamado a partir de um gesto real do usuário (click/keydown/touchstart).
  // Idempotente — pode ser chamado várias vezes sem custo.
  function unlock(){
    const c=ensureCtx(); if(!c) return;
    if(c.state==='suspended') c.resume().catch(()=>{});
    // Prioriza a trilha principal composta para o jogo; se falhar por
    // qualquer motivo (arquivo ausente, bloqueio do navegador), trackStart
    // já aciona o fallback sintetizado sozinho (ver onTrackError acima).
    if(!trackActive&&!trackFailed) trackStart();
    else if(trackFailed&&!musicRunning) startMusic();
  }

  /* ------------------------------- SFX ---------------------------------- */
  // Cada efeito é uma pequena "receita" sintética (osciladores/ruído + envelope
  // de volume), gerada na hora — não há arquivos para carregar ou travar.
  function noiseBuffer(dur){
    const c=ctx, n=Math.max(1,Math.round(c.sampleRate*dur));
    const buf=c.createBuffer(1,n,c.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*(1-i/n); // ruído com decaimento embutido
    return buf;
  }

  function envGain(g,now,attack,peak,release){
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(0.0001,now);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001,peak),now+attack);
    g.gain.exponentialRampToValueAtTime(0.0001,now+attack+release);
  }

  function tone(freq,{type='sine',dur=0.12,attack=0.005,vol=0.5,detune=0,glideTo=null}={}){
    const c=ctx, now=c.currentTime;
    const osc=c.createOscillator(); osc.type=type; osc.frequency.value=freq;
    if(detune) osc.detune.value=detune;
    if(glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo,now+dur*0.9);
    const g=c.createGain();
    envGain(g,now,attack,vol,Math.max(0.02,dur-attack));
    osc.connect(g); g.connect(sfxGain);
    osc.start(now); osc.stop(now+dur+0.05);
  }

  function click(){
    if(!ensureCtx()) return;
    tone(720,{type:'square',dur:0.045,attack:0.002,vol:0.16,detune:rndDetune(60)});
  }
  function confirm_(){
    if(!ensureCtx()) return;
    const c=ctx, now=c.currentTime;
    [523.25,659.25].forEach((f,i)=>{
      const osc=c.createOscillator(); osc.type='triangle'; osc.frequency.value=f;
      const g=c.createGain(); envGain(g,now+i*0.05,0.01,0.22,0.16);
      osc.connect(g); g.connect(sfxGain); osc.start(now+i*0.05); osc.stop(now+i*0.05+0.22);
    });
  }
  function cancel_(){
    if(!ensureCtx()) return;
    tone(220,{type:'sine',dur:0.14,attack:0.005,vol:0.18,glideTo:140});
  }
  function cash(){
    if(!ensureCtx()) return;
    const c=ctx, now=c.currentTime;
    [880,1108.7].forEach((f,i)=>{
      const osc=c.createOscillator(); osc.type='sine'; osc.frequency.value=f;
      const g=c.createGain(); envGain(g,now+i*0.045,0.004,0.14,0.12);
      osc.connect(g); g.connect(sfxGain); osc.start(now+i*0.045); osc.stop(now+i*0.045+0.2);
    });
  }
  function territoryGain(){
    if(!ensureCtx()) return;
    const c=ctx, now=c.currentTime;
    [392,493.88,587.33].forEach((f,i)=>{
      const osc=c.createOscillator(); osc.type='triangle'; osc.frequency.value=f;
      const g=c.createGain(); envGain(g,now+i*0.06,0.008,0.20,0.30);
      osc.connect(g); g.connect(sfxGain); osc.start(now+i*0.06); osc.stop(now+i*0.06+0.4);
    });
  }
  function territoryLose(){
    if(!ensureCtx()) return;
    tone(180,{type:'sawtooth',dur:0.32,attack:0.01,vol:0.16,glideTo:90});
  }
  function alertAttn(){
    if(!ensureCtx()) return;
    tone(660,{type:'sine',dur:0.10,attack:0.004,vol:0.20});
    setTimeout(()=>{ if(ctx) tone(660,{type:'sine',dur:0.10,attack:0.004,vol:0.16}); },130);
  }
  function alertCrit(){
    if(!ensureCtx()) return;
    const c=ctx, now=c.currentTime;
    const buf=noiseBuffer(0.22);
    const src=c.createBufferSource(); src.buffer=buf;
    const bp=c.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=520; bp.Q.value=4;
    const g=c.createGain(); envGain(g,now,0.004,0.28,0.24);
    src.connect(bp); bp.connect(g); g.connect(sfxGain); src.start(now);
    tone(180,{type:'square',dur:0.24,attack:0.004,vol:0.14});
  }
  function tab(){
    if(!ensureCtx()) return;
    tone(340,{type:'sine',dur:0.06,attack:0.002,vol:0.12,detune:rndDetune(40)});
  }
  function error_(){
    if(!ensureCtx()) return;
    tone(140,{type:'square',dur:0.16,attack:0.004,vol:0.16});
  }
  function rndDetune(spread){ return (Math.random()*2-1)*spread; }

  const SFX={
    click, confirm:confirm_, cancel:cancel_, cash, territory_gain:territoryGain,
    territory_lose:territoryLose, notify_info:click, notify_attn:alertAttn,
    notify_crit:alertCrit, tab, error:error_,
  };
  // Cooldown mínimo por som (ms) — evita "metralhadora" de sons quando vários
  // eventos iguais disparam no mesmo tick de jogo (ex.: 40 territórios
  // atualizando de uma vez). Puramente para conforto auditivo.
  const MIN_GAP={click:35,tab:60,notify_info:220,notify_attn:400,notify_crit:900,cash:180,territory_gain:600,territory_lose:600,confirm:150,cancel:150,error:250};

  function sfx(name){
    if(prefs.muted) return;
    const fn=SFX[name]; if(!fn) return;
    const c=ensureCtx(); if(!c) return;
    if(c.state==='suspended') return; // ainda não desbloqueado por gesto — silêncio, sem erro
    const now=performance.now(), gap=MIN_GAP[name]||40;
    if(cooldowns[name]&&now-cooldowns[name]<gap) return;
    cooldowns[name]=now;
    try{ fn(); }catch(e){ /* nunca deixa um som quebrado afetar o jogo */ }
  }

  /* ------------------------------ MÚSICA --------------------------------- */
  // Drone ambiente evolutivo: em vez de um loop curto que repete e cansa, o
  // pad muda lentamente de acorde a cada poucos minutos e tem um filtro
  // passa-baixa modulado por um LFO muito lento, então nunca soa igual por
  // muito tempo — mas o custo de CPU é irrelevante (poucos osciladores,
  // nenhum cálculo por frame do jogo).
  const CHORDS=[
    [65.41,98.00,130.81,164.81],   // C2 G2 C3 E3
    [58.27,87.31,116.54,174.61],   // Bb1 F2 Bb2 F3
    [61.74,92.50,123.47,155.56],   // B1 F#2 B2 D#3... (aprox., só textura)
    [69.30,103.83,138.59,174.61],  // C#2 G#2 C#3 F3
  ];
  let chordTimer=null, chordIdx=0;

  function startMusic(){
    const c=ensureCtx(); if(!c||musicRunning) return;
    musicRunning=true;
    const filter=c.createBiquadFilter(); filter.type='lowpass'; filter.frequency.value=420;
    filter.connect(musicGain);
    const lfo=c.createOscillator(); lfo.frequency.value=0.02; // ciclo de ~50s
    const lfoGain=c.createGain(); lfoGain.gain.value=140;
    lfo.connect(lfoGain); lfoGain.connect(filter.frequency); lfo.start();

    const oscs=CHORDS[0].map((f,i)=>{
      const o=c.createOscillator(); o.type=i===0?'sine':'triangle'; o.frequency.value=f;
      o.detune.value=(Math.random()*2-1)*4;
      const g=c.createGain(); g.gain.value=0.0001;
      o.connect(g); g.connect(filter); o.start();
      g.gain.exponentialRampToValueAtTime(0.16/(i+1),c.currentTime+6); // fade-in suave inicial
      return {osc:o,gain:g};
    });
    musicNodes={filter,lfo,oscs};

    function nextChord(){
      if(!musicRunning) return;
      chordIdx=(chordIdx+1)%CHORDS.length;
      const chord=CHORDS[chordIdx], now=c.currentTime;
      musicNodes.oscs.forEach((n,i)=>{
        n.osc.frequency.exponentialRampToValueAtTime(chord[i],now+8); // transição lenta e suave
      });
      chordTimer=setTimeout(nextChord,50000+Math.random()*20000); // varia o intervalo — evita padrão previsível
    }
    chordTimer=setTimeout(nextChord,42000+Math.random()*15000);
  }
  function stopMusic(fadeSec=1.2){
    if(!musicRunning||!ctx) return;
    musicRunning=false;
    if(chordTimer){ clearTimeout(chordTimer); chordTimer=null; }
    const now=ctx.currentTime;
    if(musicNodes){
      musicNodes.oscs.forEach(n=>{
        n.gain.gain.cancelScheduledValues(now);
        n.gain.gain.exponentialRampToValueAtTime(0.0001,now+fadeSec);
      });
      const nodes=musicNodes;
      setTimeout(()=>{ try{ nodes.oscs.forEach(n=>n.osc.stop()); nodes.lfo.stop(); }catch(e){} },fadeSec*1000+120);
    }
    musicNodes=null;
  }

  /* -------------------------- TRILHA GRAVADA ------------------------------ */
  // Camada opcional e aditiva: toca a trilha principal composta para o jogo
  // (assets/audio/track_full.* uma vez → assets/audio/track_loop.* em loop
  // contínuo e sem costura). Se os arquivos não existirem ou não puderem ser
  // carregados, cai automaticamente para o drone sintetizado (startMusic
  // acima) — o jogo NUNCA fica sem trilha por causa disso.
  //
  // IMPORTANTE (file://): rotear o <audio> pelo grafo do WebAudio via
  // createMediaElementSource exige o mesmo "origin" por CORS, e o Chrome
  // trata QUALQUER arquivo local como uma origem única — por isso o áudio
  // saía mudo ("outputs zeroes due to CORS access restrictions"), mesmo com
  // os arquivos carregando certinho. A solução é tocar os elementos <audio>
  // DIRETO (sem passar pelo AudioContext) e controlar volume/mute pela
  // própria propriedade .volume do elemento — funciona tanto em file://
  // quanto servido por http(s), sem depender de CORS.
  let trackFullEl=null, trackLoopEl=null;
  let trackActive=false, trackFailed=false;
  const TRACK_BASE='assets/audio/';

  function pickSource(el,baseName){
    // <source> com OGG primeiro (menor e livre) e MP3 como fallback de
    // compatibilidade — o próprio <audio> escolhe o que o navegador suporta.
    const ogg=document.createElement('source'); ogg.src=TRACK_BASE+baseName+'.ogg'; ogg.type='audio/ogg';
    const mp3=document.createElement('source'); mp3.src=TRACK_BASE+baseName+'.mp3'; mp3.type='audio/mpeg';
    el.appendChild(ogg); el.appendChild(mp3);
  }

  function trackVolume(){
    return prefs.muted?0:clamp01(prefs.master*prefs.music);
  }
  function applyTrackVolume(){
    const v=trackVolume();
    if(trackFullEl) trackFullEl.volume=v;
    if(trackLoopEl) trackLoopEl.volume=v;
  }

  function trackStart(){
    if(trackActive||trackFailed) return trackActive;
    if(!ensureCtx()) return false; // sem WebAudio, SFX também não tocariam — mantém tudo consistente
    try{
      trackFullEl=new Audio(); trackFullEl.preload='auto';
      pickSource(trackFullEl,'track_full');
      trackLoopEl=new Audio(); trackLoopEl.preload='auto'; trackLoopEl.loop=true;
      pickSource(trackLoopEl,'track_loop');
      applyTrackVolume();

      trackFullEl.addEventListener('ended',()=>{ if(trackActive) trackLoopEl.play().catch(onTrackError); });
      trackFullEl.addEventListener('error',onTrackError);
      trackLoopEl.addEventListener('error',onTrackError);

      trackActive=true;
      trackFullEl.play().catch(onTrackError);
      return true;
    }catch(e){ onTrackError(); return false; }
  }
  function onTrackError(){
    // Qualquer falha (arquivo ausente, formato não suportado) desliga esta
    // camada de vez nesta sessão e devolve o controle ao drone sintetizado,
    // que sempre funciona (não depende de arquivos externos).
    if(trackFailed) return;
    trackFailed=true; trackActive=false;
    try{ trackFullEl&&trackFullEl.pause(); trackLoopEl&&trackLoopEl.pause(); }catch(e){}
    startMusic();
  }
  function trackStop(){
    if(!trackActive) return;
    trackActive=false;
    try{ trackFullEl&&trackFullEl.pause(); trackLoopEl&&trackLoopEl.pause(); }catch(e){}
  }
  function isTrackActive(){ return trackActive; }

  /* --------------------------- Volumes / mute ----------------------------- */
  function applyVolumes(){
    if(!ctx) return;
    masterGain.gain.setTargetAtTime(prefs.muted?0:prefs.master,ctx.currentTime,0.05);
    musicGain.gain.setTargetAtTime(prefs.music,ctx.currentTime,0.05);
    sfxGain.gain.setTargetAtTime(prefs.sfx,ctx.currentTime,0.05);
    applyTrackVolume(); // trilha gravada não passa pelo grafo WebAudio (ver nota acima) — sincroniza à parte
  }
  function setMasterVolume(v){ prefs.master=clamp01(v); applyVolumes(); savePrefs(); }
  function setMusicVolume(v){ prefs.music=clamp01(v); applyVolumes(); savePrefs(); }
  function setSfxVolume(v){ prefs.sfx=clamp01(v); applyVolumes(); savePrefs(); }
  function setMuted(m){ prefs.muted=!!m; applyVolumes(); savePrefs(); }
  function toggleMute(){ setMuted(!prefs.muted); return prefs.muted; }
  function isMuted(){ return prefs.muted; }
  function getPrefs(){ return {muted:prefs.muted,master:prefs.master,music:prefs.music,sfx:prefs.sfx}; }

  global.PenAudio={
    unlock, sfx, startMusic, stopMusic,
    trackStart, trackStop, isTrackActive,
    setMasterVolume, setMusicVolume, setSfxVolume, setMuted, toggleMute, isMuted, getPrefs,
  };
})(window);
