/* ============================ Theme loader =============================
   Único propósito: injetar ui/theme.css no <head>. Não cria elementos de
   jogo, não lê nem escreve em World, não registra nenhum listener de
   gameplay e não interfere no loop (15_loop.js) — só CSS carregado uma vez.

   Como não alteramos o HTML principal (fora do escopo desta etapa), este
   arquivo precisa ser referenciado por uma única linha:

     <script src="ui/theme-loader.js"></script>

   Coloque essa linha o mais cedo possível na página — idealmente logo após
   00_bootstrap.js e antes dos demais módulos — para evitar um flash de
   estilo não aplicado. Se o arquivo for movido para outra pasta, mova
   ui/theme.css junto: o caminho é resolvido relativo a este próprio script.
   ========================================================================= */
(function(){
  'use strict';
  if(document.getElementById('penTheme')) return; // evita duplicar se o script rodar 2x

  // Resolve o caminho de theme.css relativo à localização deste próprio
  // arquivo (funciona tanto em http(s):// quanto em file://, e não depende
  // de a página estar em nenhuma pasta específica).
  let base='ui/';
  try{
    const cur=document.currentScript;
    if(cur && cur.src){ base=cur.src.replace(/[^/]*$/,''); }
  }catch(e){ /* mantém o fallback relativo */ }

  const link=document.createElement('link');
  link.id='penTheme';
  link.rel='stylesheet';
  link.href=base+'theme.css';
  link.onerror=()=>console.error('[Theme] Não foi possível carregar '+link.href+' — a interface segue funcional, só sem o redesign visual.');
  document.head.appendChild(link);
})();
