// escuchar.js — PASO 2.
// Escucha SOLO los grupos marcados con "escuchar": true en grupos.json y
// guarda el mensaje crudo en mensajes.sqlite. Todo lo demás (DMs, otros
// grupos) se ignora sin tocar disco.
//
//   node escuchar.js                 escucha en vivo
//   node escuchar.js --historial 50  además baja los últimos 50 de cada grupo

import { readFileSync, existsSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { arrancar, cerrarLimpio, redDeSeguridad } from './arrancar.js';
import { abrirDb, fechaMx } from './db.js';
import { procesar as procesarMsg } from './procesar.js';
import { bajarHistorial } from './historial.js';
import { listarGrupos } from './inventario.js';
import { esDisparoNavio, pendientes as sinMandar, marcarEnviados } from './disparo.js';

// hora en cada línea del log (sin ella no se puede saber cuánto duró una caída)
for (const n of ['log', 'error']) {
  const o = console[n].bind(console);
  console[n] = (...a) => o(`[${fechaMx(Date.now() / 1000).slice(11, 19)}]`, ...a);
}
import { bajarMedia } from './media.js';
import { llaveDeMensaje } from './llave.js';
import Utils from 'whatsapp-web.js/src/util/Injected/Utils.js';

const ARCHIVO = new URL('./grupos.json', import.meta.url).pathname;

if (!existsSync(ARCHIVO)) {
  console.error('❌ No hay grupos.json. Corre primero: node vincular.js');
  process.exit(1);
}

const todos = JSON.parse(readFileSync(ARCHIVO, 'utf8'));
const escuchados = new Map(todos.filter(g => g.escuchar).map(g => [g.id, g.nombre]));
// Grupos de expediente Navío: aquí sí se bajan los adjuntos (INE, PDFs, .pages…). Ver navio.js.
const conMedia = new Set(todos.filter(g => g.escuchar && g.navio).map(g => g.id));

// Número nuevo (servidor): todavía sin grupos Navío. No se sale: buscarNuevos() los marca al llegar.
if (escuchados.size === 0) console.error('⚠️  Ningún grupo marcado todavía; espero grupos con «Navío» en el nombre.');

const argHist = process.argv.indexOf('--historial');
const HISTORIAL = argHist !== -1 ? Number(process.argv[argHist + 1] || 50) : 0;

const db = abrirDb();
let guardados = 0, ignorados = 0, sinLlave = 0;
let clienteVivo = null;
redDeSeguridad(() => clienteVivo);

// Avisos de sistema (entró alguien, cambió el cifrado…): se guardan, no se avisan.
const RUIDO = /^(gp2|e2e_notification|notification|notification_template|group-history|message_history_notice|protocol|revoked|ciphertext)$/;

// Notificación de macOS. En vivo, una por mensaje; al bajar historial se
// juntan por grupo y salen al final (si no, un arranque tras días apagado
// dispara decenas). Local a esta Mac — nada sale por correo ni por WhatsApp.
// En el servidor Linux no hay avisos de escritorio: los importantes van a René por Telegram
// (TELEGRAM_TOKEN y TELEGRAM_CHAT en .env, el mismo bot de Despiece); sin .env, solo al log.
const MAC = process.platform === 'darwin';
const ENV = new URL('./.env', import.meta.url).pathname;
if (existsSync(ENV)) process.loadEnvFile(ENV);
const pendientes = new Map();
function escritorio(titulo, texto) {
  execFile('osascript', [
    '-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"', '-e', 'end run',
    titulo, texto,
  ], err => err && console.error(`osascript: ${err.message.split('\n')[0]}`));
}
// Lo importante (expediente nuevo, contrato en bandeja, fallas) va a Telegram también en la Mac:
// la notificación de escritorio se pierde si la Mac está bloqueada o sin permiso, y no deja rastro.
function notificar(titulo, texto) {
  if (MAC) escritorio(titulo, texto);
  const { TELEGRAM_TOKEN, TELEGRAM_CHAT } = process.env;
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) return MAC || console.log(`🔔 ${titulo}: ${texto}`);
  fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    body: new URLSearchParams({ chat_id: TELEGRAM_CHAT, text: `${titulo}\n${texto}` }),
    signal: AbortSignal.timeout(15e3),
  }).then(r => r.ok || console.error(`telegram ${r.status}`)).catch(e => console.error('telegram:', e.message));
}
function avisar(grupo, msg, etiqueta) {
  if (!MAC) return;   // en el servidor cada mensaje ya sale en el log; a Telegram solo lo importante
  if (etiqueta) { pendientes.set(grupo, (pendientes.get(grupo) ?? 0) + 1); return; }
  escritorio(`WhatsApp · ${grupo}`, textoDe(msg).slice(0, 150));   // cada mensaje: solo escritorio
}

