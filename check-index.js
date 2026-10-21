const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database(':memory:');

function run(sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, err => err ? reject(err) : resolve());
  });
}

function search() {
  return new Promise((resolve, reject) => {
    const start = performance.now();

    db.all(
      "SELECT * FROM events WHERE city = 'Москва'",
      (err, rows) => {
        if (err) return reject(err);
        resolve(performance.now() - start);
      }
    );
  });
}

async function main() {
  await run('CREATE TABLE events (id INTEGER PRIMARY KEY, city TEXT)');

  // Создаём тестовые данные, не трогая настоящую базу
  await run('BEGIN TRANSACTION');
for (let i = 0; i < 20000; i++) {
  await run(
    "INSERT INTO events(city) VALUES ('" +
    (i % 10 === 0 ? "Москва" : "Казань") +
    "')"
  );
}
  await run('COMMIT');

  async function measure() {
    let total = 0;
    for (let i = 0; i < 30; i++) total += await search();
    return total / 30;
  }

  const before = await measure();
  console.log('До индекса:', before.toFixed(3), 'мс');

  await run('CREATE INDEX idx_city ON events(city)');

  const after = await measure();
  console.log('После индекса:', after.toFixed(3), 'мс');

  console.log('Ускорение:', (before / after).toFixed(2), 'раз');
  db.close();
}

main().catch(console.error);