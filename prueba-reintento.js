// prueba-reintento.js — comprueba el arranque tolerante sin tocar WhatsApp.
import { arrancar, esTransitorio } from './arrancar.js';

// El error TAL CUAL salió en la pantalla de René.
const errorReal = () => Object.assign(
  new Error('Protocol error (Runtime.callFunctionOn): Execution context was destroyed.'),
  { name: 'ProtocolError' }
);

let fallas = 0;
const check = (nombre, ok, extra = '') => {
  if (!ok) fallas++;
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${extra ? '  — ' + extra : ''}`);
};

const silencio = () => {};
const sinEspera = async () => {};

// --- 1. Se cae 2 veces con el error real y a la tercera arranca --------------
{
  let creados = 0, preparados = 0;
  const crear = () => {
    creados++;
    return { initialize: async () => { if (creados <= 2) throw errorReal(); }, destroy: async () => {} };
  };
  const c = await arrancar(() => preparados++, { crear, log: silencio, dormir: sinEspera });
  check('reintenta y arranca al 3er intento', creados === 3 && !!c, `navegadores creados: ${creados}`);
  check('los listeners se enganchan en CADA intento', preparados === 3, `preparar() corrió ${preparados} veces`);
}

// --- 2. Cada reintento usa un navegador NUEVO y destruye el anterior ---------
{
  let destruidos = 0, creados = 0;
  const crear = () => { creados++; return { initialize: async () => { if (creados <= 2) throw errorReal(); }, destroy: async () => { destruidos++; } }; };
  await arrancar(silencio, { crear, log: silencio, dormir: sinEspera });
  check('destruye el navegador caído antes de reintentar', destruidos === 2, `destroy() ${destruidos} veces`);
}

// --- 3. Un error QUE NO ES transitorio no se reintenta -----------------------
{
  let creados = 0;
  const crear = () => { creados++; return { initialize: async () => { throw new Error('Credenciales inválidas'); }, destroy: async () => {} }; };
  let tiro = null;
  try { await arrancar(silencio, { crear, log: silencio, dormir: sinEspera }); } catch (e) { tiro = e; }
  check('NO reintenta un error real (credenciales)', creados === 1 && tiro?.message === 'Credenciales inválidas', `intentos: ${creados}`);
}

// --- 4. Si se acaban los intentos, truena de verdad (no se queda callado) ----
{
  let creados = 0;
  const crear = () => { creados++; return { initialize: async () => { throw errorReal(); }, destroy: async () => {} }; };
  let tiro = null;
  try { await arrancar(silencio, { crear, intentos: 3, log: silencio, dormir: sinEspera }); } catch (e) { tiro = e; }
  check('agota los intentos y propaga el error', creados === 3 && tiro !== null, `intentos: ${creados}`);
}

// --- 5. Si un destroy revienta, no tumba el reintento ------------------------
{
  let creados = 0;
  const crear = () => { creados++; return { initialize: async () => { if (creados === 1) throw errorReal(); }, destroy: async () => { throw new Error('navegador ya muerto'); } }; };
  let tiro = null;
  try { await arrancar(silencio, { crear, log: silencio, dormir: sinEspera }); } catch (e) { tiro = e; }
  check('un destroy() que revienta no tumba el reintento', creados === 2 && tiro === null);
}

// --- 6. Clasificación de errores --------------------------------------------
check('clasifica el ProtocolError como transitorio', esTransitorio(errorReal()));
check('clasifica "auth timeout" (string pelón) como transitorio', esTransitorio('auth timeout'));
check('NO clasifica un error normal como transitorio', !esTransitorio(new Error('archivo no encontrado')));


// ── matarHuerfanos: solo el Chrome PRINCIPAL de NUESTRA sesión con padre = 1 ──
{
  const { matarHuerfanos } = await import('./arrancar.js');
  const S = new URL('./sesion/', import.meta.url).pathname;
  const C = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const ps = () => [
    `  101     1 ${C} --user-data-dir=${S}session-maxi-lector --headless=new`,  // huérfano → sí
    `  102  5000 ${C} --user-data-dir=${S}session-maxi-lector --headless=new`,  // padre vivo → no
    `  103     1 ${C} Helper --type=gpu-process --user-data-dir=${S}x`,         // helper → no
    `  104     1 ${C} --user-data-dir=/Users/otro/perfil`,                      // otro perfil → no
    `  105     1 /usr/bin/algo`,                                                 // no es Chrome → no
  ].join('\n');
  const matados = [];
  const r = matarHuerfanos(ps, pid => matados.push(pid));
  const ok = JSON.stringify(r) === '[101]' && JSON.stringify(matados) === '[101]';
  console.log(`${ok ? 'OK  ' : 'FALLA'} matarHuerfanos mata solo el 101 → ${JSON.stringify(matados)}`);
  if (!ok) fallas++;
}

console.log(fallas === 0 ? '\n✅ Todo pasó.' : `\n❌ ${fallas} falla(s).`);
process.exit(fallas === 0 ? 0 : 1);

