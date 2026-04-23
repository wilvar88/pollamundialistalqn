const API_URL = "https://script.google.com/macros/s/AKfycbxqkwavFCJmMvmKjuRGDIBtmsXTlTm8s6FKqRHoIx9O0YtrsjBTY7SBSj1-Avjpqi7ZJw/exec";
const ADMIN_ID = "1024553483";
const ADMIN_PASS = "LQN1024553483Bogota1994";

// Configuración base de fases (se actualiza desde la hoja 'Puntos' al iniciar)
const FASES_INFO = {
  grupos:    { label:'Grupos',   exacto:10, resultado:5,  partidos:'Partidos 1 al 72 (72 partidos)' },
  dieciseis: { label:'16avos',   exacto:15, resultado:10, partidos:'Partidos 73 al 88 (16 partidos)' },
  octavos:   { label:'8vos',     exacto:25, resultado:15, partidos:'Partidos 89 al 96 (8 partidos)' },
  cuartos:   { label:'4tos',     exacto:35, resultado:25, partidos:'Partidos 97 al 100 (4 partidos)' },
  semifinal: { label:'Semi',     exacto:45, resultado:35, partidos:'Partidos 101 al 102 (2 partidos)' },
  tercero:   { label:'3ro',      exacto:55, resultado:45, partidos:'Partido 103 (3er lugar)' },
  final:     { label:'Final',    exacto:65, resultado:50, partidos:'Partido 104 (Gran Final)' }
};

// Actualiza FASES_INFO con datos del servidor (hoja Puntos)
function applyPuntosConfig(puntosConfig) {
  if (!puntosConfig) return;
  Object.keys(puntosConfig).forEach(fase => {
    if (FASES_INFO[fase]) {
      FASES_INFO[fase].exacto    = puntosConfig[fase].exacto;
      FASES_INFO[fase].resultado = puntosConfig[fase].resultado;
    }
  });
}

// Devuelve la clave de fase a partir del ID de partido
function getFaseFromMatchId(id) {
  const n = parseInt(id);
  for (const [fase, r] of Object.entries(FASES_RANGO)) {
    if (n >= r.min && n <= r.max) return fase;
  }
  return 'grupos';
}

// Construye URL para agregar evento a Google Calendar (convierte hora Bogotá UTC-5 → UTC)
function buildCalendarUrl(match) {
  const fase = getFaseFromMatchId(match.id);
  const faseLabel = (FASES_INFO[fase] || {}).label || 'Fase';
  const [yy, mm, dd] = match.fecha.split('-').map(Number);
  const [hh, min]    = (match.horaInicio || '00:00').split(':').map(Number);
  const startUTC = new Date(Date.UTC(yy, mm - 1, dd, hh + 5, min));
  const endUTC   = new Date(startUTC.getTime() + 2 * 3600000);
  const fmt = d => d.toISOString().replace(/[-:.]/g,'').slice(0,15) + 'Z';
  const title = `⚽ ${match.local} vs ${match.visitante} — ${faseLabel} | Polla LQN 2026`;
  const desc  = `Partido #${match.id} | Fase: ${faseLabel}\nPolla Mundialista LQN 2026\n¡Recuerda hacer tu predicción antes del partido!`;
  return `https://calendar.google.com/calendar/render?action=TEMPLATE` +
    `&text=${encodeURIComponent(title)}&dates=${fmt(startUTC)}/${fmt(endUTC)}` +
    `&details=${encodeURIComponent(desc)}`;
}

// Modal de confirmación antes de abrir Google Calendar
function showCalendarModal(matchId) {
  const match = state.encuentros.find(m => String(m.id) === String(matchId));
  if (!match) return;
  const fase = getFaseFromMatchId(match.id);
  const faseLabel = (FASES_INFO[fase] || {}).label || 'Fase';
  document.getElementById('cal-titulo').textContent = `⚽ ${match.local} vs ${match.visitante}`;
  document.getElementById('cal-fecha').textContent  = `${match.fecha} · ${match.horaInicio} (Bogotá) · Fase: ${faseLabel}`;
  document.getElementById('cal-link').href = buildCalendarUrl(match);
  document.getElementById('modal-calendar').classList.add('active');
}

