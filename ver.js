// ver.js — mirilla al almacén crudo. node ver.js [n]
import { abrirDb } from './db.js';
const n = Number(process.argv[2] || 30);
const db = abrirDb();
const { c } = db.prepare('SELECT COUNT(*) c FROM mensajes').get();
console.log(`${c} mensajes en la base.\n`);
for (const g of db.prepare('SELECT grupo_nombre, COUNT(*) n, MIN(fecha_mx) desde, MAX(fecha_mx) hasta FROM mensajes GROUP BY grupo_id').all())
  console.log(`  ${g.grupo_nombre}: ${g.n}  (${g.desde} → ${g.hasta})`);
console.log(`\nÚltimos ${n}:\n`);
for (const m of db.prepare('SELECT * FROM mensajes ORDER BY ts DESC LIMIT ?').all(n).reverse())
  console.log(`${m.fecha_mx}  ${(m.autor_nombre || m.autor_id || '?').slice(0,18).padEnd(18)} ${(m.cuerpo || `«${m.tipo}»`).replace(/\s+/g,' ').slice(0,80)}`);
