// prueba-cierre.js — comprueba que un error sin atrapar CIERRA el navegador
// antes de salir. Esto es lo que perdió la sesión el 2026-09-07.
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const MARCA = '/tmp/whats-lector-prueba-cierre.txt';
const HIJO = '/tmp/whats-lector-hijo.mjs';

writeFileSync(HIJO, `
import { redDeSeguridad } from '${new URL('./arrancar.js', import.meta.url).pathname}';
import { writeFileSync } from 'node:fs';
const clienteFalso = { destroy: async () => { writeFileSync('${MARCA}', 'destroy() SI corrió'); } };
redDeSeguridad(() => clienteFalso);
// el mismo tipo de error que tumbó vincular.js: promesa que revienta tras 'ready'
Promise.reject(new Error('r: r'));
setTimeout(() => {}, 20000);
`);

if (existsSync(MARCA)) unlinkSync(MARCA);

let codigo = 0, salida = '';
try {
  salida = execFileSync('node', [HIJO], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
} catch (e) {
  codigo = e.status;
  salida = (e.stdout ?? '') + (e.stderr ?? '');
}

let fallas = 0;
const check = (n, ok, extra = '') => { if (!ok) fallas++; console.log(`${ok ? 'OK   ' : 'FALLA'} ${n}${extra ? '  — ' + extra : ''}`); };

check('el proceso sale con código 1', codigo === 1, `código ${codigo}`);
check('destroy() SÍ corrió antes de salir', existsSync(MARCA), existsSync(MARCA) ? readFileSync(MARCA, 'utf8') : 'la marca NO se escribió');
check('avisa que está cerrando para no perder la sesión', salida.includes('no perder la sesión'));
check('confirma que la sesión debería seguir buena', salida.includes('debería seguir buena'));
// El error minificado `r: r` no dice nada por sí solo: el volcado tiene que
// traer nombre y stack o el diagnóstico se vuelve a hacer a ciegas.
check('vuelca el nombre del error', salida.includes('nombre :'));
check('vuelca el stack del error', salida.includes('stack  :') && salida.includes('at '));

for (const f of [MARCA, HIJO]) if (existsSync(f)) unlinkSync(f);
console.log(fallas === 0 ? '\n✅ Todo pasó.' : `\n❌ ${fallas} falla(s).`);
process.exit(fallas === 0 ? 0 : 1);