const FASES_RANGO = {
  grupos:    { min:1,   max:72  },
  dieciseis: { min:73,  max:88  },
  octavos:   { min:89,  max:96  },
  cuartos:   { min:97,  max:100 },
  semifinal: { min:101, max:102 },
  tercero:   { min:103, max:103 },
  final:     { min:104, max:104 }
};

const state = {
  user: null,
  encuentros: [],
  predicciones: {},
  apiData: {},
  ranking: [],
  metadata: {},
  fasesHabilitadas: {},
  bloqueosPartidos: {},
  puntosConfig: null,
  faseActiva: 'grupos',
  isAdmin: false,
  fasePtsAnimadas: {}
};

// ============================================================
// BANDERAS
// ============================================================
const countryCodes = {
  "colombia":"co","espana":"es","argentina":"ar","brasil":"br","chile":"cl",
  "uruguay":"uy","ecuador":"ec","peru":"pe","venezuela":"ve","bolivia":"bo",
  "paraguay":"py","mexico":"mx","estados unidos":"us","usa":"us","costa rica":"cr",
  "panama":"pa","canada":"ca","francia":"fr","inglaterra":"gb-eng","alemania":"de",
  "italia":"it","portugal":"pt","paises bajos":"nl","holanda":"nl","belgica":"be",
  "japon":"jp","corea del sur":"kr","marruecos":"ma","croacia":"hr",
  "republica checa":"cz","bosnia y herzegovina":"ba","bosnia":"ba","suiza":"ch",
  "escocia":"gb-sct","turquia":"tr","australia":"au","haiti":"ht","qatar":"qa",
  "curazao":"cw","costa de marfil":"ci","suecia":"se","tunez":"tn","egipto":"eg",
  "iran":"ir","nueva zelanda":"nz","cabo verde":"cv","arabia saudita":"sa",
  "senegal":"sn","noruega":"no","irak":"iq","argelia":"dz","austria":"at",
  "jordania":"jo","rd congo":"cd","uzbekistan":"uz","ghana":"gh","sudafrica":"za"
};

function getFlagUrl(countryName) {
  const n = countryName.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const code = countryCodes[n];
  if (code) return `https://flagcdn.com/w80/${code}.png`;
  return `https://ui-avatars.com/api/?name=${countryName}&background=random&color=fff&size=80`;
}

// ============================================================
// API
// ============================================================
async function fetchFromAPI(action, payload = {}) {
  payload.action = action;
  try {
    const response = await fetch(API_URL, {
      method:'POST',
      headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify(payload)
    });
    return await response.json();
  } catch(error) {
    console.error("Error API:", error);
    throw error;
  }
}

// ============================================================
// LOGIN
// ============================================================
async function handleLogin() {
  const idInput = document.getElementById('identificacion').value.trim();
  const errorMsg = document.getElementById('login-error');
  if (!idInput) { showError(errorMsg,"Ingrese una identificación"); return; }
  showGlobalLoader(true);
  try {
    const res = await fetchFromAPI('loginUser', { identificacion: idInput });
    if (res && res.id) {
      state.user = res;
      state.isAdmin = String(idInput) === ADMIN_ID;
      errorMsg.style.display = 'none';
      initApp();
    } else {
      showGlobalLoader(false);
      showError(errorMsg,"Identificación no encontrada.");
    }
  } catch(err) {
    showGlobalLoader(false);
    showError(errorMsg,"Error de red o conexión a Apps Script.");
  }
}

function initApp() {
  document.getElementById('login-container').classList.remove('active');
  setTimeout(() => {
    document.getElementById('login-container').style.display = 'none';
    const appContainer = document.getElementById('app-container');
    appContainer.style.display = 'flex';
    appContainer.classList.add('active');
    document.getElementById('user-foto').src = state.user.foto;
    document.getElementById('user-nombre').textContent = state.user.nombre;
    document.getElementById('user-cargo').textContent = state.user.cargo;
    // Mostrar botón admin si corresponde
    if (state.isAdmin) document.getElementById('btn-admin').style.display = 'inline-flex';
    fetchAppData();
  }, 400);
}

