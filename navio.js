// navio.js — manda el expediente de un grupo de WhatsApp a Navío Contratos.
//
// Cada contrato llega en su propio grupo: datos en texto + documentos. Aquí se
// juntan los mensajes guardados por escuchar.js y los adjuntos de media/<grupo>/
// y se abre una sesión en Navío, sin copiar y pegar nada. El análisis con IA
// corre al abrir la liga (así se ve y no se paga dos veces).
//
//   node navio.js "Prueba Navío"          contra el deploy (BASE=https://tu-app)
//   BASE=http://localhost:3591 node navio.js "Prueba Navío"   contra Navío local
//   node navio.js "Prueba Navío" --ver    solo enseña lo que mandaría (no gasta API)
//   node navio.js "Prueba Navío" --sin "Contrato de Arrendamiento"   deja fuera los adjuntos con ese texto (repetible)
//   node navio.js 1203634…@g.us            por id (así lo llama escuchar.js al ver «#contrato»)
//
// Solo lee mensajes.sqlite y media/: no toca WhatsApp, corre con el supervisor puesto.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { abrirDb } from './db.js';
import { DIR_MEDIA, hashDe } from './media.js';

const BASE = (process.env.BASE || 'http://localhost:3591').replace(/\/$/, '');
// Navío pide clave (HTTP Basic) en el deploy: NAVIO_CLAVE en el entorno, o la primera línea de
// navio-clave.txt (aquí al lado, no se sube a ningún lado). Local sin clave: no pasa nada.
const CLAVE = process.env.NAVIO_CLAVE
  || (existsSync(new URL('./navio-clave.txt', import.meta.url)) ? readFileSync(new URL('./navio-clave.txt', import.meta.url), 'utf8').split('\n')[0].trim() : '');
const AUTH = CLAVE ? { Authorization: 'Basic ' + Buffer.from(`navio:${CLAVE}`).toString('base64') } : {};
const args = process.argv.slice(2);
const VER = args.includes('--ver');
const SIN = [];   // --sin se puede repetir
for (let i; (i = args.indexOf('--sin')) !== -1;) SIN.push(args.splice(i, 2)[1]?.toLowerCase());
const buscado = args.find(a => a !== '--ver');
if (!buscado) { console.error('Uso: node navio.js "<nombre del grupo>"'); process.exit(1); }

const grupos = JSON.parse(readFileSync(new URL('./grupos.json', import.meta.url), 'utf8'));
const porId = grupos.filter(g => g.id === buscado);
const hallados = porId.length ? porId : grupos.filter(g => g.nombre.toLowerCase().includes(buscado.toLowerCase()));
if (hallados.length !== 1) {
  console.error(hallados.length ? `Ambiguo: ${hallados.map(g => g.nombre).join(' · ')}` : `No hay grupo «${buscado}» en grupos.json`);
  process.exit(1);
}
const grupo = hallados[0];

