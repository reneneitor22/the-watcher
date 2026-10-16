// disparo.js — qué «#contrato» de los grupos Navío falta mandar a Navío.
//
// El pendiente vive en disco, no en un temporizador: el vigilante se reinicia seguido (detached
// Frame, barrido, cada 6 h) y un reinicio a media espera o a media subida perdía el expediente
// sin aviso — al volver, el mensaje ya era «duplicado» y no disparaba. Un «#contrato» se marca
// enviado SOLO cuando Navío confirmó la sesión; lo que no, se vuelve a intentar al arrancar.

import { readFileSync, writeFileSync, renameSync } from 'node:fs';

export const esDisparoNavio = texto => /(^|\s)#contrato\b/i.test(texto || '');
const VENTANA_S = 24 * 3600;   // uno más viejo ya no se manda solo (el historial al marcar un grupo viejo)

export function leerEnviados(ruta) {
  try { return JSON.parse(readFileSync(ruta, 'utf8')); } catch { return {}; }
}

export function marcarEnviados(ruta, ids, sesion) {
  const env = leerEnviados(ruta);
  for (const id of ids) env[id] = { sesion, en: new Date().toISOString() };
  writeFileSync(`${ruta}.tmp`, JSON.stringify(env, null, 2) + '\n');
  renameSync(`${ruta}.tmp`, ruta);
}

// ids de «#contrato» sin mandar del grupo (o de todos los grupos Navío si no se da grupo)
export function pendientes(db, gruposNavio, ruta, grupoId = null, ahora = Date.now() / 1000) {
  const env = leerEnviados(ruta);
  return db.prepare(`SELECT id, grupo_id, cuerpo FROM mensajes WHERE tipo = 'chat' AND ts > ? AND cuerpo LIKE '%#contrato%'`)
    .all(ahora - VENTANA_S)
    .filter(m => gruposNavio.has(m.grupo_id) && (!grupoId || m.grupo_id === grupoId) && !env[m.id] && esDisparoNavio(m.cuerpo));
}
