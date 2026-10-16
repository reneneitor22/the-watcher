// historial.js — baja los mensajes viejos de un grupo LEYENDO EL STORE A PELO.
//
// Por qué no `cliente.getChatById()` + `chat.fetchMessages()`: getChatById
// pasa por `window.WWebJS.getChatModel` (Utils.js:938), y ahí el bloque
// `lastMessage` (Utils.js:982) hace
//     Msg.getMessagesById([chat.lastReceivedKey._serialized])
// En el bundle de 2026-09 las MsgKey YA NO traen `_serialized`, así que le
// pide a IndexedDB una llave vacía y truena con
//     DataError: Failed to execute 'get' on 'IDBObjectStore'
// El error viaja minificado por pupPage.evaluate y llega a Node como `r: r`.
// Es la misma razón por la que `getChats()` se llevó el inventario y por la
// que existe inventario.js. La regla del proyecto: nada que pase por
// getChatModel.
//
// `loadEarlierMsgs` sí es seguro: recibe el chat crudo y no serializa nada.
// Es lo mismo que usa la librería por dentro (structures/Chat.js:227).

// Tipos que NO son mensajes de gente: avisos del sistema y de grupo. Se
// GUARDAN igual (crudo primero), pero el parser de la bitácora los salta.
// `gp2` es el aviso de grupo; su `subtype` dice qué pasó (add, remove,
// subject, …). El que ya está en la base es un gp2/add: el número lector
// entrando al grupo el 2026-09-07.
export const TIPOS_AVISO = new Set([
  'gp2', 'notification', 'notification_template', 'e2e_notification',
  'call_log', 'protocol', 'broadcast_notification', 'newsletter_notification',
]);

/**
 * @returns {Promise<{mensajes: Array, vueltas: number, error?: string}>}
 *   Los mensajes salen con la forma que espera procesar.js (id, from, to,
 *   author, timestamp, type, body, hasMedia, _data), de viejo a nuevo.
 */
export async function bajarHistorial(cliente, grupoId, limite) {
  return await cliente.pupPage.evaluate(async (id, limite) => {
    const chat = window.require('WAWebCollections').Chat.get(id);
    if (!chat) return { mensajes: [], vueltas: 0, error: 'el grupo no está en el store' };

    // NO se filtra nada aquí. Regla #2 del proyecto: crudo primero.
    //
    // La librería filtra con `m.isNotification` (structures/Chat.js:207), pero
    // esa propiedad NO existe en el modelo crudo del store — comprobado el
    // 2026-09-08: el gp2 del grupo trae `isNotification: undefined`, así que
    // `!m.isNotification` es siempre true y el filtro nunca tiró nada. Un
    // filtro que no filtra es peor que no tenerlo: da confianza falsa.
    //
    // Además un aviso de grupo NO se vuelve a bajar nunca. Se guarda todo y el
    // parser salta lo que no sea bitácora mirando la columna `tipo`
    // (ver TIPOS_AVISO abajo).
    let msgs = chat.msgs.getModelsArray();
    let vueltas = 0;

    // Tope de vueltas: si el servidor deja de dar, `loadEarlierMsgs` devuelve
    // vacío y se corta sola. El tope es solo para no colgarse si algún día
    // devuelve algo sin avanzar.
    while (msgs.length < limite && vueltas < 40) {
      vueltas++;
      let cargados;
      try {
        cargados = await window.require('WAWebChatLoadMessages').loadEarlierMsgs({ chat });
      } catch (e) {
        return { mensajes: [], vueltas, error: `loadEarlierMsgs: ${e?.name}: ${e?.message}` };
      }
      if (!cargados || !cargados.length) break;
      msgs = [...cargados, ...msgs];
    }

    msgs.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
    if (msgs.length > limite) msgs = msgs.slice(-limite);

    const texto = (w) => (w == null ? null : String(w));
    const MEDIA = ['image', 'video', 'audio', 'ptt', 'document', 'sticker'];

    const mensajes = msgs.map((m) => {
      let crudo;
      try { crudo = JSON.parse(JSON.stringify(m.serialize())); }
      catch (e) { crudo = { _no_serializable: `${e?.name}: ${e?.message}`, type: m.type, t: m.t }; }
      return {
        // String(MsgKey) usa el toString() del prototipo: existe en los dos
        // bundles. Nunca el campo `$1`, que es nombre del minificador.
        id: String(m.id),
        from: texto(m.from),
        to: texto(m.to),
        author: texto(m.author),
        timestamp: m.t,
        type: m.type,
        body: m.body ?? m.caption ?? null,
        hasMedia: MEDIA.includes(m.type) || !!m.mediaKey || !!m.deprecatedMms3Url,
        _data: crudo,
      };
    });

    return { mensajes, vueltas };
  }, grupoId, limite);
}