// El texto como lo leería Jorge: quién dijo qué. Cada adjunto va con su pie de foto en la misma
// línea («adjunto: foto 2.jpg» INE del fiador), así la IA sabe qué es cada archivo. Las fotos traen
// la miniatura en `cuerpo` (base64): de ellas solo cuenta el pie.
const dir = DIR_MEDIA + grupo.id + '/';
const NO_LEE = new Set(['audio', 'ptt', 'video', 'sticker']);   // Navío no los puede leer: van marcados en el texto
function armar() {
const enDisco = existsSync(dir) ? readdirSync(dir).filter(f => !f.startsWith('.') && !f.endsWith('.tmp')) : [];
const usados = new Set();
const unico = (nombre) => {   // dos "foto.jpg" o dos "INE.pdf" → "foto.jpg", "foto 2.jpg"
  const [, base, ext = ''] = /^(.*?)(\.[^.]*)?$/.exec(nombre);
  let n = 1, sale = nombre;
  while (usados.has(sale.toLowerCase())) sale = `${base} ${++n}${ext}`;
  usados.add(sale.toLowerCase());
  return sale;
};

const lineas = [], archivos = [], faltan = [];
for (const m of abrirDb().prepare('SELECT * FROM mensajes WHERE grupo_id = ? ORDER BY ts').all(grupo.id)) {
  const d = JSON.parse(m.crudo);
  let texto = m.tipo === 'chat' ? m.cuerpo : null;
  if (m.tiene_media) {
    const pie = d.caption && d.caption !== d.filename ? d.caption : '';   // en documentos el pie suele ser el nombre
    if (m.tipo === 'audio' || m.tipo === 'ptt') texto = '«nota de voz — no se transcribe, revisar a mano»';
    else if (NO_LEE.has(m.tipo)) texto = `«${m.tipo} — no se analiza» ${pie}`.trim();
    else {
      const f = enDisco.find(x => x.includes(`-${hashDe(m.id)}-`));
      if (f && SIN.some(t => f.toLowerCase().includes(t))) texto = "«adjunto omitido a mano»";   // sin nombre: el nombre puede soplar la respuesta
      else if (f) {
        const nombre = unico(f.replace(/^\d+-[0-9a-f]{8}-/, ''));
        archivos.push({ ruta: dir + f, nombre });
        // a media escritura (el vigilante baja los grandes en paralelo): se espera, pero se manda lo que haya
        if (d.size && statSync(dir + f).size < d.size) faltan.push(`${m.fecha_mx} ${m.tipo} ${d.filename || ''} (incompleto)`);
        texto = `«adjunto: ${nombre}» ${pie}`.trim();
      } else {
        faltan.push(`${m.fecha_mx} ${m.tipo} ${d.filename || ''}`);
        texto = `«adjunto que no se pudo bajar: ${d.filename || m.tipo}» ${pie}`.trim();
      }
    }
  }
  if (texto) lineas.push(`[${m.fecha_mx.slice(0, 16)}] ${m.autor_nombre || m.autor_id}: ${texto}`);
}
return { lineas, archivos, faltan };
}

// «#contrato» llega a los 30 s de escribirse, y un PDF de 50 MB tarda ~45 s en bajar: si falta algún
// adjunto se espera (hasta 2 min) a que el vigilante lo termine, en vez de mandar el expediente
// incompleto y darlo por enviado. Lo que de plano no baja (pesa de más, expiró) se manda marcado.
const ESPERAS_ADJUNTOS = 4, ESPERA_ADJUNTOS_MS = Number(process.env.NAVIO_ESPERA_ADJUNTOS_MS) || 30e3;   // el env es para las pruebas
let armado;
for (let i = 0; ; i++) {
  armado = armar();
  if (VER || !armado.faltan.length || i >= ESPERAS_ADJUNTOS) break;
  console.log(`⏳ faltan ${armado.faltan.length} adjunto(s) por bajar; espero ${ESPERA_ADJUNTOS_MS / 1000} s (${i + 1}/${ESPERAS_ADJUNTOS})`);
  await new Promise(ok => setTimeout(ok, ESPERA_ADJUNTOS_MS));
}
const { lineas, archivos, faltan } = armado;

console.log(`«${grupo.nombre}»: ${lineas.length} mensajes, ${archivos.length} adjuntos`);
for (const f of faltan) console.log(`⚠️  no está en disco (el vigilante no lo bajó): ${f}`);
if (VER) {
  console.log('\n--- texto ---\n' + lineas.join('\n') + '\n\n--- archivos ---');
  for (const a of archivos) console.log(`${a.nombre}  (${(statSync(a.ruta).size / 1024).toFixed(0)} KB)`);
  process.exit(0);
}
if (!lineas.length && !archivos.length) { console.error('Nada que mandar todavía.'); process.exit(1); }

const origen = { grupo: grupo.nombre };   // para la bandeja de Navío

