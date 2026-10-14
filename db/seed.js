require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.PGHOST, port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  database: process.env.PGDATABASE, user: process.env.PGUSER, password: process.env.PGPASSWORD,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const email = 'demo@zavozelenye.local';
    const hash = await bcrypt.hash('demo12345', 12);
    const userRes = await client.query(
      `INSERT INTO users(first_name,last_name,email,password_hash,city)
       VALUES('Демо','Организатор',$1,$2,'Москва')
       ON CONFLICT DO NOTHING RETURNING id`, [email,hash]
    );
    let userId;
    if (userRes.rowCount) userId = userRes.rows[0].id;
    else userId = (await client.query('SELECT id FROM users WHERE email=$1',[email])).rows[0].id;

    const examples = [
      ['Чистый парк','Экология','Центральный парк','Соберём мусор на аллеях и у пруда. Перчатки и мешки выдадут на месте.',3,2],
      ['Помощь в приюте','Животные','Приют для животных','Поможем сотрудникам приюта с ежедневными делами и заботой о животных.',4,3],
      ['Помощь в больнице','Помощь людям','Городская больница','Поможем с разрешёнными организационными задачами учреждения.',5,5],
      ['Посадка деревьев','Экология','Битцевский парк','Посадим молодые деревья. Инструменты предоставят организаторы.',25,9],
      ['Подарки ветеранам','Помощь людям','Дом ветеранов','Соберём подарочные наборы и поможем провести встречу.',10,14],
      ['Книги для детского дома','Дети','Библиотека №12','Отсортируем и упакуем книги и настольные игры для отправки детям.',7,20]
    ];
    for (const [title,category,location,description,places,days] of examples) {
      await client.query(
        `INSERT INTO events(creator_id,category_id,title,description,city,location,starts_at,volunteers_needed,status)
         SELECT $1,c.id,$2,$3,'Москва',$4,NOW() + ($6::int * INTERVAL '1 day'),$5,'published'
         FROM categories c WHERE c.name=$7
         AND NOT EXISTS (SELECT 1 FROM events e WHERE e.creator_id=$1 AND e.title=$2)`,
        [userId,title,description,location,places,days,category]
      );
    }
    await client.query('COMMIT');
    console.log('Демо-данные готовы. Вход: demo@zavozelenye.local / demo12345');
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally { client.release(); await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