async function fetchAppData() {
  try {
    const data = await fetchFromAPI('getInitialData', { identificacion: state.user.id });
    state.encuentros = data.encuentros;
    state.predicciones = data.predicciones;
    state.apiData = data.apiData || {};
    state.ranking = data.ranking || [];
    state.metadata = data.metadata || {};
    state.fasesHabilitadas = data.fasesHabilitadas || {};
    state.bloqueosPartidos = data.bloqueosPartidos || {};
    state.puntosConfig = data.puntosConfig || null;
    // Aplicar puntos desde hoja Puntos del sheet
    if (state.puntosConfig) applyPuntosConfig(state.puntosConfig);
    showGlobalLoader(false);

    // Rellenar modal bienvenida
    const myRank = state.ranking.find(r => String(r.id) === String(state.user.id));
    const pts = myRank ? myRank.puntos : 0;
    document.getElementById('welcome-foto').src = state.user.foto;
    document.getElementById('welcome-nombre').textContent = state.user.nombre;
    document.getElementById('welcome-cargo').textContent = state.user.cargo;
    document.getElementById('welcome-pts').textContent = pts;
    document.getElementById('modal-welcome').classList.add('active');

    // Actualizar estado visual de botones de fase
    updateFaseBtns();
    renderEncuentros();
    renderMisResultados();
    renderRanking();
    setInterval(updateCountdowns, 60000);

    // Animar íconos de puntuación primera vez
    setTimeout(animateFasePtsIcons, 800);
  } catch(error) {
    showGlobalLoader(false);
    alert("Error cargando la información. Por favor revisa la configuración del Apps Script.");
  }
}

function logout() {
  state.user = null; state.isAdmin = false;
  document.getElementById('app-container').classList.remove('active');
  document.getElementById('btn-admin').style.display = 'none';
  setTimeout(() => {
    document.getElementById('app-container').style.display = 'none';
    document.getElementById('login-container').style.display = 'flex';
    void document.getElementById('login-container').offsetWidth;
    document.getElementById('login-container').classList.add('active');
    document.getElementById('identificacion').value = '';
  }, 400);
}

// ============================================================
// TABS
// ============================================================
function switchTab(tabId, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('tab-' + tabId).classList.add('active');
}

// ============================================================
// FASES
// ============================================================
function updateFaseBtns() {
  Object.keys(FASES_INFO).forEach(fase => {
    const btn = document.getElementById('fase-btn-' + fase);
    if (!btn) return;
    const info = state.fasesHabilitadas[fase];
    if (info && !info.habilitada) {
      btn.classList.add('bloqueada');
      btn.title = info.mensaje;
    } else {
      btn.classList.remove('bloqueada');
      btn.title = '';
    }
  });
}

