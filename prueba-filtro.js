// prueba-filtro.js — comprueba que SOLO se guardan los grupos de la lista
// blanca, y que nada entra sin una llave confiable.
//
// OJO: esta prueba usa su PROPIA base, en el temporal del sistema. Antes
// borraba mensajes.sqlite de producción al empezar y al terminar — correrla
// con la bitácora ya llena se la llevaba entera.
import { abrirDb } from './db.js';
import { procesar, cuerpoDe } from './procesar.js';
import { unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RUTA = join(tmpdir(), `prueba-filtro-${process.pid}.sqlite`);
const limpiar = () => { for (const f of [RUTA, RUTA + '-wal', RUTA + '-shm']) if (existsSync(f)) unlinkSync(f); };
limpiar();

const db = abrirDb(RUTA);
const escuchados = new Map([['120363@g.us', 'Tours MHV/MaxiTravel']]);

// Mensaje con llave del bundle VIEJO (trae _serialized).
const msg = (o) => ({
  id: { _serialized: o.id }, from: o.from, to: o.to ?? 'yo@c.us',
  author: o.author ?? null, timestamp: 1757300000, type: 'chat',
  body: o.body ?? 'texto', hasMedia: false, _data: { note: 'crudo' },
  getContact: async () => ({ pushname: 'Fulano' }),
});

// Mensaje con llave del bundle NUEVO (2026-09): sin _serialized.
const msgNuevo = (o) => ({
  ...msg({ ...o, id: 'ignorado' }),
  id: { fromMe: false, remote: { _serialized: o.from }, id: o.idCorto,
        participant: { _serialized: o.author ?? 'x@c.us' } },
});

const casos = [
  ['grupo escuchado',            msg({ id: 'A', from: '120363@g.us', author: 'x@c.us' }), 'guardado'],
  ['el mismo otra vez',          msg({ id: 'A', from: '120363@g.us', author: 'x@c.us' }), 'duplicado'],
  ['OTRO grupo (no marcado)',    msg({ id: 'B', from: '999999@g.us', author: 'y@c.us' }), 'ignorado'],
  ['DM de un cliente',           msg({ id: 'C', from: '5219581234567@c.us' }),            'ignorado'],
  ['estado / broadcast',         msg({ id: 'D', from: 'status@broadcast' }),              'ignorado'],
  ['saliente al grupo escuchado',msg({ id: 'E', from: 'yo@c.us', to: '120363@g.us' }),    'guardado'],

  // ── bundle nuevo: sin _serialized en la MsgKey ──
  ['bundle nuevo: se guarda igual',
    msgNuevo({ from: '120363@g.us', idCorto: 'F1', author: 'x@c.us' }), 'guardado'],
  ['bundle nuevo: el mismo, deduplicado',
    msgNuevo({ from: '120363@g.us', idCorto: 'F1', author: 'x@c.us' }), 'duplicado'],
  ['bundle nuevo: otro id, otro renglón',
    msgNuevo({ from: '120363@g.us', idCorto: 'F2', author: 'x@c.us' }), 'guardado'],

  // ── sin llave: NO se guarda, y no truena ──
  ['id inservible → sin-llave, no toca disco',
    { ...msg({ id: 'Z', from: '120363@g.us' }), id: { remote: '120363@g.us' } }, 'sin-llave'],
  ['id ausente → sin-llave',
    { ...msg({ id: 'Z', from: '120363@g.us' }), id: undefined }, 'sin-llave'],
];

let fallas = 0;
for (const [nombre, m, esperado] of casos) {
  const got = await procesar(db, escuchados, m);
  const ok = got === esperado;
  if (!ok) fallas++;
  console.log(`${ok ? 'OK  ' : 'FALLA'} ${nombre.padEnd(42)} → ${got} (esperado ${esperado})`);
}

const filas = db.prepare('SELECT id FROM mensajes ORDER BY id').all().map(r => r.id);
const esperadas = [
  'A', 'E',
  'false_120363@g.us_F1_x@c.us',
  'false_120363@g.us_F2_x@c.us',
].sort();
const okFilas = JSON.stringify(filas) === JSON.stringify(esperadas);
console.log(`\nEn disco quedaron ${filas.length}:`);
for (const f of filas) console.log(`   ${f}`);
console.log(okFilas ? 'OK   son exactamente las esperadas' : `FALLA esperaba [${esperadas}]`);
if (!okFilas) fallas++;

const nulos = db.prepare('SELECT COUNT(*) c FROM mensajes WHERE id IS NULL').get().c;
console.log(`${nulos === 0 ? 'OK  ' : 'FALLA'} ningún renglón con id NULL (había ${nulos})`);
if (nulos !== 0) fallas++;

const crudo = db.prepare("SELECT crudo, fecha_mx FROM mensajes WHERE id='A'").get();
console.log(`Crudo guardado: ${crudo.crudo}  |  fecha_mx: ${crudo.fecha_mx}`);

// Ubicación: el body es la miniatura en base64; debe salir el link al mapa.
const ubic = cuerpoDe({ type: 'location', body: '/9j/4AAQSkZJRg', _data: { lat: 15.7775, lng: -96.125, loc: '' } });
const okUbic = ubic === '📍 https://maps.google.com/?q=15.7775,-96.125';
console.log(`${okUbic ? 'OK  ' : 'FALLA'} ubicación → ${ubic}`);
if (!okUbic) fallas++;

limpiar();
console.log(fallas === 0 ? '\n✅ Todo pasó.' : `\n❌ ${fallas} falla(s).`);
process.exit(fallas === 0 ? 0 : 1);
