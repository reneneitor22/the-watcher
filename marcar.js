// marcar.js — marca grupos para escuchar sin editar JSON a mano.
//   node marcar.js "Tours MHV"      → marca el que coincida
//   node marcar.js --quitar "Tours MHV"
//   node marcar.js --navio "Expediente"   → además baja sus adjuntos (ver navio.js)
//
// Exige coincidencia ÚNICA. Si el texto pega con varios grupos no adivina:
// los enseña y se sale. Marcar el grupo equivocado significa guardar
// conversaciones que no nos tocan.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const ARCHIVO = new URL('./grupos.json', import.meta.url).pathname;
if (!existsSync(ARCHIVO)) { console.error('❌ No hay grupos.json. Corre: node vincular.js'); process.exit(1); }

const args = process.argv.slice(2);
const quitar = args.includes('--quitar');
const navio = args.includes('--navio');
const busca = args.filter(a => a !== '--quitar' && a !== '--navio').join(' ').trim().toLowerCase();
if (!busca) { console.error('Uso: node marcar.js [--quitar] "parte del nombre"'); process.exit(1); }

const grupos = JSON.parse(readFileSync(ARCHIVO, 'utf8'));
const hits = grupos.filter(g => g.nombre.toLowerCase().includes(busca));

if (hits.length === 0) {
  console.error(`❌ Ningún grupo contiene «${busca}». Los que hay:`);
  for (const g of grupos) console.error(`   ${g.nombre}`);
  process.exit(1);
}
if (hits.length > 1) {
  console.error(`❌ «${busca}» pega con ${hits.length} grupos. Sé más específico:`);
  for (const g of hits) console.error(`   ${g.nombre}`);
  process.exit(1);
}

hits[0].escuchar = !quitar;
if (navio) hits[0].navio = true;
if (quitar) delete hits[0].navio;
writeFileSync(ARCHIVO, JSON.stringify(grupos, null, 2) + '\n');
console.log(`${quitar ? '⏹  Ya no se escucha' : '▶  Se escuchará'}: ${hits[0].nombre}`);
console.log(`\nGrupos activos: ${grupos.filter(g => g.escuchar).map(g => g.nombre).join(', ') || '(ninguno)'}`);
