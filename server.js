require('dotenv').config();

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('Укажите JWT_SECRET длиной не менее 32 символов в .env');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.PGHOST,
  port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }));

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function makeToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role }, JWT_SECRET, { expiresIn: '7d', issuer: 'zavozelenye-api' });
}
function publicUser(row) {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    patronymic: row.patronymic,
    email: row.email,
    phone: row.phone,
    city: row.city,
    role: row.role,
    createdAt: row.created_at
  };
}
const authRequired = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Для этого действия нужно войти в аккаунт.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET, { issuer: 'zavozelenye-api' });
    const result = await pool.query(
      'SELECT id, first_name, last_name, patronymic, email, phone, city, role, created_at FROM users WHERE id = $1',
      [payload.sub]
    );
    if (!result.rowCount) return res.status(401).json({ error: 'Пользователь не найден.' });
    req.user = result.rows[0];
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Сессия истекла. Войдите ещё раз.' });
    }
    throw err;
  }
});

function normalizeContact(value) {
  const raw = String(value || '').trim();
  if (!raw) return {};
  if (raw.includes('@')) return { email: raw.toLowerCase(), phone: null };
  const phone = raw.replace(/[^\d+]/g, '');
  return { email: null, phone };
}
function validateEventInput(body) {
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  const city = String(body.city || '').trim();
  const location = String(body.location || '').trim();
  const startsAt = new Date(body.startsAt);
  const volunteersNeeded = Number(body.volunteersNeeded);
  if (title.length < 3 || title.length > 180) return 'Название должно содержать от 3 до 180 символов.';
  if (description.length < 5 || description.length > 5000) return 'Описание должно содержать от 5 до 5000 символов.';
  if (!city || city.length > 100) return 'Укажите город.';
  if (!location || location.length > 255) return 'Укажите место проведения.';
  if (!body.startsAt || Number.isNaN(startsAt.getTime())) return 'Укажите корректную дату и время.';
  if (volunteersNeeded < 1 || volunteersNeeded > 10000 || !Number.isInteger(volunteersNeeded)) return 'Количество волонтёров должно быть целым числом от 1 до 10000.';
  return null;
}

app.get('/api/health', asyncHandler(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', database: 'connected' });
}));

app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const firstName = String(req.body.firstName || '').trim();
  const lastName = String(req.body.lastName || '').trim();
  const patronymic = String(req.body.patronymic || '').trim() || null;
  const contact = normalizeContact(req.body.contact);
  const password = String(req.body.password || '');
  const city = String(req.body.city || 'Москва').trim() || 'Москва';

  if (firstName.length < 1 || firstName.length > 80 || lastName.length < 1 || lastName.length > 80) {
    return res.status(400).json({ error: 'Укажите имя и фамилию.' });
  }
  if (!contact.email && !contact.phone) return res.status(400).json({ error: 'Укажите почту или номер телефона.' });
  if (contact.phone && contact.phone.replace(/\D/g, '').length < 7) return res.status(400).json({ error: 'Проверьте номер телефона.' });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Пароль должен содержать от 8 до 128 символов.' });

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const result = await pool.query(
      `INSERT INTO users (first_name, last_name, patronymic, email, phone, password_hash, city)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, first_name, last_name, patronymic, email, phone, city, role, created_at`,
      [firstName, lastName, patronymic, contact.email || null, contact.phone || null, passwordHash, city]
    );
    const user = result.rows[0];
    res.status(201).json({ token: makeToken(user), user: publicUser(user) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Аккаунт с такой почтой или телефоном уже существует.' });
    throw err;
  }
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const contact = normalizeContact(req.body.identifier);
  const password = String(req.body.password || '');
  const identifier = contact.email || contact.phone;
  if (!identifier || !password) return res.status(400).json({ error: 'Введите почту/телефон и пароль.' });
  const result = await pool.query(
    `SELECT id, first_name, last_name, patronymic, email, phone, city, role, created_at, password_hash
     FROM users WHERE (email IS NOT NULL AND LOWER(email) = LOWER($1))
        OR (phone IS NOT NULL AND phone = $2)`,
    [contact.email || '', contact.phone || '']
  );
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Неверная почта/телефон или пароль.' });
  }
  res.json({ token: makeToken(user), user: publicUser(user) });
}));

app.get('/api/auth/me', authRequired, (req, res) => res.json({ user: publicUser(req.user) }));