// Lo que se IMPRIME (no lo que se guarda: eso es cuerpoDe en procesar.js). En media y ubicación
// el body del historial es la miniatura en base64 («/9j/4AAQ…»): se usa el pie o el nombre.
function textoDe(msg) {
  const d = msg._data ?? {};
  const t = msg.type === 'location' ? '📍 ubicación' : msg.hasMedia ? d.caption || d.filename : msg.body;
  return (t || `«${msg.type}»`).replace(/\s+/g, ' ');
}

// Grupos nuevos de Navío: Jorge abre un grupo por contrato y mete el número. Si el nombre trae
// «Navío» se marca solo (con adjuntos), se guarda en grupos.json y se baja lo que ya traía.
// Un grupo que alguien quitó con `marcar.js --quitar` (escuchar: false) se respeta.
const esNavio = nombre => /navio/i.test(nombre.normalize('NFD').replace(/\p{M}/gu, ''));
const descartados = new Set();   // grupos ya revisados que no son Navío (el barrido los vuelve a ver)
let buscando = null;
function buscarNuevos() {
  return buscando ??= (async () => {
    try {
      const marcas = new Map(JSON.parse(readFileSync(ARCHIVO, 'utf8')).map(g => [g.id, g]));
      for (const g of (await listarGrupos(clienteVivo)).grupos) {
        if (escuchados.has(g.id)) continue;
        if (!esNavio(g.nombre) || marcas.get(g.id)?.escuchar === false) { descartados.add(g.id); continue; }
        await marcarNavio(g, marcas);
      }
    } catch (e) { console.error(`⚠️  buscar grupos Navío: ${e.message.split('\n')[0]}`); }
    finally { buscando = null; }
  })();
}

async function marcarNavio({ id, nombre }, marcas) {
  const g = marcas.get(id) ?? { id, nombre, alta: new Date().toISOString() };
  Object.assign(g, { nombre, escuchar: true, navio: true });
  marcas.set(id, g);
  writeFileSync(`${ARCHIVO}.tmp`, JSON.stringify([...marcas.values()], null, 2) + '\n');
  renameSync(`${ARCHIVO}.tmp`, ARCHIVO);
  escuchados.set(id, nombre);
  conMedia.add(id);
  descartados.delete(id);
  console.log(`\n🆕 Grupo Navío nuevo: «${nombre}». Lo escucho y bajo sus adjuntos.`);
  notificar('WhatsApp lector', `🆕 Expediente Navío: «${nombre}»`);
  const { mensajes, error } = await bajarHistorial(clienteVivo, id, 100);
  if (error) console.error(`⚠️  Historial de «${nombre}» falló: ${error}`);
  for (const m of mensajes ?? []) await procesar(m, '  ');
}

// «#contrato» en un grupo Navío = el expediente está completo: se manda solo a Navío y aparece en
// su bandeja. Se esperan 30 s por si siguen llegando adjuntos (y para que terminen de bajar);
// otro «#contrato» en esa espera la reinicia. Escribirlo otra vez después de mandar más papeles
// abre un expediente nuevo con todo. Lo pendiente vive en disco (disparo.js): si el vigilante se
// reinicia a media espera o a media subida, al arrancar lo vuelve a mandar.
const ENVIADOS = new URL('./navio-enviados.json', import.meta.url).pathname;
const ESPERA_DISPARO = 30e3;
const disparos = new Map(), enCurso = new Set();
function dispararNavio(gid) {
  clearTimeout(disparos.get(gid));
  const nombre = escuchados.get(gid);
  console.log(`📨 «#contrato» en «${nombre}»: lo mando a Navío en ${ESPERA_DISPARO / 1000} s`);
  disparos.set(gid, setTimeout(() => {
    disparos.delete(gid);
    if (enCurso.has(gid)) return dispararNavio(gid);   // sigue subiendo el anterior: se encola
    const ids = sinMandar(db, conMedia, ENVIADOS, gid).map(m => m.id);
    if (!ids.length) return;
    enCurso.add(gid);
    execFile(process.execPath, [new URL('./navio.js', import.meta.url).pathname, gid], { timeout: 10 * 60e3 }, (err, out, errOut) => {
      enCurso.delete(gid);
      console.log((out + errOut).trim().replace(/^/gm, '   '));
      const sesion = /[?&]sesion=([\w-]+)/.exec(out)?.[1];
      if (!err && sesion) marcarEnviados(ENVIADOS, ids, sesion);
      notificar('Navío', !err && sesion ? `✅ «${nombre}» ya está en la bandeja de Navío` : `❌ «${nombre}» no se pudo mandar (se reintenta al reiniciar): ${(errOut || err?.message || '').split('\n')[0]}`);
    });
  }, ESPERA_DISPARO));
}

