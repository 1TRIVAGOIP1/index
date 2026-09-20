/* ================================ CONF ================================== */
const CONF = {
  tickReal: 1/20,               // passo fixo (em horas de jogo) de cada iteração de física — lido por 15_loop.js
  hoursPerRealSecond: 1/11,     // ritmo base deliberadamente lento
  // Jogo infinito: não existe mais vitória por domínio territorial. A partida
  // só termina quando a firma do jogador cai (ver Rules/Greed em 11_alerts_rules.js).
  influenceFlip: 55,            // influência para assumir território neutro
  influenceLose: 22,            // abaixo disso o dono perde o território
  heatMax: 100, heatDecay: 0.9, // por hora
  raidAt: 70,
  collapseCd: 20,               // horas mínimas entre colapsos econômicos da mesma facção
};

/* =============================== GOODS ================================== */
/* Cada bem tem um papel definido na cadeia: matéria-prima importada, matéria-
   prima local, insumo industrial intermediário, ou bocaria vendável ao
   consumidor final. Nenhum bem "aparece do nada" — tudo que uma estrutura
   produz é consumido por outra estrutura ou por um comprador (Boca/Mercado).
   "buy" só existe para bens comprados em Porto; o resto TEM que ser
   produzido em algum território, o que é exatamente o que gera dependência
   entre firmas. */
const GOODS = {
  // importados — só chegam via Porto, do abastecimento externo
  insumo:  { name:'Insumo',      ab:'INS', color:'#b9ae93', buy:38,  base:0   },
  quimico: { name:'Químico',     ab:'QUI', color:'#a7d1c7', buy:64,  base:0   },
  fuel:    { name:'Combustível', ab:'CMB', color:'#7fc7ff', buy:19,  base:0   },
  armas:   { name:'Armamento',   ab:'ARM', color:'#b7a58c', buy:130, base:0   }, // comprar pronto é caro — produzir compensa
  ammo:    { name:'Munição',     ab:'MUN', color:'#c8b6e8', buy:58,  base:0   },

  // produzido localmente, sem input externo
  energia: { name:'Energia',     ab:'ENG', color:'#f2d675', buy:0,   base:0   }, // insumo industrial puro: não é vendável, não é transportado

  // bocaria — produto final, vendável ao consumidor
  cinza:   { name:'Maconha',     ab:'MCH', color:'#9fb0b5', buy:0,   base:78  },
  ambar:   { name:'Cocaína',     ab:'COC', color:'#d8a85e', buy:0,   base:185 },
  rubra:   { name:'Crack',       ab:'CRK', color:'#cf6a5a', buy:0,   base:410 },
};
const GK = Object.keys(GOODS);
const SELLABLE = ['cinza','ambar','rubra'];
/* Bens industriais podem ser negociados entre firmas e vendidos ao Mercado,
   mas nunca escoados numa Boca — a Boca só atende o consumidor final. */
const INDUSTRIAL = ['insumo','quimico','fuel','armas','ammo'];

/* ============================ TIPOS/ESTRUTURAS ========================== */
const TYPES = {
  porto:   { name:'Boca de chegada',   color:'#6fa8bd', desc:'Importa insumo, químico, combustível e comércio externo. Sem porto, a cadeia industrial trava.' },
  oficina: { name:'Oficina',           color:'#9a8fb5', desc:'Complexo industrial: aqui rodam as fábricas que dependem de insumo e energia.' },
  sitio:   { name:'Sítio',             color:'#8fae6e', desc:'Produção agrícola local — insumo ou maconha crua, sem depender de mais nada.' },
  boca:    { name:'Boca',              color:'#d8a85e', desc:'Escoa bocaria conforme a demanda local. Preço cai se inundado.' },
  bairro:  { name:'Bairro',            color:'#b2a894', desc:'População alta. Demanda modesta e arrecadação de rua.' },
};

/* opCost: custo operacional por hora (multiplicado pelo nível da fábrica) —
   pago mesmo quando a fábrica não consegue produzir (sem insumo, sem espaço
   de estoque, sem energia). Isso torna logística malfeita uma fonte real de
   prejuízo, e não só um teto de produção.
   inputs: lista de {good,rate} — quantidade consumida por unidade de output.
   Múltiplos insumos por fábrica é o que cria a cadeia: falta QUALQUER um
   deles e a produção cai para o ritmo do insumo mais escasso (gargalo).
   risk: calor gerado por unidade produzida (território + firma) — processar
   bocaria pesada é arriscado por si só, antes mesmo de vender. */
