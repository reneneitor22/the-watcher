// llave.js — saca la llave única de un mensaje, sea cual sea la versión del
// bundle de WhatsApp.
//
// Por qué existe: hasta cierta versión, las MsgKey traían `_serialized`. En el
// bundle de 2026-09 YA NO. Ahí la llave serializada vive en un campo `$1`
// (2026-09-08). NO se lee `$1`: ese nombre lo inventa el minificador y cambia
// en cuanto Meta recompila. Aquí se arma la llave con los campos NOMBRADOS
// (fromMe, remote, id, participant), que son los que sobreviven.
//
// Importa más de lo que parece: la llave es la PRIMARY KEY de la tabla, y
// SQLite acepta NULLs repetidos en un TEXT PRIMARY KEY. Si esto devuelve null
// y alguien lo guarda igual, el INSERT OR IGNORE deja de deduplicar y la
// bitácora se llena de repetidos SIN UN SOLO ERROR.

/** Un Wid puede venir como objeto {_serialized} o ya como string. */
function texto(wid) {
  if (typeof wid === 'string') return wid || null;
  if (wid && typeof wid._serialized === 'string' && wid._serialized) return wid._serialized;
  return null;
}

/**
 * @param id el `id` del mensaje (MsgKey del bundle, o un objeto plano).
 * @returns {string|null} la llave, o null si no se puede armar una confiable.
 */
export function llaveDeMensaje(id) {
  if (typeof id === 'string') return id || null;
  if (!id || typeof id !== 'object') return null;

  // Bundle viejo: si trae _serialized, esa es y ya.
  if (typeof id._serialized === 'string' && id._serialized) return id._serialized;

  // Bundle nuevo: armarla a mano con campos nombrados.
  const remoto = texto(id.remote);
  const propio = typeof id.id === 'string' && id.id ? id.id : null;
  if (!remoto || !propio) return null;

  // fromMe tiene que ser booleano de verdad: si viene undefined y lo
  // asumiéramos, dos mensajes distintos podrían compartir llave.
  if (id.fromMe !== true && id.fromMe !== false) return null;

  const participante = texto(id.participant);
  return participante
    ? `${id.fromMe}_${remoto}_${propio}_${participante}`
    : `${id.fromMe}_${remoto}_${propio}`;
}
