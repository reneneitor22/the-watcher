// media.js — baja el adjunto de un mensaje a media/<grupo>/.
//
// Solo para grupos con "navio": true en grupos.json (expedientes de contrato).
// No usa msg.downloadMedia() de la librería: pide `id._serialized`, que este
// bundle ya no trae. Es la misma receta (Msg.get + downloadAndMaybeDecrypt),
// pero con la llave de llave.js, que es el toString() de la MsgKey. Y con
// `mimetype`: sin él este bundle truena con InvalidMediaFileType («Unexpected
// mimetype application/octet-stream»), que llega a Node como una letra (2-oct-2026).

import { mkdirSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const DIR_MEDIA = new URL('./media/', import.meta.url).pathname;
const TOPE = 60 * 1024 * 1024;   // ponytail: tope fijo; lo que pase de aquí se avisa y no se baja

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf',
  'video/mp4': 'mp4', 'audio/ogg; codecs=opus': 'ogg', 'audio/mpeg': 'mp3' };

// Nombre seguro y estable: <ts>-<hash de la llave>-<nombre original>. El hash evita que dos
// "IMG.jpg" se pisen y que el mismo mensaje (historial + barrido) se baje dos veces.
export function nombreArchivo(llave, ts, d) {
  const h = hashDe(llave);
  const ext = EXT[d.mimetype] || (d.mimetype || '').split('/')[1]?.split(';')[0] || 'bin';
  const nombre = (d.filename || `${d.type === 'image' ? 'foto' : d.type || 'archivo'}.${ext}`).normalize('NFC').replace(/[\/\\:\0]/g, '_');
  // Recortar sin perder la extensión: "...CAPITAL VARIABLE).docx (2).pdf" se quedaba sin ".pdf".
  const punto = nombre.lastIndexOf('.'), extension = punto > 0 && nombre.length - punto <= 6 ? nombre.slice(punto) : '';
  const base = nombre.length > 120 ? nombre.slice(0, 120 - extension.length) + extension : nombre;
  return `${ts}-${h}-${base}`;
}

export const hashDe = llave => createHash('sha1').update(llave).digest('hex').slice(0, 8);

/** @returns {Promise<string|null>} ruta si lo acaba de bajar, null si ya estaba. Truena con razón legible. */
// WhatsApp avisa cada mensaje dos veces (message + message_create): sin esto, cada adjunto se
// bajaba dos veces a la par (un PDF de 50 MB tarda ~45 s).
const enCurso = new Set();

export async function bajarMedia(cliente, grupoId, llave, ts, d) {
  const dir = `${DIR_MEDIA}${grupoId}/`;
  const ruta = dir + nombreArchivo(llave, ts, d);
  if (existsSync(ruta) || enCurso.has(ruta)) return null;
  enCurso.add(ruta);
  try { return await bajar(cliente, dir, ruta, llave, d); }
  finally { enCurso.delete(ruta); }
}

async function bajar(cliente, dir, ruta, llave, d) {
  if (d.size > TOPE) throw new Error(`pesa ${(d.size / 1048576).toFixed(0)} MB, tope ${TOPE / 1048576} MB`);

  const r = await cliente.pupPage.evaluate(async (id) => {
    const Msg = window.require('WAWebCollections').Msg;
    const msg = Msg.get(id) || (await Msg.getMessagesById([id]))?.messages?.[0];
    if (!msg?.mediaData) return { error: 'el mensaje no está en el store' };
    if (msg.mediaData.mediaStage === 'REUPLOADING') return { error: 'WhatsApp lo está resubiendo (expirado)' };
    if (msg.mediaData.mediaStage !== 'RESOLVED') await msg.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1 });
    if (/ERROR|FETCHING/.test(msg.mediaData.mediaStage)) return { error: `mediaStage ${msg.mediaData.mediaStage}` };
    const qpl = { addAnnotations() { return this; }, addPoint() { return this; } };
    const buf = await window.require('WAWebDownloadManager').downloadManager.downloadAndMaybeDecrypt({
      directPath: msg.directPath, encFilehash: msg.encFilehash, filehash: msg.filehash, mediaKey: msg.mediaKey,
      mediaKeyTimestamp: msg.mediaKeyTimestamp, type: msg.type, mimetype: msg.mimetype, signal: new AbortController().signal, downloadQpl: qpl,
    });
    return { b64: await window.WWebJS.arrayBufferToBase64Async(buf) };
  }, llave);

  if (r.error) throw new Error(r.error);
  mkdirSync(dir, { recursive: true });
  // atómico: navio.js lee esta carpeta y un PDF de 50 MB a medio escribir se mandaba cortado
  writeFileSync(`${ruta}.tmp`, Buffer.from(r.b64, 'base64'));
  renameSync(`${ruta}.tmp`, ruta);
  return ruta;
}