// Un tropiezo de Vercel o de la red a media demo no debe tirar el expediente: cada paso se reintenta
// (3 veces, 20 s entre una y otra). Lo que no mejora con esperar (clave mala, petición inválida) falla ya.
const INTENTOS = 3, ESPERA_REINTENTO_MS = Number(process.env.NAVIO_ESPERA_REINTENTO_MS) || 20e3;
async function conReintentos(etiqueta, fn) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      const definitivo = e.status && e.status < 500 && ![408, 429].includes(e.status);
      if (definitivo || i >= INTENTOS) throw e;
      console.log(`↻ ${etiqueta} falló (${e.message.split('\n')[0]}); reintento ${i + 1}/${INTENTOS} en ${ESPERA_REINTENTO_MS / 1000} s`);
      await new Promise(ok => setTimeout(ok, ESPERA_REINTENTO_MS));
    }
  }
}

async function api(ruta, opts) {
  // sin tope, un Vercel colgado dejaba esto esperando hasta los 10 min del vigilante
  const res = await fetch(BASE + ruta, { signal: AbortSignal.timeout(120e3), ...opts, headers: { ...AUTH, ...opts?.headers } });
  const cuerpo = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`${ruta} → ${res.status} ${cuerpo.error || ''}`), { status: res.status });
  return cuerpo;
}

// En Vercel una petición no pasa de 4.5 MB: cada archivo sube directo a Blob con el token de
// /subida (igual que el navegador, ver public/app.js) y al intake solo va la lista.
// Lo ya subido se recuerda entre intentos: reintentar el expediente no repite 60 MB.
const subidosYa = new Map();
async function intakePorBlob(sessionId) {
  const { upload } = await import('@vercel/blob/client');   // instalado aquí: en el servidor no hay ../navio-contratos
  for (const [i, a] of archivos.entries()) {
    if (subidosYa.has(a.ruta)) continue;
    if (process.stdout.isTTY) process.stdout.write(`\r   subiendo ${i + 1}/${archivos.length}…`);
    const seguro = a.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-() ]/g, '_');
    const datos = readFileSync(a.ruta);
    const blob = await conReintentos(`subir «${a.nombre}»`, () => upload(`uploads/${sessionId}/${randomBytes(4).toString('hex')}_${seguro}`, datos, {
      access: 'private', handleUploadUrl: `${BASE}/api/sessions/${sessionId}/subida`, headers: AUTH, multipart: datos.length > 8 * 1024 * 1024,
    }));
    subidosYa.set(a.ruta, { originalName: a.nombre, blobPath: blob.pathname, size: datos.length });
  }
  if (process.stdout.isTTY) process.stdout.write("\n");
  return conReintentos('guardar el expediente', () => api(`/api/sessions/${sessionId}/intake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texto: lineas.join('\n'), archivos: archivos.map(a => subidosYa.get(a.ruta)), origen }),
  }));
}

try {
  const { sessionId } = await conReintentos('crear la sesión', () => api('/api/sessions', { method: 'POST' }));
  // sin saber si hay subida directa no se adivina: en producción la subida por la API topa en 4.5 MB
  const { subidaDirecta } = await conReintentos('leer la configuración', () => api('/api/config'));
  let r;
  if (subidaDirecta) r = await intakePorBlob(sessionId);
  else {
    const fd = new FormData();
    fd.append('texto', lineas.join('\n'));
    fd.append('origen', JSON.stringify(origen));
    // Sin el prefijo <ts>-<hash>- que le pone media.js: Jorge ve el nombre que mandó el cliente.
    for (const a of archivos) fd.append('archivos', new Blob([readFileSync(a.ruta)]), a.nombre);
    r = await conReintentos('guardar el expediente', () => api(`/api/sessions/${sessionId}/intake`, { method: 'POST', body: fd }));
  }
  if (r.archivosRechazados?.length) console.log(`⚠️  Navío no aceptó: ${r.archivosRechazados.join(', ')}`);
  console.log(`✅ Expediente en Navío (${r.archivosGuardados} documentos). Ábrelo:\n   ${BASE}/?sesion=${sessionId}`);
} catch (e) {
  console.error(`❌ ${e.message}${e.cause ? ` (${e.cause.code})` : ''}`);
  if (e.status === 401) console.error('   Navío pidió clave: revisa whats-lector/navio-clave.txt (o NAVIO_CLAVE).');
  if (e.cause?.code === 'ECONNREFUSED') console.error('   ¿Está prendido Navío local? cd ../navio-contratos && npm start');
  process.exit(1);
}
