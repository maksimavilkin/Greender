const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(':memory:');

db.serialize(() => {
  db.run('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT UNIQUE)');

  db.run('BEGIN TRANSACTION');

  db.run("INSERT INTO test(name) VALUES ('Проверка')");

  // Специально создаём ошибку
  db.run("INSERT INTO test(name) VALUES ('Проверка')", function(err) {
    if (err) {
      console.log('Ошибка:', err.message);

      db.run('ROLLBACK', function(err) {
        if (err) {
          console.log('Ошибка отката:', err.message);
          return db.close();
        }

        console.log('Откат выполнен!');

        db.all('SELECT * FROM test', (err, rows) => {
          if (err) {
            console.log(err.message);
          } else {
            console.log('Данные после отката:', rows);
            console.log('Количество записей:', rows.length);
          }
          db.close();
        });
      });
    }
  });
});