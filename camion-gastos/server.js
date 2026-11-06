const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool, types } = require('pg');
types.setTypeParser(1082, (v) => v); // DATE como texto, sin cambios de zona horaria
const path = require('path');

const { DATABASE_URL, ADMIN_USER = 'admin', ADMIN_PASSWORD, JWT_SECRET, PORT = 3000 } = process.env;
if (!DATABASE_URL || !ADMIN_PASSWORD || !JWT_SECRET) {
  console.error('Faltan variables: DATABASE_URL, ADMIN_PASSWORD, JWT_SECRET');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: 'Error del servidor' }); });

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try { jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Sesión inválida' }); }
}

app.post('/api/login', (req, res) => {
  const { usuario, clave } = req.body || {};
  if (usuario === ADMIN_USER && clave === ADMIN_PASSWORD) {
    return res.json({ token: jwt.sign({ u: usuario }, JWT_SECRET, { expiresIn: '7d' }) });
  }
  res.status(401).json({ error: 'Usuario o clave incorrectos' });
});

// ---- Camiones
app.get('/api/camiones', auth, wrap(async (req, res) => {
  res.json((await pool.query('SELECT * FROM camiones ORDER BY nombre')).rows);
}));
app.post('/api/camiones', auth, wrap(async (req, res) => {
  const { nombre, placas } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre' });
  res.json((await pool.query('INSERT INTO camiones(nombre, placas) VALUES($1,$2) RETURNING *', [nombre, placas || null])).rows[0]);
}));

// ---- Movimientos
function validar(b) {
  if (!['ingreso', 'gasto'].includes(b.tipo)) return 'Tipo inválido';
  if (!(Number(b.monto) > 0)) return 'El monto debe ser mayor a 0';
  if (!b.fecha) return 'Falta la fecha';
  if (!b.categoria) return 'Falta la categoría';
  if (!b.camion_id) return 'Selecciona un camión';
  return null;
}

app.get('/api/movimientos', auth, wrap(async (req, res) => {
  const { camion_id, tipo, desde, hasta } = req.query;
  const w = [], p = [];
  if (camion_id) { p.push(camion_id); w.push(`m.camion_id=$${p.length}`); }
  if (tipo) { p.push(tipo); w.push(`m.tipo=$${p.length}`); }
  if (desde) { p.push(desde); w.push(`m.fecha>=$${p.length}`); }
  if (hasta) { p.push(hasta); w.push(`m.fecha<=$${p.length}`); }
  const sql = `SELECT m.*, c.nombre AS camion FROM movimientos m JOIN camiones c ON c.id=m.camion_id
               ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY m.fecha DESC, m.id DESC LIMIT 500`;
  res.json((await pool.query(sql, p)).rows);
}));

app.post('/api/movimientos', auth, wrap(async (req, res) => {
  const err = validar(req.body);
  if (err) return res.status(400).json({ error: err });
  const b = req.body;
  res.json((await pool.query(
    `INSERT INTO movimientos(camion_id,tipo,categoria,monto,fecha,descripcion) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [b.camion_id, b.tipo, b.categoria, b.monto, b.fecha, b.descripcion || null])).rows[0]);
}));

app.put('/api/movimientos/:id', auth, wrap(async (req, res) => {
  const err = validar(req.body);
  if (err) return res.status(400).json({ error: err });
  const b = req.body;
  const r = await pool.query(
    `UPDATE movimientos SET camion_id=$1,tipo=$2,categoria=$3,monto=$4,fecha=$5,descripcion=$6 WHERE id=$7 RETURNING *`,
    [b.camion_id, b.tipo, b.categoria, b.monto, b.fecha, b.descripcion || null, req.params.id]);
  r.rows[0] ? res.json(r.rows[0]) : res.status(404).json({ error: 'No existe' });
}));

app.delete('/api/movimientos/:id', auth, wrap(async (req, res) => {
  await pool.query('DELETE FROM movimientos WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ---- Resumen (totales, por categoría y por mes)
app.get('/api/resumen', auth, wrap(async (req, res) => {
  const { camion_id, desde, hasta } = req.query;
  const w = [], p = [];
  if (camion_id) { p.push(camion_id); w.push(`camion_id=$${p.length}`); }
  if (desde) { p.push(desde); w.push(`fecha>=$${p.length}`); }
  if (hasta) { p.push(hasta); w.push(`fecha<=$${p.length}`); }
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const [tot, cat, mes] = await Promise.all([
    pool.query(`SELECT tipo, COALESCE(SUM(monto),0)::float AS total FROM movimientos ${where} GROUP BY tipo`, p),
    pool.query(`SELECT categoria, COALESCE(SUM(monto),0)::float AS total FROM movimientos ${where ? where + ' AND' : 'WHERE'} tipo='gasto' GROUP BY categoria ORDER BY total DESC`, p),
    pool.query(`SELECT to_char(fecha,'YYYY-MM') AS mes,
                  COALESCE(SUM(monto) FILTER (WHERE tipo='ingreso'),0)::float AS ingresos,
                  COALESCE(SUM(monto) FILTER (WHERE tipo='gasto'),0)::float AS gastos
                FROM movimientos ${where} GROUP BY 1 ORDER BY 1 DESC LIMIT 12`, p),
  ]);
  const t = Object.fromEntries(tot.rows.map((r) => [r.tipo, r.total]));
  res.json({ ingresos: t.ingreso || 0, gastos: t.gasto || 0, utilidad: (t.ingreso || 0) - (t.gasto || 0), porCategoria: cat.rows, porMes: mes.rows });
}));

// ---- Crear tablas al arrancar
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS camiones (
      id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, placas TEXT, creado TIMESTAMPTZ DEFAULT now());
    CREATE TABLE IF NOT EXISTS movimientos (
      id SERIAL PRIMARY KEY,
      camion_id INT NOT NULL REFERENCES camiones(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL CHECK (tipo IN ('ingreso','gasto')),
      categoria TEXT NOT NULL,
      monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
      fecha DATE NOT NULL,
      descripcion TEXT,
      creado TIMESTAMPTZ DEFAULT now());
    CREATE INDEX IF NOT EXISTS idx_mov_fecha ON movimientos(fecha);
    CREATE INDEX IF NOT EXISTS idx_mov_camion ON movimientos(camion_id);`);
  if (!(await pool.query('SELECT 1 FROM camiones LIMIT 1')).rowCount)
    await pool.query(`INSERT INTO camiones(nombre) VALUES ('Camión 1')`);
}

init().then(() => app.listen(PORT, () => console.log('Listo en puerto ' + PORT)))
  .catch((e) => { console.error('No se pudo iniciar:', e.message); process.exit(1); });
