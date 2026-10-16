// prueba-disparo.js — un «#contrato» no se pierde aunque el vigilante se reinicie.
import { DatabaseSync } from 'node:sqlite';
import { rmSync } from 'node:fs';
import { pendientes, marcarEnviados, esDisparoNavio } from './disparo.js';

const RUTA = '/tmp/whats-lector-prueba-enviados.json';
rmSync(RUTA, { force: true });
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE mensajes (id TEXT PRIMARY KEY, grupo_id TEXT, ts INTEGER, tipo TEXT, cuerpo TEXT)');
const ahora = 1_800_000_000;
const ins = db.prepare('INSERT INTO mensajes VALUES (?, ?, ?, ?, ?)');
ins.run('a', 'navio1', ahora - 60, 'chat', '#contrato');
ins.run('b', 'navio1', ahora - 30, 'chat', 'ya mandé todo #Contrato');
ins.run('c', 'navio2', ahora - 3 * 86400, 'chat', '#contrato');     // viejo: no
ins.run('d', 'otro', ahora - 60, 'chat', '#contrato');              // no es grupo Navío
ins.run('e', 'navio2', ahora - 60, 'chat', 'el #contratox no');     // no es la palabra
ins.run('f', 'navio2', ahora - 60, 'image', '#contrato');           // pie de foto: no
const navio = new Set(['navio1', 'navio2']);

let fallas = 0;
const check = (n, ok, extra = '') => { if (!ok) fallas++; console.log(`${ok ? 'OK   ' : 'FALLA'} ${n}${extra ? '  — ' + extra : ''}`); };
const ids = (...a) => pendientes(db, navio, RUTA, ...a).map(m => m.id).sort().join(',');

check('reconoce la palabra', esDisparoNavio('#contrato') && esDisparoNavio('listo #CONTRATO') && !esDisparoNavio('contrato') && !esDisparoNavio(null));
check('tras un «reinicio» los dos de navio1 siguen pendientes', ids(null, ahora) === 'a,b', ids(null, ahora));
check('filtra por grupo', ids('navio2', ahora) === '');
marcarEnviados(RUTA, ['a'], 'ses-1');
check('marcado no vuelve a salir', ids(null, ahora) === 'b', ids(null, ahora));
marcarEnviados(RUTA, ['b'], 'ses-1');
check('todo mandado: nada pendiente', ids(null, ahora) === '');
rmSync(RUTA, { force: true });
console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
process.exit(fallas ? 1 : 0);