function switchFase(fase, btn) {
  // Verificar si fase está habilitada
  const info = state.fasesHabilitadas[fase];
  if (info && !info.habilitada) {
    showFaseBloqueada(info);
    return;
  }
  state.faseActiva = fase;
  document.querySelectorAll('.fase-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderEncuentros();
}

function showFaseBloqueada(info) {
  const grid = document.getElementById('matches-grid');
  const icono = info.razon === 'admin' ? 'fa-lock' : 'fa-clock';
  grid.innerHTML = `
    <div class="fase-bloqueada-msg">
      <i class="fa-solid ${icono}"></i>
      <p>${info.mensaje}</p>
    </div>`;
}

function animateFasePtsIcons() {
  document.querySelectorAll('.fase-pts-icon').forEach(icon => {
    if (!icon.classList.contains('animar')) {
      icon.classList.add('animar');
      setTimeout(() => icon.classList.remove('animar'), 2500);
    }
  });
}

function showFaseInfo(fase, event) {
  event.stopPropagation();
  const info = FASES_INFO[fase];
  document.getElementById('fase-info-titulo').textContent = `${info.label} — Puntuación`;
  document.getElementById('fase-info-exacto').textContent = info.exacto + ' pts';
  document.getElementById('fase-info-resultado').textContent = info.resultado + ' pts';
  document.getElementById('fase-info-partidos').textContent = info.partidos;
  document.getElementById('modal-fase-info').classList.add('active');
  // Marcar como vista
  state.fasePtsAnimadas[fase] = true;
}

// ============================================================
// ENCUENTROS
// ============================================================
function renderEncuentros() {
  const grid = document.getElementById('matches-grid');
  grid.innerHTML = '';
  const now = new Date().getTime();

  // Filtrar por fase activa
  const rango = FASES_RANGO[state.faseActiva];
  const matchesFase = state.encuentros.filter(m => {
    const id = parseInt(m.id);
    return id >= rango.min && id <= rango.max;
  });

  // Si fase bloqueada, mostrar mensaje
  const faseInfo = state.fasesHabilitadas[state.faseActiva];
  if (faseInfo && !faseInfo.habilitada) {
    showFaseBloqueada(faseInfo);
    return;
  }

  if (matchesFase.length === 0) {
    grid.innerHTML = '<div class="loader-glass"><p>No hay partidos registrados para esta fase.</p></div>';
    return;
  }

  const faseCfg = FASES_INFO[state.faseActiva];

  matchesFase.forEach(match => {
    const [yy,mm,dd] = match.fecha.split('-');
    const [hh,min] = (match.horaInicio || '00:00').split(':');
    const matchTime = new Date(parseInt(yy),parseInt(mm)-1,parseInt(dd),parseInt(hh),parseInt(min)).getTime();
    const isTimeBlocked = now > (matchTime - 3600000);

    // Bloqueo manual por partido
    const bloqPartido = state.bloqueosPartidos[String(match.id)];
    const isAdminBlocked = bloqPartido && bloqPartido.bloqueado;
    const isBlocked = isTimeBlocked || isAdminBlocked;

    const userPred = state.predicciones[match.id] || null;
    let key = match.normLocal + '-' + match.normVisita;
    let apiMatch = state.apiData[key];
    let statusBadge = '<span class="status-badge">Próximo</span>';
    let scoreShow = 'VS';

    if (match.resultadoReal && match.resultadoReal.includes('-')) {
      statusBadge = '<span class="status-badge" style="background:rgba(255,255,255,0.2)">Finalizado</span>';
      scoreShow = match.resultadoReal.replace('-',' - ');
    } else if (apiMatch) {
      if (['LIVE','1H','2H','HT','ET','P'].includes(apiMatch.status)) {
        statusBadge = `<span class="status-badge live">EN VIVO ${apiMatch.elapsed}'</span>`;
        scoreShow = `${apiMatch.scoreHome} - ${apiMatch.scoreAway}`;
      } else if (['FT','AET','PEN'].includes(apiMatch.status)) {
        statusBadge = '<span class="status-badge" style="background:rgba(255,255,255,0.2)">Finalizado</span>';
        scoreShow = `${apiMatch.scoreHome} - ${apiMatch.scoreAway}`;
      }
    }

    const [pHome,pAway] = userPred ? userPred.split('-') : ['',''];
    const card = document.createElement('div');
    card.className = `match-card glass-panel ${isBlocked ? 'blocked' : ''}`;
    card.innerHTML = `
      <div class="match-date">
        <span><i class="fa-regular fa-calendar-days"></i> ${match.fecha} - ${match.horaInicio}
          <span class="fase-badge">${faseCfg.label} · +${faseCfg.exacto}/${faseCfg.resultado}</span>
        </span>
        <span>
          <button class="cal-icon-btn" onclick="showCalendarModal('${match.id}')" title="Guardar en Google Calendar">
            <i class="fa-solid fa-calendar-plus"></i>
          </button>
          ${statusBadge} <span id="cd-${match.id}" class="countdown" data-time="${matchTime}" style="margin-left:10px;"></span>
        </span>
      </div>
      <div class="match-teams">
        <div class="team">
          <img src="${getFlagUrl(match.local)}" alt="${match.local}" class="flag click-flag" onclick="showMetadata('${match.local}')" title="Ver Metadatos">
          <span>${match.local}</span>
          <input type="number" id="sc-local-${match.id}" class="score-input glass-input" min="0" placeholder="-" value="${pHome}" ${isBlocked ? 'disabled' : ''}>
        </div>
        <div class="vs">${scoreShow !== 'VS' ? scoreShow : 'VS'}</div>
        <div class="team">
          <input type="number" id="sc-visita-${match.id}" class="score-input glass-input" min="0" placeholder="-" value="${pAway}" ${isBlocked ? 'disabled' : ''}>
          <span>${match.visitante}</span>
          <img src="${getFlagUrl(match.visitante)}" alt="${match.visitante}" class="flag click-flag" onclick="showMetadata('${match.visitante}')" title="Ver Metadatos">
        </div>
      </div>
      <button class="btn-premium" onclick="submitPredictionInline('${match.id}')" ${isBlocked ? 'disabled' : ''}>
        ${userPred ? '<i class="fa-solid fa-pen"></i> Actualizar Predicción' : '<i class="fa-solid fa-floppy-disk"></i> Guardar Predicción'}
      </button>`;
    grid.appendChild(card);
  });
  updateCountdowns();
}

function updateCountdowns() {
  const now = new Date().getTime();
  document.querySelectorAll('.countdown').forEach(el => {
    const time = parseInt(el.getAttribute('data-time'));
    const diff = time - now;
    if (diff < 3600000 && diff > 0) { el.textContent = "(Cerrado)"; el.style.color = 'var(--text-muted)'; }
    else if (diff <= 0) { el.innerHTML = ""; }
    else {
      const diffBlock = diff - 3600000;
      if (diffBlock < 86400000) {
        const h = Math.floor(diffBlock/3600000); const m = Math.floor((diffBlock%3600000)/60000);
        el.textContent = `(Cierra en ${h}h ${m}m)`; el.style.color = (h<2) ? 'var(--color-red)' : 'var(--accent-gold)';
      } else { el.textContent = `(Cierra en ${Math.floor(diffBlock/86400000)} días)`; el.style.color = 'inherit'; }
    }
  });
}

// ============================================================
// MIS PREDICCIONES
// ============================================================
function getPhasePoints(matchId, pred, actualScore) {
  let exacto = 10, resultado = 5;
  const id = parseInt(matchId);
  for (const [fase, rango] of Object.entries(FASES_RANGO)) {
    if (id >= rango.min && id <= rango.max) {
      exacto = FASES_INFO[fase].exacto;
      resultado = FASES_INFO[fase].resultado;
      break;
    }
  }
  const [pHome,pAway] = pred.split('-').map(Number);
  const [rHome,rAway] = actualScore.split('-').map(Number);
  if (pHome===rHome && pAway===rAway) return { pts: exacto, tipo: 'exacto' };
  if (((pHome>pAway)?1:(pHome<pAway)?-1:0) === ((rHome>rAway)?1:(rHome<rAway)?-1:0)) return { pts: resultado, tipo: 'resultado' };
  return { pts: 0, tipo: 'fallo' };
}

function renderMisResultados() {
  const list = document.getElementById('history-list'); list.innerHTML = '';
  let apostados = 0; const total = state.encuentros.length;
  const myRank = state.ranking.find(r => String(r.id) === String(state.user.id));
  if (myRank) {
    document.getElementById('my-total-pts').textContent = myRank.puntos;
    document.getElementById('my-exact-hits').textContent = myRank.aciertos;
  }
  state.encuentros.forEach(match => {
    const pred = state.predicciones[match.id];
    if (pred) {
      apostados++;
      let apiMatch = state.apiData[match.normLocal+'-'+match.normVisita];
      let ptsText = "Pendiente"; let ptsClass = ""; let actualScore = "";
      if (match.resultadoReal && match.resultadoReal.includes('-')) actualScore = match.resultadoReal;
      else if (apiMatch && apiMatch.status==='FT') actualScore = `${apiMatch.scoreHome}-${apiMatch.scoreAway}`;
      if (actualScore) {
        const r = getPhasePoints(match.id, pred, actualScore);
        if (r.tipo==='exacto') { ptsClass='success'; ptsText=`+${r.pts} Pts <i class='fa-solid fa-circle-check'></i>`; }
        else if (r.tipo==='resultado') { ptsClass='partial'; ptsText=`+${r.pts} Pts <i class='fa-solid fa-check'></i>`; }
        else { ptsClass='partial'; ptsText=`0 Pts <i class='fa-solid fa-xmark'></i>`; }
      }
      const item = document.createElement('div'); item.className='history-item glass-panel';
      item.innerHTML=`<div class="history-info"><strong>${match.local} vs ${match.visitante}</strong><span class="my-pred">Tu predicción: ${pred} ${actualScore ? `<br/>Marcador Real: ${actualScore}` : ''}</span></div><div class="history-points ${ptsClass}">${ptsText}</div>`;
      list.appendChild(item);
    }
  });
  document.getElementById('my-missing-preds').textContent = (total - apostados);
}

// ============================================================
// RANKING
// ============================================================
function renderRanking() {
  const list = document.getElementById('ranking-list'); list.innerHTML = '';
  if (state.ranking.length === 0) { list.innerHTML = '<div class="loader-glass"><p>Ranking no disponible.</p></div>'; return; }
  state.ranking.forEach((rk, index) => {
    const posClass = index===0?'top-1':index===1?'top-2':index===2?'top-3':'';
    const icons = ['<i class="fa-solid fa-medal" style="color:#FFD700;"></i>','<i class="fa-solid fa-medal" style="color:#C0C0C0;"></i>','<i class="fa-solid fa-medal" style="color:#CD7F32;"></i>'];
    const posDisplay = index<3 ? `${icons[index]} ${index+1}` : `${index+1}`;
    const el = document.createElement('div'); el.className=`ranking-row ${posClass}`;
    let nameDisplay = String(rk.id)===String(state.user.id) ? `<strong>Tú</strong> (${rk.nombre})` : rk.nombre;
    el.innerHTML=`<span class="pos">${posDisplay}</span><span class="name"><img src="${rk.foto}" alt="perfil">${nameDisplay}</span><span class="pts">${rk.puntos}</span>`;
    list.appendChild(el);
  });
}

// ============================================================
// GUARDAR PREDICCIÓN
// ============================================================
async function submitPredictionInline(matchId) {
  const l = document.getElementById(`sc-local-${matchId}`).value;
  const v = document.getElementById(`sc-visita-${matchId}`).value;
  if (l===''||v==='') { alert('Por favor ingresa ambos números para el marcador.'); return; }
  const predictionText = `${l}-${v}`;
  showGlobalLoader(true);
  try {
    const res = await fetchFromAPI('savePrediction', { identificacion:state.user.id, matchId, prediction:predictionText });
    showGlobalLoader(false);
    if (res.success) { state.predicciones[matchId] = predictionText; renderEncuentros(); renderMisResultados(); }
    else alert("Uy! " + res.message);
  } catch(error) { showGlobalLoader(false); alert("Error de red intentando guardar la predicción."); }
}

// ============================================================
// COIN FLIP — MODAL BIENVENIDA (gira, expande a 80%, espera 4s, vuelve)
// ============================================================
function doWelcomeFlip() {
  const container = document.getElementById('card-flip-container');
  const front = container.querySelector('.card-front');
  const back  = container.querySelector('.card-back');

  // Paso 1: girar hacia afuera
  container.classList.add('flipping');

  // Al llegar al "canto" de la moneda, mostrar cara trasera
  setTimeout(() => {
    front.style.display = 'none';
    back.style.display  = 'flex';
    // Expandir a 80% de la ventana
    container.classList.add('expanded');
    container.classList.remove('flipping');
  }, 700);
  // La tarjeta espera al clic en "Continuar" — ver continueFromFlip()
}

// Se llama al hacer clic en "Continuar" en la cara trasera
function continueFromFlip() {
  const container = document.getElementById('card-flip-container');
  const front = container.querySelector('.card-front');
  const back  = container.querySelector('.card-back');
  container.classList.remove('expanded');
  container.classList.add('flipping-back');
  setTimeout(() => {
    back.style.display  = 'none';
    front.style.display = 'flex';
    container.classList.remove('flipping-back');
    closeModals();
  }, 1200);
}

// ============================================================
// MODALES
// ============================================================
// Modal de perfil de usuario
function showProfileCard() {
  const pred = Object.keys(state.predicciones).length;
  const total = state.encuentros.length;
  const myRank = state.ranking.find(r => String(r.id) === String(state.user.id));
  const puntos   = myRank ? myRank.puntos   : 0;
  const aciertos = myRank ? myRank.aciertos : 0;

  document.getElementById('prof-foto').src           = state.user.foto;
  document.getElementById('prof-nombre').textContent  = state.user.nombre;
  document.getElementById('prof-cargo').textContent   = state.user.cargo;
  document.getElementById('prof-pred-hechas').textContent  = pred;
  document.getElementById('prof-pred-hechas2').textContent = pred;
  document.getElementById('prof-pred-total').textContent   = total;
  document.getElementById('prof-aciertos').textContent     = aciertos;
  document.getElementById('prof-puntos').textContent       = puntos;

  document.getElementById('modal-profile').classList.add('active');
}

function showRulesModal() { document.getElementById('modal-rules').classList.add('active'); }
function closeModals() { document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active')); }
function closeModalsOnBg(e) { if (e.target.classList.contains('modal-overlay')) closeModals(); }

function showMetadata(countryName) {
  const normName = countryName.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/fc|club|deportivo|atletico|real|city|united/g,"").trim();
  const meta = state.metadata[normName];
  if (!meta) { alert("Aún no hay metadatos registrados para " + countryName); return; }
  document.getElementById('meta-flag').src = getFlagUrl(countryName);
  document.getElementById('meta-country').textContent = meta.nombreOriginal.toUpperCase();
  document.getElementById('meta-ganados').textContent = meta.ganados;
  document.getElementById('meta-part').textContent = meta.participaciones;
  document.getElementById('meta-ultimas').textContent = meta.ultimas;
  document.getElementById('meta-jugador').textContent = meta.jugador;
  document.getElementById('meta-conf').textContent = meta.confederacion;
  document.getElementById('modal-metadata').classList.add('active');
}

// ============================================================
// ADMINISTRACIÓN
// ============================================================
function handleAdminAccess() {
  document.getElementById('admin-pass-input').value = '';
  document.getElementById('admin-pass-error').style.display = 'none';
  document.getElementById('modal-admin-pass').classList.add('active');
}

function verifyAdminPass() {
  const pass = document.getElementById('admin-pass-input').value;
  if (pass === ADMIN_PASS) {
    closeModals();
    openAdminPanel();
  } else {
    document.getElementById('admin-pass-error').style.display = 'block';
  }
}

function openAdminPanel() {
  const container = document.getElementById('admin-fases-list');
  container.innerHTML = '';

  const faseNames = Object.keys(FASES_INFO);
  faseNames.forEach(fase => {
    const info = FASES_INFO[fase];
    const bloq = state.fasesHabilitadas[fase];
    const isBlocked = bloq && !bloq.habilitada && bloq.razon === 'admin';

    const row = document.createElement('div');
    row.className = 'admin-fase-row';
    row.innerHTML = `
      <div>
        <div class="admin-fase-label">${info.label}</div>
        <small style="color:var(--text-muted)">Partidos: ${info.partidos}</small>
        <div>
          <input class="admin-razon-input" id="razon-${fase}" placeholder="Motivo del bloqueo (opcional)" value="${(bloq&&bloq.mensaje&&bloq.razon==='admin')?bloq.mensaje:''}">
        </div>
      </div>
      <div class="admin-toggle">
        <span style="font-size:0.8rem;color:${isBlocked?'var(--color-red)':'var(--success)'}">
          ${isBlocked ? '🔒 Bloqueada' : '🔓 Activa'}
        </span>
        <label class="toggle-switch">
          <input type="checkbox" id="toggle-${fase}" ${isBlocked?'':'checked'} onchange="toggleFaseAdmin('${fase}',this)">
          <span class="toggle-slider"></span>
        </label>
      </div>`;
    container.appendChild(row);
  });

  document.getElementById('modal-admin').classList.add('active');
}

async function toggleFaseAdmin(fase, checkbox) {
  const habilitada = checkbox.checked;
  const razon = document.getElementById('razon-' + fase).value || '';
  const bloqueado = !habilitada;
  showGlobalLoader(true);
  try {
    await fetchFromAPI('adminBlock', { tipo:'fase_'+fase, key:fase, bloqueado, razon });
    // Actualizar estado local
    if (bloqueado) {
      state.fasesHabilitadas[fase] = { habilitada:false, razon:'admin', mensaje: razon || 'Comunícate con el administrador.' };
    } else {
      state.fasesHabilitadas[fase] = { habilitada:true, razon:'', mensaje:'' };
    }
    updateFaseBtns();
    showGlobalLoader(false);
  } catch(e) {
    showGlobalLoader(false);
    alert("Error guardando bloqueo.");
    checkbox.checked = !bloqueado; // revertir
  }
}

// ============================================================
// UTILIDADES
// ============================================================
function showGlobalLoader(show) { document.getElementById('global-loader').style.display = show ? 'flex' : 'none'; }
function showError(el, msg) { el.textContent = msg; el.style.display = 'block'; setTimeout(()=>{ el.style.display='none'; }, 4000); }
