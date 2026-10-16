// arrancar.js — arranque tolerante a la carrera de whatsapp-web.js.
//
// Por qué existe: `Client.inject()` hace dos `pupPage.evaluate()` seguidos
// (Client.js:144 y :146) sin protección. Si WhatsApp Web se recarga entre uno
// y otro, Chrome destruye el contexto y sale un
//   ProtocolError: Execution context was destroyed
// que la librería NO atrapa, así que mata el proceso. Es intermitente: en 11
// corridas de prueba no se reprodujo ni una vez, pero a René le tocó al primer
// intento. Se investigó y se descartaron caché fría y perfil compartido (ese
// último da otro error, "The browser is already running").
//
// Como el fallo es transitorio y de un tercero, aquí se reintenta con un
// navegador nuevo. Los errores que NO son transitorios (credenciales, sesión
// cerrada) se dejan pasar tal cual: reintentarlos solo esconde el problema.

import { crearCliente } from './cliente.js';
import { execFileSync } from 'node:child_process';

const SESION = new URL('./sesion/', import.meta.url).pathname;

/**
 * Si node muere de golpe (kill -9, OOM, crash nativo) su Chrome NO muere: queda
 * huérfano, colgado de launchd (ppid 1), con el perfil tomado — y cada
 * reintento sale con «The browser is already running». Visto el 2026-09-21 al
 * probar el supervisor. Se matan SOLO los Chrome principales de nuestra sesión
 * cuyo padre ya es el pid 1; uno con padre vivo es de otra corrida y no se toca.
 */
export function matarHuerfanos(
  ps = () => execFileSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' }),
  matar = pid => process.kill(pid, 'SIGTERM'),
) {
  const muertos = [];
  for (const linea of ps().split('\n')) {
    const m = linea.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!m || m[2] !== '1') continue;
    const cmd = m[3];
    if (!cmd.includes('Google Chrome') || cmd.includes('--type=') || !cmd.includes(`--user-data-dir=${SESION}`)) continue;
    try { matar(Number(m[1])); muertos.push(Number(m[1])); } catch {}
  }
  return muertos;
}

const TRANSITORIOS = [
  'Execution context was destroyed',
  'Protocol error',
  'Target closed',
  'Session closed',
  'Navigating frame was detached',
  'detached Frame',
  'auth timeout',
];

export function esTransitorio(err) {
  const txt = typeof err === 'string' ? err : (err?.message ?? String(err));
  return TRANSITORIOS.some(t => txt.includes(t));
}

async function destruirCallado(cliente) {
  try { await cliente?.destroy(); } catch { /* si el navegador ya murió, da igual */ }
}

/**
 * @param preparar (cliente) => void — engancha aquí los listeners; corre ANTES
 *   de cada initialize(), así que en un reintento se enganchan al cliente nuevo.
 * @returns el cliente ya inicializado.
 */
export async function arrancar(preparar, opciones = {}) {
  const {
    crear = crearCliente,
    intentos = 4,
    esperaMs = 4000,
    log = console.log,
    dormir = ms => new Promise(r => setTimeout(r, ms)),
  } = opciones;

  if (!opciones.crear) {
    const muertos = matarHuerfanos();
    if (muertos.length) {
      log(`🧹 Chrome huérfano de una corrida anterior (pid ${muertos.join(', ')}). Cerrado.`);
      await dormir(2000); // que suelte el perfil
    }
  }

  let ultimo;
  for (let intento = 1; intento <= intentos; intento++) {
    const cliente = crear();
    preparar(cliente);
    try {
      await cliente.initialize();
      return cliente;
    } catch (err) {
      ultimo = err;
      await destruirCallado(cliente);

      if (!esTransitorio(err)) throw err;
      if (intento === intentos) {
        log(`\n❌ ${intentos} intentos y no arrancó. Último error:\n   ${(err?.message ?? err).toString().split('\n')[0]}`);
        throw err;
      }

      const espera = esperaMs * intento;
      log(`⚠️  Intento ${intento}/${intentos} se cayó por una carrera de WhatsApp Web. Reintento en ${espera / 1000}s…`);
      await dormir(espera);
    }
  }
  throw ultimo;
}

/**
 * Cierra el navegador ORDENADAMENTE. Importa más de lo que parece: si Node se
 * muere con una excepción sin atrapar, Chrome se va con él y puede quedarse sin
 * escribir a disco las llaves de la vinculación — y entonces hay que volver a
 * escanear el QR. Pasó el 2026-09-07.
 */
export async function cerrarLimpio(cliente, ms = 3000) {
  try {
    // Un respiro para que Chrome vacíe IndexedDB antes de cerrarlo.
    await new Promise(r => setTimeout(r, ms));
    await cliente?.destroy();
  } catch { /* si ya estaba muerto, ni modo */ }
}

/**
 * Red de seguridad: cualquier error que se escape cierra el navegador bien
 * antes de salir, en vez de arrastrar la sesión al panteón.
 */
export function redDeSeguridad(dameCliente) {
  const salir = async (etiqueta, err) => {
    console.error(`\n💥 ${etiqueta}: ${(err?.message ?? err ?? '').toString().split('\n')[0]}`);
    // El volcado completo NO es adorno. Los errores del bundle de WhatsApp
    // llegan minificados a una letra (`r: r`) y el mensaje solo no dice nada:
    // el 2026-09-07 costó una corrida entera de diagnóstico averiguar que
    // debajo venía un DataError de IndexedDB. Nombre, tipo y stack, siempre.
    if (err && typeof err === 'object') {
      console.error(`   nombre : ${err.name ?? '(sin nombre)'}`);
      console.error(`   tipo   : ${err.constructor?.name ?? '?'}`);
      console.error(`   stack  : ${(err.stack ?? '(sin stack)').split('\n').slice(0, 8).join('\n            ')}`);
    } else {
      console.error(`   valor crudo: ${JSON.stringify(err)}`);
    }
    console.error('   Cerrando bien para no perder la sesión…');
    await cerrarLimpio(dameCliente());
    console.error('   Cerrado. La sesión debería seguir buena.');
    process.exit(1);
  };
  process.on('uncaughtException', e => { salir('Error sin atrapar', e); });
  process.on('unhandledRejection', e => { salir('Promesa sin atrapar', e); });
}