async function procesar(msg, etiqueta = '') {
  const gid = msg.from?.endsWith('@g.us') ? msg.from : msg.to?.endsWith('@g.us') ? msg.to : null;
  if (gid && !escuchados.has(gid) && !descartados.has(gid)) await buscarNuevos();
  const r = await procesarMsg(db, escuchados, msg);
  if (r === 'ignorado') { ignorados++; return; }
  if (r === 'duplicado') return adjunto(msg);

  // Que no se pueda armar la llave significa que WhatsApp volvió a cambiar la
  // forma de las MsgKey. Se avisa fuerte: callarlo dejaría huecos en la
  // bitácora sin que nadie se entere. Ver llave.js.
  if (r === 'sin-llave') {
    sinLlave++;
    if (sinLlave <= 3) {
      console.error(`⚠️  Mensaje SIN LLAVE, no se guardó. Revisa llave.js — ¿cambió el bundle?`);
      console.error(`   id recibido: ${JSON.stringify(msg?.id)}`);
    }
    return;
  }

  guardados++;
  const gidNuevo = msg.from?.endsWith('@g.us') ? msg.from : msg.to;
  if (conMedia.has(gidNuevo) && msg.type === 'chat' && esDisparoNavio(msg.body)) dispararNavio(gidNuevo);
  if (!RUIDO.test(msg.type)) avisar(escuchados.get(msg.from?.endsWith('@g.us') ? msg.from : msg.to), msg, etiqueta);
  let quien = msg.author || '?';
  try { const c = await msg.getContact?.(); quien = c?.name || c?.pushname || quien; } catch {}
  console.log(`${etiqueta}${fechaMx(msg.timestamp)}  ${String(quien).slice(0, 18).padEnd(18)} ${textoDe(msg).slice(0, 70)}`);
  await adjunto(msg);
}

// Grupos Navío: se intenta también con los duplicados, así el barrido (cada 10 min) y el
// arranque reintentan lo que no bajó a la primera. Si ya está en disco no hace nada.
async function adjunto(msg) {
  const grupoId = msg.from?.endsWith('@g.us') ? msg.from : msg.to;
  if (!msg.hasMedia || !conMedia.has(grupoId)) return;
  try {
    const ruta = await bajarMedia(clienteVivo, grupoId, llaveDeMensaje(msg.id), msg.timestamp, { type: msg.type, ...msg._data });
    if (ruta) console.log(`  📎 ${ruta.split('/').pop()}`);
  } catch (e) { console.error(`  ⚠️  adjunto no bajó (${msg.type}): ${e.message.split('\n')[0]}`); }
}

