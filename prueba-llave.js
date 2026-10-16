// prueba-llave.js — la llave del mensaje debe salir igual en el bundle viejo y
// en el nuevo, y debe negarse a inventar una cuando no hay datos.
import { llaveDeMensaje } from './llave.js';

// ── PATRÓN DE ORO ──
// Capturado en vivo del grupo TOURS MHV / MaxiTravel el 2026-09-08. Es la
// MsgKey tal cual la entrega el bundle nuevo, y ORO es lo que devolvió el
// String(id) de verdad de WhatsApp. Si nuestra llave no coincide con eso,
// estaríamos guardando con una llave que no es la del mensaje.
const REAL = {
  fromMe: false,
  remote: { server: 'g.us', user: '120363000000000000', _serialized: '120363000000000000@g.us' },
  id: '2A34B6FFC067C9C717A4',
  participant: { server: 'c.us', user: '5210000000000', _serialized: '5210000000000@c.us' },
  $1: 'false_120363000000000000@g.us_2A34B6FFC067C9C717A4_5210000000000@c.us',
};
const ORO = 'false_120363000000000000@g.us_2A34B6FFC067C9C717A4_5210000000000@c.us';

const casos = [
  ['bundle nuevo: el caso real que nos tumbó', REAL, ORO],
  ['bundle viejo: _serialized manda',
    { _serialized: 'true_123@g.us_ABC_456@c.us', fromMe: true, remote: 'zzz@g.us', id: 'NO' },
    'true_123@g.us_ABC_456@c.us'],
  ['DM (sin participante): 3 partes',
    { fromMe: false, remote: { _serialized: '5219581234567@c.us' }, id: 'ABC123' },
    'false_5219581234567@c.us_ABC123'],
  ['saliente mío al grupo',
    { fromMe: true, remote: { _serialized: '120363@g.us' }, id: 'DEF', participant: { _serialized: 'yo@c.us' } },
    'true_120363@g.us_DEF_yo@c.us'],
  ['Wids que ya vienen como string',
    { fromMe: false, remote: '120363@g.us', id: 'GHI', participant: 'x@c.us' },
    'false_120363@g.us_GHI_x@c.us'],
  ['la llave ya serializada pasa tal cual', 'false_1@g.us_X_2@c.us', 'false_1@g.us_X_2@c.us'],

  // ── se tiene que NEGAR: null, no inventar ──
  ['sin fromMe → null (dos mensajes podrían chocar)',
    { remote: { _serialized: '120363@g.us' }, id: 'JKL', participant: { _serialized: 'x@c.us' } }, null],
  ['sin remote → null', { fromMe: false, id: 'MNO' }, null],
  ['sin id propio → null', { fromMe: false, remote: { _serialized: '120363@g.us' } }, null],
  ['_serialized vacío no cuenta, arma con los nombrados',
    { _serialized: '', fromMe: false, remote: '1@g.us', id: 'X' }, 'false_1@g.us_X'],
  ['objeto vacío → null', {}, null],
  ['undefined → null', undefined, null],
  ['null → null', null, null],
  ['string vacío → null', '', null],
];

let fallas = 0;
for (const [nombre, entrada, esperado] of casos) {
  const got = llaveDeMensaje(entrada);
  const ok = got === esperado;
  if (!ok) fallas++;
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre.padEnd(48)} → ${JSON.stringify(got)}`);
}

// Guardia extra: NUNCA leer el campo minificado.
const src = (await import('node:fs')).readFileSync(new URL('./llave.js', import.meta.url).pathname, 'utf8');
const usaMinificado = /id\.\$1|\['\$1'\]|\["\$1"\]/.test(src.replace(/\/\/.*$/gm, ''));
console.log(`${!usaMinificado ? 'OK   ' : 'FALLA'} llave.js no lee el campo minificado $1`);
if (usaMinificado) fallas++;

console.log(fallas === 0 ? '\n✅ Todo pasó.' : `\n❌ ${fallas} falla(s).`);
process.exit(fallas === 0 ? 0 : 1);
