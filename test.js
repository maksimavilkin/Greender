const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'zavoz-test-'));process.env.DB_PATH=path.join(tmp,'test.db');
const {app,schema,db}=require('./server');
(async()=>{await schema();const server=app.listen(0);const base=`http://127.0.0.1:${server.address().port}`;let n=0;
async function call(url,method='GET',body,token){const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}}
try{
let r=await call('/api/events');assert.equal(r.status,200);n++;
r=await call('/api/events','POST',{title:'test',place:'x',description:'desc'});assert.equal(r.status,401);n++;
r=await call('/api/register','POST',{name:'Тест',surname:'Первый',contact:'first@test.dev',password:'abcdefgh1'});assert.equal(r.status,201);const a=r.data;n++;
r=await call('/api/register','POST',{name:'Тест',surname:'Первый',contact:'first@test.dev',password:'abcdefgh1'});assert.equal(r.status,409);n++;
r=await call('/api/login','POST',{contact:'first@test.dev',password:'wrong'});assert.equal(r.status,401);n++;
r=await call('/api/login','POST',{contact:'first@test.dev',password:'abcdefgh1'});assert.equal(r.status,200);n++;
r=await call('/api/register','POST',{name:'Тест',surname:'Второй',contact:'second@test.dev',password:'abcdefgh1'});assert.equal(r.status,201);const b=r.data;n++;
r=await call('/api/events','POST',{title:'Тестовый день',place:'Парк',description:'Тестируем'},a.token);assert.equal(r.status,201);const id=r.data.eventId;n++;
r=await call(`/api/events/${id}/respond`,'POST',{status:'joined',userId:b.userId},a.token);assert.equal(r.status,200);n++;
r=await call(`/api/users/${a.userId}/responses`,'GET',undefined,b.token);assert.equal(r.status,403);n++;
r=await call(`/api/users/${a.userId}/responses`,'GET',undefined,a.token);assert.equal(r.data.data.length,1);n++;
r=await call(`/api/events/${id}/respond`,'DELETE',undefined,a.token);assert.equal(r.status,200);n++;
r=await call(`/api/users/${a.userId}/responses`,'GET',undefined,a.token);assert.equal(r.data.data.length,0);n++;
r=await call(`/api/events/${id}/respond`,'POST',{status:'invalid'},a.token);assert.equal(r.status,400);n++;
r=await call('/api/logout','POST',{},a.token);assert.equal(r.status,200);n++;
r=await call('/api/me','GET',undefined,a.token);assert.equal(r.status,401);n++;
console.log(`PASS: ${n} API assertions`);
}finally{server.close();db.close();fs.rmSync(tmp,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