app.get('/api/categories', asyncHandler(async (_req, res) => {
  const result = await pool.query('SELECT id, name, description FROM categories ORDER BY name');
  res.json({ categories: result.rows });
}));

// Публичная лента: поиск и фильтры можно комбинировать.
app.get('/api/events', asyncHandler(async (req, res) => {
  let sql = `
    SELECT e.id, e.creator_id, e.category_id, e.title, e.description, e.city, e.location,
           e.starts_at, e.ends_at, e.volunteers_needed, e.status, e.created_at,
           c.name AS category_name, u.first_name AS creator_first_name, u.last_name AS creator_last_name,
           COALESCE(p.joined_count, 0)::int AS joined_count
    FROM events e
    JOIN categories c ON c.id = e.category_id
    JOIN users u ON u.id = e.creator_id
    LEFT JOIN (
      SELECT event_id, COUNT(*) FILTER (WHERE status = 'joined') AS joined_count
      FROM event_participants GROUP BY event_id
    ) p ON p.event_id = e.id
  `;
  const conditions = [`e.status = 'published'`, `e.starts_at >= NOW() - INTERVAL '1 day'`];
  const params = [];
  const param = value => { params.push(value); return `$${params.length}`; };
  if (req.query.q) {
    const p = param(`%${String(req.query.q).slice(0, 100)}%`);
    conditions.push(`(e.title ILIKE ${p} OR e.description ILIKE ${p} OR e.location ILIKE ${p} OR c.name ILIKE ${p})`);
  }
  if (req.query.city) conditions.push(`e.city ILIKE ${param(String(req.query.city).slice(0, 100))}`);
  if (req.query.category && req.query.category !== 'Все') conditions.push(`c.name = ${param(String(req.query.category).slice(0, 100))}`);
  if (req.query.place && req.query.place !== 'Все') conditions.push(`e.location ILIKE ${param('%' + String(req.query.place).slice(0, 100) + '%')}`);
  if (req.query.time === 'morning') conditions.push(`EXTRACT(HOUR FROM e.starts_at) < 12`);
  if (req.query.time === 'day') conditions.push(`EXTRACT(HOUR FROM e.starts_at) >= 12 AND EXTRACT(HOUR FROM e.starts_at) < 18`);
  if (req.query.time === 'evening') conditions.push(`EXTRACT(HOUR FROM e.starts_at) >= 18`);
  sql += ` WHERE ${conditions.join(' AND ')} ORDER BY e.starts_at ASC LIMIT 100`;
  const result = await pool.query(sql, params);
  res.json({ events: result.rows });
}));

