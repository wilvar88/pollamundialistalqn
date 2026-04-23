const API_KEY = 'TU_RAPIDAPI_KEY_AQUI'; 
const SHEET_ID = 'TU_SPREADSHEET_ID_AQUI'; 
const TIMEZONE = 'America/Bogota';

// Configuración de fases: rangos de IDs y puntos
const FASES_CONFIG = {
  grupos:    { min: 1,   max: 72,  exacto: 10, resultado: 5  },
  dieciseis: { min: 73,  max: 88,  exacto: 15, resultado: 10 },
  octavos:   { min: 89,  max: 96,  exacto: 25, resultado: 15 },
  cuartos:   { min: 97,  max: 100, exacto: 35, resultado: 25 },
  semifinal: { min: 101, max: 102, exacto: 45, resultado: 35 },
  tercero:   { min: 103, max: 103, exacto: 55, resultado: 45 },
  final:     { min: 104, max: 104, exacto: 66, resultado: 50 }
};

function getFaseConfig(matchId) {
  const id = parseInt(matchId);
  for (const [fase, cfg] of Object.entries(FASES_CONFIG)) {
    if (id >= cfg.min && id <= cfg.max) return { fase, ...cfg };
  }
  return { fase: 'grupos', exacto: 10, resultado: 5 };
}

