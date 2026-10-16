// procesar.js — decide si un mensaje se guarda y lo normaliza.
// Aparte de escuchar.js para poder probarlo sin sesión de WhatsApp.

import { guardar, fechaMx } from './db.js';
import { llaveDeMensaje } from './llave.js';

/**
 * @param escuchados Map<grupoId, nombre> — la lista blanca. Lo que no esté
 *   aquí (DMs, grupos ajenos, estados) NO toca disco.
 * @returns {'guardado'|'duplicado'|'ignorado'|'sin-llave'}
 */
export async function procesar(db, escuchados, msg) {
  const grupoId = msg.from?.endsWith('@g.us') ? msg.from
                : msg.to?.endsWith('@g.us')   ? msg.to
                : null;
  if (!grupoId || !escuchados.has(grupoId)) return 'ignorado';

  // Sin llave confiable NO se guarda. Ver llave.js: guardar con id NULL
  // rompe la deduplicación en silencio.
  const llave = llaveDeMensaje(msg.id);
  if (!llave) return 'sin-llave';

  let autorNombre = null;
  try {
    const c = await msg.getContact?.();
    autorNombre = c?.name || c?.pushname || c?.number || null;
  } catch { /* el contacto no siempre resuelve; el id crudo basta */ }

  const nuevo = guardar(db, {
    id: llave,
    grupo_id: grupoId,
    grupo_nombre: escuchados.get(grupoId),
    autor_id: msg.author || msg.from,
    autor_nombre: autorNombre,
    ts: msg.timestamp,
    fecha_mx: fechaMx(msg.timestamp),
    tipo: msg.type,
    cuerpo: cuerpoDe(msg),
    tiene_media: msg.hasMedia,
    citado_id: msg._data?.quotedStanzaID || null,
    crudo: JSON.stringify(msg._data ?? {}),
  });

  return nuevo ? 'guardado' : 'duplicado';
}

// En una ubicación, `body` NO es texto: es la miniatura del mapa en base64
// (visto el 2026-09-20). Las coordenadas vienen en _data.lat/lng. Se exporta
// para re-derivar el cuerpo de filas viejas desde `crudo`.
export function cuerpoDe(msg) {
  const d = msg._data ?? {};
  if (msg.type === 'location' && d.lat != null && d.lng != null) {
    const lugar = (d.loc || '').replace(/\s+/g, ' ').trim();
    return `📍 ${lugar ? lugar + ' — ' : ''}https://maps.google.com/?q=${d.lat},${d.lng}`;
  }
  return msg.body || null;
}
