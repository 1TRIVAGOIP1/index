
'use strict';

// Formatter global: módulos de economia/abastecimento são inicializados
// antes do módulo UI, então não podem depender do helper local da UI.
function money(v){ return '$'+Math.round(Number(v)||0).toLocaleString('pt-BR'); }
/* ==========================================================================
   PENÍNSULA — simulação ficcional de comunidade e território
   Módulos: CONF · GOODS · MapData · World · Econ · Prod · Logi · Influence
            · Ops(conflito) · Police · AI · Render · UI · Loop
   Estado vive só em World e é serializável (pronto para servidor futuro).
   Toda mecânica opera em HORAS DE JOGO. 1 h ≈ 11 s reais em 1×.
   ========================================================================== */