function preparar(cliente) {
  clienteVivo = cliente;   // antes del ready: el historial ya baja adjuntos ahí
  cliente.on('qr', () => {
    console.error('❌ La sesión se perdió. Corre: node vincular.js');
    notificar('WhatsApp lector', '❌ Se perdió la sesión. Hay que correr node vincular.js');
    // exit 0 A PROPÓSITO: el supervisor (launchd) solo reinicia salidas con
    // error. Reintentar sin sesión es abrir Chrome cada minuto para nada.
    setTimeout(() => process.exit(0), 1000);
  });

  // Rescate de 'ready' (2-oct-2026, WhatsApp Web 2.3000.1049085797): 'change:hasSynced' llega
  // antes de que la página termine de cargar, attachEventListeners truena DENTRO de una función
  // expuesta (el error se lo traga la página) y 'ready' nunca sale: conectado y sordo. 15 s
  // después los mismos pasos funcionan, así que si a los 30 s no hay ready se hacen a mano.
  // `once`, no `on`: la librería registra un listener de hasSynced por cada inject() (uno por
  // cada framenavigated; se vieron 4) y emite 'authenticated' por cada uno. Con `on` salían 4
  // timers que pasan la guarda `listo` a la par (esperan en el evaluate) y atarían el store 4 veces.
  let listo = false;
  cliente.once('authenticated', () => setTimeout(async () => {
    if (listo) return;
    console.error('⚠️  WhatsApp no dio «ready» a los 30 s. Conecto los eventos a mano.');
    try {
      if (!(await cliente.pupPage.evaluate(() => typeof window.WWebJS !== 'undefined'))) await cliente.pupPage.evaluate(Utils.LoadUtils);
      await cliente.attachEventListeners();
      cliente.emit('ready');
    } catch (e) { console.error(`❌ Rescate de ready falló: ${e.message.split('\n')[0]}`); }
  }, 30e3));

  cliente.on('ready', async () => {
    if (listo) return;   // si el ready de verdad llega tarde, no se baja el historial dos veces
    listo = true;
    console.log(`\n✅ Escuchando ${escuchados.size} grupo(s):`);
    for (const n of escuchados.values()) console.log(`   • ${n}`);
    console.log('');

    if (HISTORIAL > 0) {
      for (const [id, nombre] of escuchados) {
        // A pelo del store: getChatById/fetchMessages truenan con este bundle.
        // Ver historial.js.
        const { mensajes, vueltas, error } = await bajarHistorial(cliente, id, HISTORIAL);
        if (error) {
          console.error(`⚠️  Historial de «${nombre}» falló: ${error}`);
          continue;
        }
        console.log(`↺ Historial de «${nombre}»: ${mensajes.length} mensajes (${vueltas} vuelta(s) al servidor)`);
        if (mensajes.length === 0) {
          console.log('   (vacío: WhatsApp no da historial anterior a la entrada del número al grupo)');
        }
        for (const m of mensajes) await procesar(m, '  ');
        console.log('');
      }
      for (const [grupo, n] of pendientes) escritorio(`WhatsApp · ${grupo}`, `${n} mensaje(s) nuevo(s) mientras estaba apagado`);
      pendientes.clear();
    }
    await buscarNuevos();   // grupos Navío que se abrieron con el vigilante apagado
    // «#contrato» que no se alcanzó a mandar (reinicio a media espera, Navío caído, Mac dormida)
    for (const gid of new Set(sinMandar(db, conMedia, ENVIADOS).map(m => m.grupo_id))) dispararNavio(gid);

    console.log('En vivo. Ctrl+C para parar.\n');
  });

  cliente.on('message', m => procesar(m).catch(e => console.error('error al guardar:', e.message)));
  cliente.on('message_create', m => procesar(m).catch(e => console.error('error al guardar:', e.message)));

  cliente.on('disconnected', async razon => {
    console.error(`\n⚠️  DESCONECTADO: ${razon} — la bitácora deja de recibir datos.`);
    notificar('WhatsApp lector', `⚠️ Desconectado (${razon}). El supervisor lo reintenta.`);
    await cerrarLimpio(cliente);
    process.exit(1);
  });
}

console.log('Arrancando Chrome (headless)…');

const cliente = clienteVivo = await arrancar(preparar).catch(err => {
  console.error(`\n❌ No arrancó: ${(err?.message ?? err).toString().split('\n')[0]}`);
  process.exit(1);
});

// Latido para el semáforo de la barra de menú (~/.vigilantes/semaforo). «Vivo» NO basta:
// del 21 al 29-sep este proceso imprimió "vivo" cada media hora durante 8 días sin guardar
// un solo mensaje. Aquí se le pregunta a WhatsApp su estado real, y si no está CONNECTED
// varios minutos seguidos se sale con error: launchd lo levanta y --historial tapa el hueco.
const LATIDO = `${homedir()}/.vigilantes/whatsapp.json`;
const ARRIBA = new Date().toISOString();
const MIN_DESCONECTADO = 5;
let desconectadoMin = 0;

async function estadoWhatsApp() {
  const tope = new Promise(ok => setTimeout(ok, 15e3, 'sin respuesta'));
  try { return (await Promise.race([cliente.getState(), tope])) ?? 'sin estado'; }
  catch (e) { return `error: ${e.message.split('\n')[0]}`; }
}

