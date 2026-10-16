// db.js — almacén crudo. SQLite nativo de Node 24, nada que compilar.
//
// Regla: se guarda el mensaje TAL CUAL llegó, en `crudo` (JSON completo). Las
// columnas de arriba son comodidad para consultar; si el parser resulta estar
// mal, se re-parsea desde `crudo` sin volver a bajar nada de WhatsApp.

import { DatabaseSync } from 'node:sqlite';

const RUTA = new URL('./mensajes.sqlite', import.meta.url).pathname;

// México (Oaxaca) es UTC-6 fijo, sin horario de verano desde 2022. Si guardamos
// en UTC, todo lo de después de las 18:00 aparece en el día siguiente.
const OFFSET_MX_MS = -6 * 60 * 60 * 1000;

export function fechaMx(tsSegundos) {
  return new Date(tsSegundos * 1000 + OFFSET_MX_MS).toISOString().replace('T', ' ').slice(0, 19);
}

// El NOT NULL de `id` NO es adorno. SQLite acepta NULLs repetidos en un
// TEXT PRIMARY KEY (comprobado el 2026-09-08: tres INSERT OR IGNORE con id
// NULL metieron tres filas). Sin el NOT NULL, un mensaje sin llave se guarda
// una y otra vez y la bitácora se llena de repetidos sin un solo error.
const ESQUEMA = `
  CREATE TABLE IF NOT EXISTS mensajes (
    id            TEXT PRIMARY KEY NOT NULL,
    grupo_id      TEXT NOT NULL,
    grupo_nombre  TEXT,
    autor_id      TEXT,
    autor_nombre  TEXT,
    ts            INTEGER NOT NULL,
    fecha_mx      TEXT NOT NULL,
    tipo          TEXT,
    cuerpo        TEXT,
    tiene_media   INTEGER NOT NULL DEFAULT 0,
    citado_id     TEXT,
    crudo         TEXT NOT NULL,
    guardado_en   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_grupo_ts ON mensajes (grupo_id, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_fecha    ON mensajes (fecha_mx);
`;

export function abrirDb(ruta = RUTA) {
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(ESQUEMA);

  // Bases hechas antes del 2026-09-08 traen `id` sin NOT NULL. CREATE TABLE
  // IF NOT EXISTS no las corrige, así que hay que verlo a mano.
  const col = db.prepare(`SELECT "notnull" FROM pragma_table_info('mensajes') WHERE name='id'`).get();
  if (col && col.notnull === 0) {
    const { c } = db.prepare('SELECT COUNT(*) c FROM mensajes').get();
    if (c === 0) {
      db.exec('DROP TABLE mensajes;');
      db.exec(ESQUEMA);
    } else {
      // Con datos adentro no se toca nada a la brava: se avisa y ya.
      console.error(
        `⚠️  ${ruta} trae el esquema viejo (id sin NOT NULL) y ${c} filas dentro.\n` +
        '   Puede tener repetidos con id NULL. Revísalo antes de confiar en la bitácora:\n' +
        "   SELECT COUNT(*) FROM mensajes WHERE id IS NULL;"
      );
    }
  }
  return db;
}

export function guardar(db, m) {
  if (!m.id) throw new Error('guardar(): mensaje sin llave. Nunca se guarda sin id.');
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO mensajes
      (id, grupo_id, grupo_nombre, autor_id, autor_nombre, ts, fecha_mx,
       tipo, cuerpo, tiene_media, citado_id, crudo, guardado_en)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const r = stmt.run(
    m.id, m.grupo_id, m.grupo_nombre, m.autor_id, m.autor_nombre, m.ts, m.fecha_mx,
    m.tipo, m.cuerpo, m.tiene_media ? 1 : 0, m.citado_id, m.crudo, fechaMx(Date.now() / 1000)
  );
  return r.changes > 0; // false = ya lo teníamos
}
