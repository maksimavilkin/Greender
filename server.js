const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('node:crypto');
const path = require('node:path');
const locations = require('./locations.json');
const nodemailer = require('nodemailer');
const app = express();
const PORT = Number(process.env.PORT || 3000);
const db = new sqlite3.Database(process.env.DB_PATH || path.join(__dirname, 'zavozelenye.db'));
db.run('PRAGMA foreign_keys = ON');
app.disable('x-powered-by');
app.use(express.json({limit:'32kb'}));
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','DENY');next()});
app.use(express.static(__dirname, { index: 'index.html' }));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.get('/index.html',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.get('/style.css',(req,res)=>res.sendFile(path.join(__dirname,'style.css')));
const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,function(e){e?reject(e):resolve(this)}));
const get=(sql,args=[])=>new Promise((resolve,reject)=>db.get(sql,args,(e,r)=>e?reject(e):resolve(r)));
const all=(sql,args=[])=>new Promise((resolve,reject)=>db.all(sql,args,(e,r)=>e?reject(e):resolve(r)));
const tokens=new Map();
const attempts=new Map();
const clean=(v,max=250)=>typeof v==='string'?v.trim().slice(0,max):'';
const validId=v=>Number.isSafeInteger(Number(v))&&Number(v)>0;
function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')) {return `scrypt$${salt}$${crypto.scryptSync(password,salt,64).toString('hex')}`}
function verify(password,stored){if(!stored?.startsWith('scrypt$'))return false;const [,salt,hex]=stored.split('$');if(!salt||!hex||hex.length!==128)return false;const a=Buffer.from(hex,'hex');return crypto.timingSafeEqual(a,crypto.scryptSync(password,salt,64))}
function issue(user){const token=crypto.randomBytes(32).toString('hex');tokens.set(token,{id:user.id,expires:Date.now()+7*86400000});return token}
function auth(req,res,next){const token=(req.get('authorization')||'').replace(/^Bearer /i,'');const s=tokens.get(token);if(!s||s.expires<Date.now()){tokens.delete(token);return res.status(401).json({error:'Требуется вход в аккаунт'})}req.userId=s.id;req.token=token;next()}
function safe(fn){return(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(e=>{console.error(e);res.status(500).json({error:'Ошибка сервера'})})}
const schema=async()=>{
await run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,surname TEXT,patronymic TEXT,contact TEXT UNIQUE,password TEXT)`);
await run(`CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT,place TEXT,time TEXT,direction TEXT,people TEXT,description TEXT,icon TEXT,creator_id INTEGER,FOREIGN KEY(creator_id) REFERENCES users(id))`);
const cols=await all('PRAGMA table_info(events)');
if(!cols.some(c=>c.name==='city'))await run("ALTER TABLE events ADD COLUMN city TEXT NOT NULL DEFAULT 'Москва'");
if(!cols.some(c=>c.name==='district'))await run("ALTER TABLE events ADD COLUMN district TEXT NOT NULL DEFAULT 'Не указан'");
await run("UPDATE events SET city='Москва' WHERE city IS NULL OR TRIM(city)=''");
await run("UPDATE events SET district=CASE WHEN place LIKE '%Битцев%' THEN 'Ясенево' WHEN place LIKE '%приют%' THEN 'Бибирево' ELSE 'Тверской' END WHERE district='Не указан' AND creator_id IS NULL");
await run(`CREATE TABLE IF NOT EXISTS password_resets (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id))`);
await run(`CREATE TABLE IF NOT EXISTS responses (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,event_id INTEGER,status TEXT,UNIQUE(user_id,event_id),FOREIGN KEY(user_id) REFERENCES users(id),FOREIGN KEY(event_id) REFERENCES events(id))`);
// Convert existing plaintext passwords once. Back up the DB before deployment.
const users=await all('SELECT id,password FROM users');for(const u of users)if(u.password&&!u.password.startsWith('scrypt$'))await run('UPDATE users SET password=? WHERE id=?',[hashPassword(u.password),u.id]);
if((await get('SELECT COUNT(*) AS n FROM events')).n===0){for(const e of [
['Чистый парк','Центральный парк','Сб, 10 окт, 11:00','Уборка парков','16 человек','Соберём мусор...','fa-solid fa-tree'],
['Помощь в приюте','Приют для животных','Вс, 11 окт, 12:00','Помощь животным','8 человек','Погуляем с собаками...','fa-solid fa-paw'],
['Посадка деревьев','Битцевский парк','Сб, 17 окт, 10:00','Озеленение','25 человек','Посадим молодые деревья...','fa-solid fa-seedling']])await run('INSERT INTO events(title,place,time,direction,people,description,icon) VALUES(?,?,?,?,?,?,?)',e)}
// Добавляем 10 демонстрационных московских событий один раз, не затрагивая заявки пользователей.
await run('CREATE TABLE IF NOT EXISTS app_migrations (key TEXT PRIMARY KEY)');
if(!await get('SELECT key FROM app_migrations WHERE key=?',['moscow_demo_10_v1'])){
  const demos=[
    ['Уборка на Патриарших прудах','Патриаршие пруды','Пресненский','Уборка парков','12 человек','Поможем убрать мусор вокруг прудов.','fa-solid fa-broom'],
    ['Озеленение двора в Хамовниках','Двор у Комсомольского проспекта','Хамовники','Озеленение','10 человек','Высадим растения во дворе вместе с соседями.','fa-solid fa-seedling'],
    ['Сбор макулатуры на Арбате','Общественный пункт сбора','Арбат','Переработка','5 человек','Поможем сортировать бумагу и картон.','fa-solid fa-recycle'],
    ['Уборка берега в Строгино','Строгинская пойма','Строгино','Уборка территорий','15 человек','Уберём мусор с берега, не заходя в воду.','fa-solid fa-water'],
    ['Помощь приюту в Бибиреве','Пункт помощи животным','Бибирево','Помощь животным','8 человек','Соберём необходимые вещи для животных.','fa-solid fa-paw'],
    ['Посадка кустарников в Раменках','Районный сквер','Раменки','Озеленение','12 человек','Поможем озеленить общественное пространство.','fa-solid fa-tree'],
    ['Раздельный сбор в Марьино','Экопункт района','Марьино','Переработка','6 человек','Подскажем жителям, как сортировать вторсырьё.','fa-solid fa-recycle'],
    ['Чистые дорожки в Измайлове','Измайловский парк','Измайлово','Уборка парков','18 человек','Уберём мусор вдоль прогулочных дорожек.','fa-solid fa-leaf'],
    ['Экоурок для соседей','Библиотека района','Тёплый Стан','Просвещение','4 человека','Поможем подготовить материалы об экологии.','fa-solid fa-book'],
    ['Сбор вещей на благотворительность','Районный центр','Кунцево','Помощь людям','7 человек','Поможем рассортировать собранные вещи.','fa-solid fa-hands-holding-heart']
  ];
  await run('BEGIN TRANSACTION');
  try {
    for(const e of demos) await run('INSERT INTO events(title,place,district,direction,people,description,icon,city,time) VALUES(?,?,?,?,?,?,?,?,?)',[e[0],e[1],e[2],e[3],e[4],e[5],e[6],'Москва','По договорённости']);
    await run('INSERT INTO app_migrations(key) VALUES(?)',['moscow_demo_10_v1']);
    await run('COMMIT');
  } catch(e){await run('ROLLBACK');throw e}
}
};
app.post('/api/register',safe(async(req,res)=>{const{name,surname,patronymic,contact,password}=req.body||{};const c=clean(contact,150).toLowerCase();if(!clean(name,80)||!clean(surname,80)||c.length<3||typeof password!=='string'||password.length<8||password.length>128)return res.status(400).json({error:'Укажите имя, фамилию, контакт и пароль от 8 до 128 символов'});try{const r=await run('INSERT INTO users(name,surname,patronymic,contact,password) VALUES(?,?,?,?,?)',[clean(name,80),clean(surname,80),clean(patronymic,80),c,hashPassword(password)]);res.status(201).json({success:true,userId:r.lastID,token:issue({id:r.lastID})})}catch(e){if(e.code==='SQLITE_CONSTRAINT')return res.status(409).json({error:'Контакт уже зарегистрирован'});throw e}}));
app.post('/api/login',safe(async(req,res)=>{const c=clean(req.body?.contact,150).toLowerCase();const password=req.body?.password;const key=req.ip+':'+c;const entry=attempts.get(key)||{count:0,until:0};if(entry.until>Date.now())return res.status(429).json({error:'Слишком много попыток. Повторите позже'});const user=await get('SELECT id,name,password FROM users WHERE contact=?',[c]);if(typeof password!=='string'||!user||!verify(password,user.password)){entry.count++;if(entry.count>=8){entry.until=Date.now()+15*60000;entry.count=0}attempts.set(key,entry);return res.status(401).json({error:'Неверный логин или пароль'})}attempts.delete(key);res.json({success:true,user:{id:user.id,name:user.name},token:issue(user)})}));
const resetAttempts=new Map();
app.post('/api/password/forgot',safe(async(req,res)=>{
 const email=clean(req.body?.email,150).toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Укажите адрес электронной почты'});
 const key=req.ip+':'+email;const last=resetAttempts.get(key)||0;
 if(Date.now()-last<60000)return res.json({message:'Если эта почта зарегистрирована, ссылка для восстановления будет отправлена.'});
 resetAttempts.set(key,Date.now());
 const message='Если эта почта зарегистрирована, ссылка для восстановления будет отправлена.';
 const user=await get('SELECT id FROM users WHERE contact=?',[email]);
 if(!user)return res.json({message});
 if(!process.env.SMTP_HOST||!process.env.SMTP_USER||!process.env.SMTP_PASS||!process.env.SMTP_FROM){console.error('Password reset email is not configured');return res.status(503).json({error:'Восстановление пароля временно недоступно. Администратору нужно настроить SMTP.'});}
 const token=crypto.randomBytes(32).toString('hex');const tokenHash=crypto.createHash('sha256').update(token).digest('hex');
 const transporter=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||465),secure:Number(process.env.SMTP_PORT||465)===465,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
 const base=(process.env.PUBLIC_URL||`${req.protocol}://${req.get('host')}`).replace(/\/$/,'');
 await run('DELETE FROM password_resets WHERE user_id=? OR expires<?',[user.id,Date.now()]);
 await run('INSERT INTO password_resets(token_hash,user_id,expires) VALUES(?,?,?)',[tokenHash,user.id,Date.now()+20*60000]);
 try{await transporter.sendMail({from:process.env.SMTP_FROM,to:email,subject:'ЗавоЗеленые: восстановление пароля',text:`Чтобы сменить пароль, откройте ссылку (действует 20 минут): ${base}/?reset_token=${token}\nЕсли вы не запрашивали смену пароля, просто проигнорируйте письмо.`});}
 catch(e){console.error('SMTP error:',e.message);return res.status(503).json({error:'Не удалось отправить письмо. Попробуйте позже.'});}
 res.json({message});
}));
app.post('/api/password/reset',safe(async(req,res)=>{
 const token=clean(req.body?.token,128),password=req.body?.password;
 if(!/^[a-f0-9]{64}$/.test(token)||typeof password!=='string'||password.length<8||password.length>128)return res.status(400).json({error:'Некорректная ссылка или пароль (8-128 символов)'});
 const hash=crypto.createHash('sha256').update(token).digest('hex');const entry=await get('SELECT user_id,expires FROM password_resets WHERE token_hash=?',[hash]);
 if(!entry||entry.expires<Date.now())return res.status(400).json({error:'Ссылка недействительна или срок действия истёк'});
 await run('BEGIN TRANSACTION');try{await run('UPDATE users SET password=? WHERE id=?',[hashPassword(password),entry.user_id]);await run('DELETE FROM password_resets WHERE user_id=?',[entry.user_id]);await run('COMMIT');}catch(e){await run('ROLLBACK');throw e}
 for(const [t,s] of tokens)if(s.id===entry.user_id)tokens.delete(t);
 res.json({message:'Пароль изменён. Теперь можно войти с новым паролем.'});
}));
app.post('/api/logout',auth,(req,res)=>{tokens.delete(req.token);res.json({success:true})});
app.get('/api/me',auth,safe(async(req,res)=>{const user=await get('SELECT id,name,surname,contact FROM users WHERE id=?',[req.userId]);res.json({success:true,user})}));
app.get('/api/events',safe(async(req,res)=>res.json({success:true,data:await all('SELECT * FROM events ORDER BY id DESC')})));
app.post('/api/events',auth,safe(async(req,res)=>{const b=req.body||{};const city=clean(b.city,80);const district=clean(b.district,100);if(!locations[city]||!district||(!locations[city].includes(district) && (district.length<2 || district.length>100)))return res.status(400).json({error:'Укажите город и район'});if(!clean(b.title,120)||!clean(b.place,180)||!clean(b.description,2000))return res.status(400).json({error:'Укажите название, место и описание'});const r=await run('INSERT INTO events(title,place,time,direction,people,description,icon,creator_id,city,district) VALUES(?,?,?,?,?,?,?,?,?,?)',[clean(b.title,120),clean(b.place,180),clean(b.time,100)||'По договорённости',clean(b.direction,100)||'Новая заявка',clean(b.people,80)||'Не указано',clean(b.description,2000),'fa-solid fa-hands-holding-circle',req.userId,city,district]);res.status(201).json({success:true,eventId:r.lastID})}));
app.get('/api/my/events',auth,safe(async(req,res)=>res.json({success:true,data:await all('SELECT * FROM events WHERE creator_id=? ORDER BY id DESC',[req.userId])})));
app.delete('/api/my/events/:id',auth,safe(async(req,res)=>{if(!validId(req.params.id))return res.status(400).json({error:'Некорректный ID'});const event=await get('SELECT id FROM events WHERE id=? AND creator_id=?',[req.params.id,req.userId]);if(!event)return res.status(404).json({error:'Заявка не найдена или нет прав'});await run('BEGIN TRANSACTION');try{await run('DELETE FROM responses WHERE event_id=?',[event.id]);await run('DELETE FROM events WHERE id=? AND creator_id=?',[event.id,req.userId]);await run('COMMIT')}catch(e){await run('ROLLBACK');throw e}res.json({success:true})}));
app.post('/api/events/:id/respond',auth,safe(async(req,res)=>{if(!validId(req.params.id)||!['liked','joined'].includes(req.body?.status))return res.status(400).json({error:'Некорректный запрос'});const target=await get('SELECT id,creator_id FROM events WHERE id=?',[req.params.id]);if(!target)return res.status(404).json({error:'Мероприятие не найдено'});if(target.creator_id!=null && Number(target.creator_id)===req.userId)return res.status(403).json({error:'Нельзя откликнуться на собственную заявку'});await run('INSERT INTO responses(user_id,event_id,status) VALUES(?,?,?) ON CONFLICT(user_id,event_id) DO UPDATE SET status=excluded.status',[req.userId,req.params.id,req.body.status]);res.json({success:true})}));
app.get('/api/users/:id/responses',auth,safe(async(req,res)=>{if(Number(req.params.id)!==req.userId)return res.status(403).json({error:'Доступ запрещён'});res.json({success:true,data:await all('SELECT e.*,r.status FROM events e JOIN responses r ON e.id=r.event_id WHERE r.user_id=? ORDER BY r.id DESC',[req.userId])})}));
app.delete('/api/events/:id/respond',auth,safe(async(req,res)=>{if(!validId(req.params.id))return res.status(400).json({error:'Некорректный ID'});await run('DELETE FROM responses WHERE user_id=? AND event_id=?',[req.userId,req.params.id]);res.json({success:true})}));
app.use('/api',(req,res)=>res.status(404).json({error:'API не найден'}));
if(require.main===module)schema().then(()=>app.listen(PORT,'::',()=>console.log(`Zavozelenye слушает [::]:${PORT}`))).catch(e=>{console.error(e);process.exit(1)});
module.exports={app,schema,db};