const FACTORIES = {
  roca:      { name:'Roça de insumo',           icon:'🌾', output:'insumo',  inputs:[],                                                          rate:2.6,  opCost:1.0, risk:0.03, desc:'Produz Insumo localmente — alternativa a comprá-lo em portos.' },
  sitio:     { name:'Sítio de cultivo',         icon:'🌿', output:'cinza',   inputs:[],                                                          rate:2.2,  opCost:1.2, risk:0.12, desc:'Produz Maconha sem depender de mais nada.' },
  usina:     { name:'Usina de energia',         icon:'⚡', output:'energia', inputs:[{good:'fuel',rate:1.4}],                                    rate:3.5,  opCost:2.0, risk:0.05, desc:'Converte Combustível em Energia — insumo que toda fábrica de ponta exige.' },
  oficina:   { name:'Unidade de processamento', icon:'◇', output:'ambar',   inputs:[{good:'insumo',rate:1.5},{good:'energia',rate:0.8}],         rate:1.1,  opCost:4.2, risk:1.0,  desc:'Converte Insumo + Energia em Cocaína.' },
  refinaria: { name:'Refinaria pesada',         icon:'◆', output:'rubra',   inputs:[{good:'ambar',rate:1.3},{good:'quimico',rate:0.6},{good:'energia',rate:1.2}], rate:0.55, opCost:6.8, risk:1.7, desc:'Converte Cocaína + Químico + Energia em Crack — o elo mais caro e mais lucrativo da cadeia.' },
  armaria:   { name:'Fábrica de armamentos',    icon:'⚙', output:'armas',   inputs:[{good:'insumo',rate:1.6},{good:'energia',rate:0.7}],         rate:1.8,  opCost:5.2, risk:0.8,  desc:'Converte Insumo + Energia em Armamento.' },
  polvora:   { name:'Fábrica de munição',       icon:'▦', output:'ammo',    inputs:[{good:'insumo',rate:1.0},{good:'energia',rate:0.5}],         rate:3.6,  opCost:3.6, risk:0.5,  desc:'Converte Insumo + Energia em Munição.' },
};
/* Cada território nasce com um papel FIXO na cadeia, distribuído de propósito
   para que nenhuma facção nasça autossuficiente: quem controla uma Refinaria
   ainda precisa de Cocaína, Químico e Energia vindos de outros territórios —
   possivelmente de outra firma.
   AUDITORIA (corrigido nesta rodada): World.reset() só cria t.factory quando
   t.type é 'sitio' ou 'oficina' (04_world.js). A tabela anterior citava 24
   territórios, mas cruzando com os tipos reais de 02_mapdata.js (BUZIOS_
   LOCATIONS) só 7 são de fato 'sitio'/'oficina' — os outros 17 eram porto,
   boca ou bairro e nunca recebiam fábrica alguma, silenciosamente (bug).
   A lista abaixo cobre exatamente os 7 territórios elegíveis, cada um com
   um papel diferente da cadeia, de propósito:
     tucuns        (sitio)   → roca      (insumo cru)
     olho          (sitio)   → sitio     (Maconha crua)
     forno         (sitio)   → usina     (Energia a partir de Combustível)
     cembracas     (sitio)   → armaria   (Armamento)
     lagoinha      (sitio)   → polvora   (Munição)
     josegoncalves (oficina) → oficina   (Cocaína)
     brava         (oficina) → refinaria (Crack — o elo mais caro)
   Nenhum território sitio/oficina do mapa ficou de fora (sem fallback
   acidental para 'roca'/'oficina' genérico não intencional). */
const FACTORY_BY_TERRITORY = {
  tucuns:'roca', olho:'sitio', forno:'usina', cembracas:'armaria',
  lagoinha:'polvora', josegoncalves:'oficina', brava:'refinaria',
};

/* capBonus/escoamentoMult/infMult/defBonus: números de verdade que o código
   (World.cap, World.defBonus, Econ) lê — não só uma frase na descrição. Se
   um desses campos faltar, a construção continua "existindo" mas o bônus
   descrito no texto vira um no-op silencioso (sem erro, sem efeito). */
const BUILD = {
  deposito: { name:'Depósito',         icon:'▣', cost:2600, hours:30, upkeep:3, capBonus:600, desc:'+600 de capacidade de estoque.' },
  ponto:    { name:'Boca',             icon:'◉', cost:1900, hours:22, upkeep:4, escoamentoMult:1.6, infMult:1.5, desc:'+60% de escoamento e +50% de ganho de influência.' },
  garagem:  { name:'Garagem',          icon:'⛭', cost:3200, hours:36, upkeep:5, desc:'Permite montar carro de apoio e reparar carga perdida.' },
  refugio:  { name:'Refúgio',          icon:'⌂', cost:2400, hours:28, upkeep:4, defBonus:0.35, desc:'+35% de defesa e recuperação de pessoal.' },
  mercado:  { name:'Posto de Mercado', icon:'⛁', cost:3400, hours:32, upkeep:6, desc:'Habilita vender bens industriais ao Mercado regional e receber fornecimento dele (preço pior que negociar direto ou importar, mas sempre há alguém do outro lado).' },
};

/* def: redução percentual de baixas recebidas em combate — contraparte
   defensiva de atk, lida por World.defBonus (guarnição ociosa) e por
   Ops.combat (def médio de quem está sob ataque agora). Sem este campo, a
   Contenção (pensada para defender) não tinha NENHUMA vantagem defensiva
   sobre o Vapor além do hp bruto. */
