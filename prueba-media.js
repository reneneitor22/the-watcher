// prueba-media.js — baja de verdad los últimos adjuntos guardados (fotos, audio) con media.js
// y comprueba que el archivo sale entero (peso y firma de bytes). Con el supervisor PARADO:
//   ./supervisor.sh quitar && node prueba-media.js && ./supervisor.sh instalar
// Escribe en media/_prueba/ y lo borra al final.

import { rmSync, readFileSync, statSync } from 'node:fs';
import { arrancar, cerrarLimpio, redDeSeguridad } from './arrancar.js';
import { abrirDb } from './db.js';
import { bajarMedia, DIR_MEDIA } from './media.js';

const FIRMAS = { 'image/jpeg': [0xff, 0xd8, 0xff], 'application/pdf': [0x25, 0x50, 0x44, 0x46], 'audio/ogg; codecs=opus': [0x4f, 0x67, 0x67, 0x53] };
const filas = abrirDb().prepare(
  `SELECT * FROM mensajes WHERE tiene_media = 1 AND tipo IN ('image','document','audio','ptt') ORDER BY ts DESC LIMIT 4`).all();

let cliente = null;
redDeSeguridad(() => cliente);
cliente = await arrancar(() => {});
await new Promise(r => setTimeout(r, 8000));   // que el store sincronice

let mal = 0;
for (const f of filas) {
  const d = JSON.parse(f.crudo);
  try {
    const ruta = await bajarMedia(cliente, '_prueba', f.id, f.ts, { type: f.tipo, ...d });
    const buf = readFileSync(ruta);
    const firma = FIRMAS[d.mimetype];
    const okPeso = !d.size || statSync(ruta).size === d.size;
    const okFirma = !firma || firma.every((b, i) => buf[i] === b);
    if (!okPeso || !okFirma) mal++;
    console.log(`${okPeso && okFirma ? '✅' : '❌'} ${f.tipo.padEnd(6)} ${f.grupo_nombre.slice(0, 22).padEnd(22)} ${buf.length} B (esperado ${d.size}) firma ${okFirma ? 'ok' : 'MAL'}`);
  } catch (e) {
    mal++;
    console.log(`❌ ${f.tipo.padEnd(6)} ${f.grupo_nombre.slice(0, 22).padEnd(22)} ${e.message}`);
  }
}
rmSync(DIR_MEDIA + '_prueba', { recursive: true, force: true });
await cerrarLimpio(cliente);
console.log(mal ? `\n${mal} fallaron` : '\nTodos bajaron enteros.');
process.exit(mal ? 1 : 0);