async function latido() {
  const whatsapp = await estadoWhatsApp();
  const hoy = fechaMx(Date.now() / 1000).slice(0, 10);
  const porGrupo = new Map(db.prepare(
    'SELECT grupo_id, MAX(ts) ultimo, SUM(fecha_mx >= ?) hoy FROM mensajes GROUP BY grupo_id').all(hoy)
    .map(r => [r.grupo_id, r]));
  const ultimos = db.prepare('SELECT fecha_mx, grupo_nombre, autor_nombre, tipo, cuerpo FROM mensajes ORDER BY ts DESC LIMIT 40').all()
    .filter(m => !RUIDO.test(m.tipo)).slice(0, 10)
    .map(m => ({ fecha: m.fecha_mx, grupo: m.grupo_nombre, autor: m.autor_nombre,
      texto: (m.tipo === 'chat' && m.cuerpo ? m.cuerpo : `«${m.tipo}»`).replace(/\s+/g, ' ').slice(0, 80) }));   // foto: el cuerpo es la miniatura en base64
  const datos = {
    nombre: 'WhatsApp', pid: process.pid, arriba: ARRIBA, ts: new Date().toISOString(), whatsapp,
    guardados, sinLlave, log: new URL('./escuchar.log', import.meta.url).pathname,
    grupos: [...escuchados].map(([id, nombre]) => ({ nombre, ultimo: porGrupo.get(id)?.ultimo ?? null, hoy: porGrupo.get(id)?.hoy ?? 0 })),
    ultimos,
  };
  mkdirSync(`${homedir()}/.vigilantes`, { recursive: true });
  writeFileSync(`${LATIDO}.tmp`, JSON.stringify(datos, null, 2));
  renameSync(`${LATIDO}.tmp`, LATIDO);   // el semáforo nunca lee un archivo a medias

  desconectadoMin = whatsapp === 'CONNECTED' ? 0 : desconectadoMin + 1;
  // «detached Frame»: WhatsApp Web recargó la página (pasa a los ~4 min de arrancar) y puppeteer
  // se quedó con el frame viejo. No revive solo (44 casos en el log, todos esperaron los 5 min
  // sordos): se reinicia ya y --historial trae lo que llegó en ese minuto.
  if (/detached Frame/.test(whatsapp)) return reiniciar('⚠️  WhatsApp recargó la página (detached Frame)');
  if (desconectadoMin >= MIN_DESCONECTADO) {
    notificar('WhatsApp lector', `⚠️ ${MIN_DESCONECTADO} min sin conexión (${whatsapp}). Se reinicia solo.`);
    await reiniciar(`⚠️  ${MIN_DESCONECTADO} min sin conexión real (WhatsApp dice: ${whatsapp})`);
  }
}
const latir = () => latido().catch(e => console.error('latido:', e.message));
latir();
setInterval(latir, 60e3);

// Barrido: relee del store los últimos de cada grupo. Si aparece uno que el evento en vivo no
// trajo, los listeners se desengancharon (así se quedó sordo 8 días): se guarda y se reinicia.
// Los de los últimos 2 min se saltan para no ganarle la carrera al evento que ya viene en camino.
async function barrido() {
  descartados.clear();   // por si a un grupo le pusieron «Navío» en el nombre después
  await buscarNuevos();
  const antes = guardados;
  const corte = Date.now() / 1000 - 120;
  for (const [id, nombre] of escuchados) {
    const { mensajes, error } = await bajarHistorial(cliente, id, 20);
    if (error) { console.error(`⚠️  barrido «${nombre}»: ${error}`); continue; }
    for (const m of mensajes) if (m.timestamp < corte) await procesar(m, '🩹 ');
  }
  for (const [grupo, n] of pendientes) escritorio(`WhatsApp · ${grupo}`, `${n} mensaje(s) que se habían escapado`);
  pendientes.clear();
  if (guardados > antes) await reiniciar(`🩹 El barrido rescató ${guardados - antes} mensaje(s) que no llegaron en vivo`);
}
setInterval(() => barrido().catch(e => console.error('barrido:', e.message)), 10 * 60e3);

// ponytail: reinicio a ciegas cada 6 h. Si la página entera se congela, el store tampoco se
// entera y el barrido no lo ve; así el hueco máximo es 6 h (--historial lo tapa al volver).
// Quitarlo cuando haya forma de comparar contra algo externo.
setTimeout(() => reiniciar('↻ Reinicio preventivo de cada 6 h'), 6 * 3600e3);

async function reiniciar(motivo) {
  console.error(`\n${motivo}. Reinicio para reenganchar.`);
  await cerrarLimpio(cliente);
  process.exit(1);   // con error a propósito: launchd solo relanza salidas con error (systemd relanza todo)
}

setInterval(() => {
  const total = db.prepare('SELECT COUNT(*) c FROM mensajes').get().c;
  console.log(`— ${fechaMx(Date.now() / 1000)}  vivo · ${guardados} nuevos esta sesión · ${total} en total`);
}, 30 * 60 * 1000);

// SIGTERM también cierra limpio: es lo que manda launchd con «Reiniciar» del semáforo
// (kickstart -k) y con `./supervisor.sh quitar`. Sin esto Chrome moría sin guardar la sesión.
async function parar() {
  const total = db.prepare('SELECT COUNT(*) c FROM mensajes').get().c;
  console.log(`\n\nParado. ${guardados} guardados esta sesión, ${total} en la base. (${ignorados} ajenos ignorados${sinLlave ? `, ${sinLlave} SIN LLAVE` : ''})`);
  await cerrarLimpio(cliente);
  process.exit(0);
}
process.on('SIGINT', parar);
process.on('SIGTERM', parar);