const UNITS = {
  vapor:  { name:'Vapor',  icon:'●', cost:620,  hours:10, upkeep:7,  atk:2,  def:0.05, hp:60,  speed:58, inf:0.9 },
  seguranca: { name:'Contenção', icon:'▮', cost:1450, hours:20, upkeep:19, atk:11, def:0.30, hp:130, speed:52, inf:0.2 },
};
const VEHICLES = {
  van:     { name:'Van',      icon:'▬', cost:2100, hours:20, upkeep:6,  cap:60,  speed:115, burn:0.16, fuelCap:80,  sea:false },
  caminhao:{ name:'Caminhão', icon:'▭', cost:4200, hours:34, upkeep:11, cap:190, speed:72,  burn:0.30, fuelCap:220, sea:false },
  lancha:  { name:'Lancha',   icon:'◆', cost:3600, hours:30, upkeep:10, cap:110, speed:96,  burn:0.26, fuelCap:180, sea:true },
};

/* ============================= ITEM_CATALOG ============================== */
/* Catálogo de equipamentos — entidades FÍSICAS da economia (não são bônus
   abstratos): cada item nasce de uma fabricação real (dinheiro + estoque de
   'armas' consumido num território, ver Personnel.craftItem), existe como um
   registro em World.items com localização própria, e só produz efeito em um
   personagem quando fisicamente equipado (Personnel.equip). Nomes e números
   são de GAMEPLAY — não reproduzem especificações de armamentos reais.
   Campos de cada item do catálogo:
     slot     — categoria de equipamento (um item por slot por personagem)
     tipo     — subtipo narrativo, só para exibição/UI
     cost     — valor de fabricação (dinheiro)
     weight   — peso; itens muito pesados penalizam mobilidade (ver stat())
     atk/def/inf/speed — bônus aditivo direto às estatísticas efetivas do
                personagem (Personnel.stat), nos MESMOS campos usados por
                Ops.combat, Ops.tick e Influence.tick
     prec     — precisão: reduz variância/desperdício em combate (usado como
                leve modificador de atk efetivo)
     range    — alcance narrativo (exibição / futura mecânica de alcance)
     reliab   — confiabilidade (0–1): multiplica o bônus de atk, e cai com o
                desgaste da peça (ver estado de conservação)
     rarity   — raridade narrativa (comum/incomum/raro) — só exibição
     reqArmas — quanto de estoque local de 'armas' a fabricação consome
     kind/minRank — restrições de uso (arquétipo/cargo mínimo) */
const ITEM_CATALOG = {
  faca:     { name:'Faca Improvisada',   slot:'arma',    tipo:'arma_corpo', cost:80,  weight:1.0, atk:0.4, def:0,    prec:0.50, range:1, reliab:0.99, rarity:'comum',   reqArmas:0 },
  soqueira: { name:'Soqueira de Aço',    slot:'arma',    tipo:'arma_corpo', cost:60,  weight:0.6, atk:0.3, def:0.05, prec:0.55, range:1, reliab:1.00, rarity:'comum',   reqArmas:0 },
  pistola:  { name:'Pistola Compacta',   slot:'arma',    tipo:'arma_curta', cost:340, weight:1.4, atk:1.2, def:0,    prec:0.70, range:3, reliab:0.95, rarity:'incomum', reqArmas:2 },
  fuzil:    { name:'Fuzil Tático',       slot:'arma',    tipo:'arma_longa', cost:980, weight:3.6, atk:2.6, def:0,    prec:0.80, range:6, reliab:0.85, rarity:'raro',    reqArmas:8, kind:'seguranca', minRank:0 },
  colete:   { name:'Colete de Proteção', slot:'colete',  tipo:'protecao',   cost:520, weight:2.2, atk:0,   def:0.35, prec:0,    range:0, reliab:0.90, rarity:'incomum', reqArmas:3 },
  radio:    { name:'Rádio Portátil',     slot:'radio',   tipo:'comunicacao',cost:260, weight:0.5, atk:0,   def:0,    inf:0.25,  range:8, reliab:0.95, rarity:'comum',   reqArmas:1 },
  mochila:  { name:'Mochila de Campo',   slot:'mochila', tipo:'suporte',    cost:180, weight:1.5, atk:0,   def:0.05, speed:0.15,range:0, reliab:1.00, rarity:'comum',   reqArmas:1 },
};

const FACTIONS = [
  { id:0, name:'Coletivo da Armação',  short:'Armação',   color:'#e8b84b', human:true,  home:'centro' },
  { id:1, name:'Grupo de Manguinhos',  short:'Manguinhos',color:'#5aa9e6', human:false, home:'manguinhos' },
  { id:2, name:'Comissão de Geribá',   short:'Geribá',    color:'#d4553f', human:false, home:'geriba' },
  { id:3, name:'Núcleo da Brava',      short:'Brava',     color:'#8e6fd1', human:false, home:'brava' },
];