function doPost(e) {
  try {
    let postData = JSON.parse(e.postData.contents);
    let action = postData.action;
    let result = {};
    if (action === 'loginUser')       result = loginUser(postData.identificacion);
    else if (action === 'getInitialData') result = getInitialData(postData.identificacion);
    else if (action === 'savePrediction') result = savePrediction(postData.identificacion, postData.matchId, postData.prediction);
    else if (action === 'adminBlock')  result = adminBlock(postData.tipo, postData.key, postData.bloqueado, postData.razon);
    return ContentService.createTextOutput(JSON.stringify(result || {success: false, message: 'Not found'}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({success: false, message: err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  if (e.parameter.action) {
    let action = e.parameter.action;
    let result = {};
    if (action === 'loginUser') result = loginUser(e.parameter.identificacion);
    else if (action === 'getInitialData') result = getInitialData(e.parameter.identificacion);
    else if (action === 'savePrediction') result = savePrediction(e.parameter.identificacion, e.parameter.matchId, e.parameter.prediction);
    return ContentService.createTextOutput(JSON.stringify(result || {success: false, message: 'Not found'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Polla Mundialista - BASETEK')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function fixDriveUrl(url) {
  if (!url) return 'https://via.placeholder.com/150';
  const match = String(url).match(/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return 'https://drive.google.com/thumbnail?id=' + match[1] + '&sz=w600-h800';
  return url;
}

function normalizeTeam(name) {
  return String(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
         .replace(/fc|club|deportivo|atletico|real|city|united/g, "").trim();
}

function loginUser(identificacion) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Jugadores');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(identificacion).trim()) {
      return { id: data[i][0], nombre: data[i][1], cargo: data[i][2], foto: fixDriveUrl(data[i][3]) };
    }
  }
  return null;
}

// -------------------------------------------------------
// LEER Y ESCRIBIR BLOQUEOS EN HOJA "Configuracion"
// -------------------------------------------------------
function getBloqueos(ss) {
  let configSheet = ss.getSheetByName('Configuracion');
  if (!configSheet) {
    configSheet = ss.insertSheet('Configuracion');
    configSheet.appendRow(['tipo', 'key', 'bloqueado', 'razon']);
  }
  const data = configSheet.getDataRange().getValues();
  let bloqueos = {};
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const tipo = String(data[i][0]).trim();
    const key  = String(data[i][1]).trim();
    // Fases usan tipo como clave directa: 'fase_grupos', 'fase_dieciseis', etc.
    // Partidos usan 'partido_<id>'
    const compositeKey = tipo.startsWith('fase_') ? tipo : tipo + '_' + key;
    bloqueos[compositeKey] = {
      bloqueado: data[i][2] === true || String(data[i][2]).toUpperCase() === 'TRUE',
      razon: data[i][3] || ''
    };
  }
  return bloqueos;
}

// Lee hoja 'Puntos' y devuelve mapa fase→{exacto,resultado}
function getPuntosConfig(ss) {
  const sheet = ss.getSheetByName('Puntos');
  const defaults = {
    grupos:    { exacto:10, resultado:5  },
    dieciseis: { exacto:15, resultado:10 },
    octavos:   { exacto:25, resultado:15 },
    cuartos:   { exacto:35, resultado:25 },
    semifinal: { exacto:45, resultado:35 },
    tercero:   { exacto:55, resultado:45 },
    final:     { exacto:66, resultado:50 }
  };
  if (!sheet) return defaults;
  const faseMap = {
    'grupos':'grupos','16avos':'dieciseis','8avos':'octavos',
    'cuartos':'cuartos','semifinal':'semifinal','tercero':'tercero','final':'final'
  };
  const data = sheet.getDataRange().getDisplayValues();
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const key = faseMap[String(data[i][0]).toLowerCase().trim()];
    if (key) {
      defaults[key] = {
        exacto:    parseInt(data[i][1]) || defaults[key].exacto,
        resultado: parseInt(data[i][2]) || defaults[key].resultado
      };
    }
  }
  return defaults;
}

function adminBlock(tipo, key, bloqueado, razon) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let configSheet = ss.getSheetByName('Configuracion');
  if (!configSheet) {
    configSheet = ss.insertSheet('Configuracion');
    configSheet.appendRow(['tipo', 'key', 'bloqueado', 'razon']);
  }
  const data = configSheet.getDataRange().getValues();
  let found = false;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(tipo) && String(data[i][1]) === String(key)) {
      configSheet.getRange(i + 1, 3).setValue(bloqueado);
      configSheet.getRange(i + 1, 4).setValue(razon || '');
      found = true;
      break;
    }
  }
  if (!found) {
    configSheet.appendRow([tipo, key, bloqueado, razon || '']);
  }
  return { success: true };
}

// -------------------------------------------------------
// CALCULAR FASES HABILITADAS (48h antes del 1er partido)
// -------------------------------------------------------
function getFasesHabilitadas(encuentros, bloqueos) {
  const now = new Date().getTime();
  const MS_48H = 48 * 3600 * 1000;

  let fasesHabilitadas = {};
  for (const [fase, cfg] of Object.entries(FASES_CONFIG)) {
    // Fase grupos siempre habilitada por tiempo, puede bloquearse manualmente
    let habilitadaPorTiempo = (fase === 'grupos');

    if (!habilitadaPorTiempo) {
      // Buscar el primer partido de esta fase
      const primerPartido = encuentros.find(e => {
        const id = parseInt(e.id);
        return id >= cfg.min && id <= cfg.max;
      });
      if (primerPartido) {
        const [yy, mm, dd] = primerPartido.fecha.split('-');
        const [hh, min] = (primerPartido.horaInicio || '00:00').split(':');
        const matchTime = new Date(parseInt(yy), parseInt(mm) - 1, parseInt(dd), parseInt(hh), parseInt(min)).getTime();
        habilitadaPorTiempo = now >= (matchTime - MS_48H);
      }
    }

    // Verificar bloqueo manual del admin
    const bloqueoClave = 'fase_' + fase;
    const bloqueoManual = bloqueos[bloqueoClave] || null;

    if (bloqueoManual && bloqueoManual.bloqueado) {
      fasesHabilitadas[fase] = { habilitada: false, razon: 'admin', mensaje: 'Comunícate con el administrador.' };
    } else if (!habilitadaPorTiempo) {
      fasesHabilitadas[fase] = { habilitada: false, razon: 'tiempo', mensaje: 'Faltando 48 horas del primer encuentro podrás ver la lista de encuentros de esta fase.' };
    } else {
      fasesHabilitadas[fase] = { habilitada: true, razon: '', mensaje: '' };
    }
  }
  return fasesHabilitadas;
}

function getInitialData(identificacion) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  
  const metadataSheet = ss.getSheetByName('Metadata País');
  let metadata = {};
  if (metadataSheet) {
    const metaDataArray = metadataSheet.getDataRange().getDisplayValues();
    for (let i = 1; i < metaDataArray.length; i++) {
       if(!metaDataArray[i][0]) continue;
       let country = normalizeTeam(metaDataArray[i][0]);
       metadata[country] = {
           nombreOriginal: metaDataArray[i][0],
           ganados: metaDataArray[i][1] || "0",
           participaciones: metaDataArray[i][2] || "0",
           ultimas: metaDataArray[i][3] || "-",
           jugador: metaDataArray[i][4] || "-",
           confederacion: metaDataArray[i][5] || "-"
       };
    }
  }

  const encuentrosData = ss.getSheetByName('Fechas/Encuentros').getDataRange().getValues();
  const encuentros = [];
  
  for (let i = 1; i < encuentrosData.length; i++) {
    if (!encuentrosData[i][0]) continue;
    let dateVal = encuentrosData[i][1];
    let timeVal = encuentrosData[i][2];
    let fechaStr = (dateVal instanceof Date) ? Utilities.formatDate(dateVal, TIMEZONE, 'yyyy-MM-dd') : String(dateVal).trim();
    let horaStr = "";
    if (timeVal instanceof Date) {
      horaStr = Utilities.formatDate(timeVal, TIMEZONE, 'HH:mm');
    } else {
      let t = String(timeVal).trim();
      let m = t.match(/(\d+):(\d+)\s*(A\.?M\.?|P\.?M\.?)/i);
      if (m) {
        let h = parseInt(m[1]); let min = m[2]; let ampm = m[3].toUpperCase().replace(/\./g, '');
        if (ampm === 'PM' && h < 12) h += 12; if (ampm === 'AM' && h === 12) h = 0;
        horaStr = (h < 10 ? '0' + h : h) + ':' + min;
      } else { horaStr = t; }
    }
    encuentros.push({
      id: encuentrosData[i][0],
      fecha: fechaStr,
      horaInicio: horaStr,
      local: encuentrosData[i][3],
      visitante: encuentrosData[i][4],
      normLocal: normalizeTeam(encuentrosData[i][3]),
      normVisita: normalizeTeam(encuentrosData[i][4]),
      resultadoReal: String(encuentrosData[i][5]).trim()
    });
  }
  
  const ganadoresData = ss.getSheetByName('Ganadores').getDataRange().getValues();
  let predicciones = {};
  for (let i = 1; i < ganadoresData.length; i++) {
    if (String(ganadoresData[i][0]).trim() === String(identificacion).trim()) {
      for (let j = 3; j < ganadoresData[0].length; j++) {
        const val = ganadoresData[i][j];
        // Filtrar valores que Google Sheets haya convertido a fecha (son Date objects)
        if (ganadoresData[0][j] && val && !(val instanceof Date)) {
          const strVal = String(val).trim();
          // Solo aceptar formato N-N (predicción válida)
          if (/^\d+-\d+$/.test(strVal)) predicciones[ganadoresData[0][j]] = strVal;
        }
      }
      break;
    }
  }
  
  const bloqueos = getBloqueos(ss);
  let bloqueosPartidos = {};
  for (const [k, v] of Object.entries(bloqueos)) {
    if (k.startsWith('partido_')) {
      bloqueosPartidos[k.replace('partido_', '')] = v;
    }
  }

  const cache = CacheService.getScriptCache();
  const apiData = cache.get('live_scores') ? JSON.parse(cache.get('live_scores')) : {};
  const puntosConfig = getPuntosConfig(ss);
  const ranking = getRanking(ss, ganadoresData, encuentros, puntosConfig);
  const fasesHabilitadas = getFasesHabilitadas(encuentros, bloqueos);

  return { encuentros, predicciones, apiData, ranking, metadata, fasesHabilitadas, bloqueosPartidos, puntosConfig };
}

function savePrediction(identificacion, matchId, prediction) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const encData = ss.getSheetByName('Fechas/Encuentros').getDataRange().getValues();
  let matchStart = null;
  
  for(let i = 1; i < encData.length; i++){
    if(String(encData[i][0]) === String(matchId)) {
      let dVal = encData[i][1];
      let dateBase = (dVal instanceof Date) ? dVal : new Date(dVal);
      if(isNaN(dateBase)) break;
      let tVal = encData[i][2];
      let tStr = "";
      if (tVal instanceof Date) { tStr = Utilities.formatDate(tVal, TIMEZONE, 'HH:mm'); }
      else {
        let m = String(tVal).trim().match(/(\d+):(\d+)\s*(A\.?M\.?|P\.?M\.?)/i);
        if(m) {
          let h = parseInt(m[1]); let min = m[2]; let ampm = m[3].toUpperCase().replace(/\./g, '');
          if (ampm === 'PM' && h < 12) h += 12; if (ampm === 'AM' && h === 12) h = 0;
          tStr = (h < 10 ? '0'+h : h) + ':' + min;
        } else tStr = String(tVal).trim();
      }
      if(tStr.includes(':')) {
        let parts = tStr.split(':'); dateBase.setHours(parseInt(parts[0]), parseInt(parts[1]), 0, 0);
      }
      matchStart = dateBase.getTime();
      break;
    }
  }
  
  const now = new Date().getTime();
  if (matchStart && (now > (matchStart - 3600000))) return { success: false, message: 'El partido cerró hace menos de 60 minutos.' };
  
  const ganadoresSheet = ss.getSheetByName('Ganadores');
  const data = ganadoresSheet.getDataRange().getValues();
  let colIndex = data[0].indexOf(matchId);
  if (colIndex === -1) { colIndex = data[0].length; ganadoresSheet.getRange(1, colIndex + 1).setValue(matchId); }
  
  let userRow = -1;
  for (let i = 1; i < data.length; i++) if (String(data[i][0]).trim() === String(identificacion).trim()) { userRow = i + 1; break; }
  
  if (userRow === -1) {
    const jugador = loginUser(identificacion);
    if (!jugador) return { success: false, message: 'Usuario no válido.' };
    let newRow = Array(colIndex + 1).fill("");
    newRow[0] = jugador.id; newRow[1] = jugador.nombre; newRow[2] = jugador.cargo;
    ganadoresSheet.appendRow(newRow);
    // Forzar formato texto ANTES de escribir para evitar conversión a fecha
    const newUserRow = ganadoresSheet.getLastRow();
    const cell = ganadoresSheet.getRange(newUserRow, colIndex + 1);
    cell.setNumberFormat('@STRING@');
    cell.setValue(prediction);
  } else {
    const cell = ganadoresSheet.getRange(userRow, colIndex + 1);
    cell.setNumberFormat('@STRING@');
    cell.setValue(prediction);
  }
  return { success: true, message: 'Guardado exitosamente.' };
}

// -------------------------------------------------------
// AVANCE AUTOMÁTICO DE EQUIPOS (8avos en adelante)
// El bracket de eliminación directa desde ID 89:
//   8avos: 89-96 (8 partidos) → 4 ganadores van a Cuartos 97-100
//   Cuartos: 97-100 → 2 ganadores van a Semis 101-102
//   Semis: 101-102 → ganadores van a Final (104), perdedores van a 3ro (103)
//   Función helper que devuelve el ID del siguiente partido y si es local o visitante
// -------------------------------------------------------
function getSiguientePartido(matchId) {
  const id = parseInt(matchId);
  // 8avos → Cuartos
  // 89,90→97L/V; 91,92→98L/V; 93,94→99L/V; 95,96→100L/V
  const bracket8avos = {89:{sig:97,pos:'local'},90:{sig:97,pos:'visitante'},91:{sig:98,pos:'local'},92:{sig:98,pos:'visitante'},93:{sig:99,pos:'local'},94:{sig:99,pos:'visitante'},95:{sig:100,pos:'local'},96:{sig:100,pos:'visitante'}};
  // Cuartos → Semis
  const bracketCuartos = {97:{sig:101,pos:'local'},98:{sig:101,pos:'visitante'},99:{sig:102,pos:'local'},100:{sig:102,pos:'visitante'}};
  // Semis → Final y 3ro
  const bracketSemis = {101:{sig:104,pos:'local',perdedor:{sig:103,pos:'local'}},102:{sig:104,pos:'visitante',perdedor:{sig:103,pos:'visitante'}}};

  if (bracket8avos[id]) return [{ sig: bracket8avos[id].sig, pos: bracket8avos[id].pos, tipo: 'ganador' }];
  if (bracketCuartos[id]) return [{ sig: bracketCuartos[id].sig, pos: bracketCuartos[id].pos, tipo: 'ganador' }];
  if (bracketSemis[id]) return [
    { sig: bracketSemis[id].sig, pos: bracketSemis[id].pos, tipo: 'ganador' },
    { sig: bracketSemis[id].perdedor.sig, pos: bracketSemis[id].perdedor.pos, tipo: 'perdedor' }
  ];
  return [];
}

function advanceTeams(ss, encSheet, encData, matchId, scoreLocal, scoreVisita, nombreLocal, nombreVisita) {
  const id = parseInt(matchId);
  if (id < 89) return; // Solo desde 8avos
  const siguientes = getSiguientePartido(id);
  if (!siguientes.length) return;

  const ganador = scoreLocal > scoreVisita ? nombreLocal : (scoreVisita > scoreLocal ? nombreVisita : null);
  const perdedor = scoreLocal > scoreVisita ? nombreVisita : (scoreVisita > scoreLocal ? nombreLocal : null);

  siguientes.forEach(s => {
    const equipo = (s.tipo === 'ganador') ? ganador : perdedor;
    if (!equipo) return;
    // Buscar la fila del partido siguiente
    for (let i = 1; i < encData.length; i++) {
      if (parseInt(encData[i][0]) === s.sig) {
        const col = s.pos === 'local' ? 4 : 5; // D=local(4), E=visitante(5)
        const currentVal = String(encData[i][col - 1]).trim();
        if (!currentVal) {
          encSheet.getRange(i + 1, col).setValue(equipo);
        }
        break;
      }
    }
  });
}

// -------------------------------------------------------
// LIVE SCORES Y AUTO-GUARDADO EN SHEET
// -------------------------------------------------------
function updateLiveScores() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const encSheet = ss.getSheetByName('Fechas/Encuentros');
  const encData = encSheet.getDataRange().getValues();
  const today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  const cache = CacheService.getScriptCache();
  const url = `https://api-football-v1.p.rapidapi.com/v3/fixtures?date=${today}&timezone=${TIMEZONE}`;
  
  try {
    const response = UrlFetchApp.fetch(url, { method: 'GET', headers: { 'x-rapidapi-key': API_KEY, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }, muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return;
    const result = JSON.parse(response.getContentText());
    let liveData = cache.get('live_scores') ? JSON.parse(cache.get('live_scores')) : {};
    if (result.response) {
      result.response.forEach(match => {
        let normHome = normalizeTeam(match.teams.home.name);
        let normAway = normalizeTeam(match.teams.away.name);
        liveData[normHome + '-' + normAway] = { status: match.fixture.status.short, elapsed: match.fixture.status.elapsed, scoreHome: match.goals.home, scoreAway: match.goals.away };
        if (['FT', 'AET', 'PEN'].includes(match.fixture.status.short)) {
          for(let i=1; i<encData.length; i++) {
            if (normalizeTeam(encData[i][3]) === normHome && normalizeTeam(encData[i][4]) === normAway) {
              if (String(encData[i][5]).trim() === "") {
                encSheet.getRange(i+1, 6).setValue(match.goals.home + "-" + match.goals.away);
                // Avanzar equipos en bracket
                advanceTeams(ss, encSheet, encData, encData[i][0], match.goals.home, match.goals.away, encData[i][3], encData[i][4]);
              }
            }
          }
        }
      });
      cache.put('live_scores', JSON.stringify(liveData), 21600);
    }
  } catch (e) {}
}

// -------------------------------------------------------
// RANKING CON PUNTOS POR FASE
// -------------------------------------------------------
function getRanking(ss, ganadoresData, encuentros, puntosConfig) {
  if (!puntosConfig) puntosConfig = getPuntosConfig(ss);
  const jugData = ss.getSheetByName('Jugadores').getDataRange().getValues();
  let fotos = {}; let correos = {};
  for(let i=1; i<jugData.length; i++) {
     let uId = String(jugData[i][0]).trim();
     fotos[uId] = fixDriveUrl(jugData[i][3]);
     if(jugData[i].length > 4 && String(jugData[i][4]).includes('@')) correos[uId] = jugData[i][4];
  }
  
  let resultadosReales = {};
  encuentros.forEach(e => {
    if (e.resultadoReal && e.resultadoReal.includes('-')) {
      let p = e.resultadoReal.split('-');
      resultadosReales[e.id] = { h: parseInt(p[0]), a: parseInt(p[1]) };
    }
  });
  
  const headers = ganadoresData[0];
  let ranking = [];
  
  for(let i=1; i<ganadoresData.length; i++) {
    let puntosTotales = 0; let aciertos = 0; let userId = String(ganadoresData[i][0]).trim();
    for(let j=3; j<headers.length; j++) {
      let matchId = headers[j]; let prediccion = ganadoresData[i][j];
      if(prediccion && !(prediccion instanceof Date) && resultadosReales[matchId]) {
        const faseCfg = getFaseConfig(matchId);
        // Usar puntosConfig si está disponible
        const cfgPts = puntosConfig[faseCfg.fase] || faseCfg;
        let strPred = String(prediccion).trim();
        if (!/^\d+-\d+$/.test(strPred)) continue;
        let pParts = strPred.split('-');
        let pHome = parseInt(pParts[0]); let pAway = parseInt(pParts[1]);
        let rHome = resultadosReales[matchId].h; let rAway = resultadosReales[matchId].a;
        if(pHome === rHome && pAway === rAway) { puntosTotales += cfgPts.exacto; aciertos++; }
        else if(((pHome > pAway)?1:(pHome<pAway)?-1:0) === ((rHome>rAway)?1:(rHome<rAway)?-1:0)) {
          puntosTotales += faseCfg.resultado;
        }
      }
    }
    ranking.push({ id: userId, foto: fotos[userId] || 'https://via.placeholder.com/150', nombre: ganadoresData[i][1], correo: correos[userId], aciertos, puntos: Math.round(puntosTotales * 100) / 100 });
  }
  ranking.sort((a,b) => b.puntos - a.puntos);
  return ranking;
}

function sendDailySummary() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const encData = ss.getSheetByName('Fechas/Encuentros').getDataRange().getValues();
  const ganadoresData = ss.getSheetByName('Ganadores').getDataRange().getValues();
  const encuentros = [];
  for(let i=1; i<encData.length; i++){
    if(!encData[i][0]) continue;
    let dateVal = encData[i][1]; let fechaStr = (dateVal instanceof Date) ? Utilities.formatDate(dateVal, TIMEZONE, 'yyyy-MM-dd') : String(dateVal).trim();
    encuentros.push({ id: encData[i][0], fecha: fechaStr, horaInicio: '', local: encData[i][3], visitante: encData[i][4], normLocal: normalizeTeam(encData[i][3]), normVisita: normalizeTeam(encData[i][4]), resultadoReal: String(encData[i][5]).trim() });
  }
  const ranking = getRanking(ss, ganadoresData, encuentros);
  if(ranking.length === 0) return;
  const top1 = ranking[0] ? `${ranking[0].nombre} (${ranking[0].puntos}pts)` : 'N/A';
  const top2 = ranking[1] ? `${ranking[1].nombre} (${ranking[1].puntos}pts)` : 'N/A';
  const top3 = ranking[2] ? `${ranking[2].nombre} (${ranking[2].puntos}pts)` : 'N/A';
  const today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  ranking.forEach(jugador => {
    if(jugador.correo) {
      let subject = `Resultados del día en Polla Mundialista BASETEK`;
      let htmlBody = `<div style="font-family:Arial,sans-serif;max-width:600px;padding:20px;border:1px solid #ddd;border-radius:10px;"><h2 style="color:#2ecc71;">Resumen del Día de Hoy</h2><p>Hola <strong>${jugador.nombre}</strong>,</p><p>La fecha de hoy (${today}) ha concluido.</p><ul><li>Tus Puntos Totales: <strong>${jugador.puntos}</strong> pts</li><li>Tus Aciertos Exactos: <strong>${jugador.aciertos}</strong></li></ul><h3>🏆 Top 3 Ranking:</h3><ol><li>🥇 ${top1}</li><li>🥈 ${top2}</li><li>🥉 ${top3}</li></ol><p>¡Ingresa mañana!</p><br/><p>Atentamente,<br/>Equipo BASETEK.</p></div>`;
      try { MailApp.sendEmail({ to: jugador.correo, subject, htmlBody }); } catch(e) {}
    }
  });
}
