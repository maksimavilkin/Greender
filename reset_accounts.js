const sqlite3 = require('sqlite3').verbose();
const path = require('node:path');
const db = new sqlite3.Database(process.env.DB_PATH || path.join(__dirname, 'zavozelenye.db'));
db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON');
  db.run('BEGIN TRANSACTION');
  db.run('DELETE FROM responses');
  db.run('DELETE FROM events WHERE creator_id IS NOT NULL');
  db.run('DELETE FROM users');
  db.run('COMMIT', function(error) {
    if (error) { console.error(error); process.exitCode = 1; }
    else console.log('Аккаунты, отклики и пользовательские заявки очищены. Примерные мероприятия сохранены.');
    db.close();
  });
});