app.get('/api/events/:id', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT e.*, c.name AS category_name, u.first_name AS creator_first_name, u.last_name AS creator_last_name,
      (SELECT COUNT(*)::int FROM event_participants ep WHERE ep.event_id=e.id AND ep.status='joined') AS joined_count
     FROM events e JOIN categories c ON c.id=e.category_id JOIN users u ON u.id=e.creator_id
     WHERE e.id=$1 AND e.status='published'`,
    [req.params.id]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Мероприятие не найдено.' });
  res.json({ event: result.rows[0] });
}));

app.post('/api/events', authRequired, asyncHandler(async (req, res) => {
  const error = validateEventInput(req.body);
  if (error) return res.status(400).json({ error });
  const categoryName = String(req.body.category || 'Другое').trim();
  const category = await pool.query('SELECT id FROM categories WHERE name=$1', [categoryName]);
  if (!category.rowCount) return res.status(400).json({ error: 'Выберите категорию из списка.' });
  const endsAt = req.body.endsAt ? new Date(req.body.endsAt) : null;
  if (endsAt && (Number.isNaN(endsAt.getTime()) || endsAt <= new Date(req.body.startsAt))) {
    return res.status(400).json({ error: 'Окончание должно быть позже начала.' });
  }
  const result = await pool.query(
    `INSERT INTO events (creator_id, category_id, title, description, city, location, starts_at, ends_at, volunteers_needed, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'published')
     RETURNING id, creator_id, category_id, title, description, city, location, starts_at, ends_at, volunteers_needed, status, created_at`,
    [req.user.id, category.rows[0].id, req.body.title.trim(), req.body.description.trim(),
      req.body.city.trim(), req.body.location.trim(), new Date(req.body.startsAt).toISOString(),
      endsAt ? endsAt.toISOString() : null, Number(req.body.volunteersNeeded)]
  );
  res.status(201).json({ event: result.rows[0] });
}));

app.post('/api/events/:id/join', authRequired, asyncHandler(async (req, res) => {
  const event = await pool.query(
    `SELECT id, volunteers_needed,
      (SELECT COUNT(*) FROM event_participants WHERE event_id=events.id AND status='joined')::int AS joined_count
     FROM events WHERE id=$1 AND status='published'`,
    [req.params.id]
  );
  if (!event.rowCount) return res.status(404).json({ error: 'Мероприятие не найдено.' });
  const row = event.rows[0];
  if (row.joined_count >= row.volunteers_needed) return res.status(409).json({ error: 'Свободных мест больше нет.' });
  await pool.query(
    `INSERT INTO event_participants (event_id,user_id,status) VALUES ($1,$2,'joined')
     ON CONFLICT (event_id,user_id) DO UPDATE SET status='joined', joined_at=NOW()`,
    [row.id, req.user.id]
  );
  res.json({ message: 'Вы записаны на мероприятие.' });
}));

app.delete('/api/events/:id/join', authRequired, asyncHandler(async (req, res) => {
  const result = await pool.query(
    `UPDATE event_participants SET status='cancelled' WHERE event_id=$1 AND user_id=$2 AND status='joined'`,
    [req.params.id, req.user.id]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Активная запись не найдена.' });
  res.json({ message: 'Запись отменена.' });
}));

app.put('/api/events/:id/favorite', authRequired, asyncHandler(async (req, res) => {
  const event = await pool.query(`SELECT id FROM events WHERE id=$1 AND status='published'`, [req.params.id]);
  if (!event.rowCount) return res.status(404).json({ error: 'Мероприятие не найдено.' });
  await pool.query(
    `INSERT INTO event_favorites (event_id,user_id) VALUES ($1,$2)
     ON CONFLICT (event_id,user_id) DO NOTHING`,
    [req.params.id, req.user.id]
  );
  res.json({ favorited: true });
}));

app.delete('/api/events/:id/favorite', authRequired, asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM event_favorites WHERE event_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ favorited: false });
}));

app.get('/api/profile', authRequired, asyncHandler(async (req, res) => {
  const [user, created, participations, favorites] = await Promise.all([
    pool.query('SELECT id,first_name,last_name,patronymic,email,phone,city,role,created_at FROM users WHERE id=$1', [req.user.id]),
    pool.query(
      `SELECT e.id,e.title,e.description,e.city,e.location,e.starts_at,e.volunteers_needed,e.status,c.name AS category_name
       FROM events e JOIN categories c ON c.id=e.category_id WHERE e.creator_id=$1 ORDER BY e.created_at DESC`,
      [req.user.id]),
    pool.query(
      `SELECT e.id,e.title,e.city,e.location,e.starts_at,e.volunteers_needed,e.status,c.name AS category_name,ep.status AS participation_status
       FROM event_participants ep JOIN events e ON e.id=ep.event_id JOIN categories c ON c.id=e.category_id
       WHERE ep.user_id=$1 AND ep.status='joined' ORDER BY ep.joined_at DESC`,
      [req.user.id]),
    pool.query(
      `SELECT e.id,e.title,e.city,e.location,e.starts_at,e.volunteers_needed,e.status,c.name AS category_name
       FROM event_favorites ef JOIN events e ON e.id=ef.event_id JOIN categories c ON c.id=e.category_id
       WHERE ef.user_id=$1 ORDER BY ef.created_at DESC`,
      [req.user.id])
  ]);
  res.json({ user: publicUser(user.rows[0]), created: created.rows, participations: participations.rows, favorites: favorites.rows });
}));

app.delete('/api/profile/events/:id', authRequired, asyncHandler(async (req, res) => {
  const result = await pool.query(
    `UPDATE events SET status='cancelled', updated_at=NOW() WHERE id=$1 AND creator_id=$2 AND status='published' RETURNING id`,
    [req.params.id, req.user.id]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Заявка не найдена или вы не её автор.' });
  res.json({ message: 'Заявка отменена.' });
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'API-адрес не найден.' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err.code === '23503') return res.status(400).json({ error: 'Связанная запись не найдена.' });
  if (err.code === '23505') return res.status(409).json({ error: 'Такая запись уже существует.' });
  res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Внутренняя ошибка сервера.' : 'Ошибка сервера: ' + err.message });
});

const server = app.listen(PORT, () => console.log(`ЗавоЗеленые запущен: http://localhost:${PORT}`));
async function shutdown() {
  server.close(async () => { await pool.end(); process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
