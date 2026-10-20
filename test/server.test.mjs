import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createApp} from '../server.mjs';
import {VisitStore} from '../server/store.mjs';
import {calendarBounds,openingSlots,localClock} from '../server/schedule.mjs';
function futureDate(){const start=calendarBounds().minDate;for(let offset=2;offset<10;offset++){const date=new Date(Date.parse(start+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);if(openingSlots(date).length)return date;}throw new Error('No future date');}

test('visit requests are validated, encrypted, private and managed only by an authenticated admin',async()=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'manor-test-'));const key=randomBytes(32);const password='Test-only-password-2026!';
 let server=await createApp({dataDir,key:key.toString('base64'),password,visitLimit:50});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let origin='http://127.0.0.1:'+server.address().port;
 let cookie='';let csrf='';
 const request=async(route,{method='GET',body,token=csrf,withCookie=true,requestOrigin=origin}={})=>{
   const response=await fetch(origin+route,{method,headers:{...(withCookie&&cookie?{Cookie:cookie}:{}),...(method!=='GET'?{'Content-Type':'application/json','Origin':requestOrigin,'X-CSRF-Token':token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
   const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
   return {response,data:await response.json()};
 };
 try{
  let result=await request('/api/visits');assert.equal(result.response.status,401);
  result=await request('/api/session');csrf=result.data.csrf;assert.equal(result.data.authenticated,false);assert.match(result.response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  const valid={name:'Synthetic Demo Visitor',phone:'(210) 555-0123',reason:'general-visit',visitDate:futureDate(),visitTime:'09:00',consent:true};
  result=await request('/api/visits',{method:'POST',body:valid,token:'wrong'});assert.equal(result.response.status,403);
  result=await request('/api/visits',{method:'POST',body:valid,requestOrigin:'https://another.example'});assert.equal(result.response.status,403);
  for(const mutation of [{phone:'abc'},{name:'<script>'},{reason:'not-a-service'},{consent:false},{visitDate:'2020-01-01'},{visitTime:'03:00'}]){result=await request('/api/visits',{method:'POST',body:{...valid,...mutation}});assert.equal(result.response.status,422);}
  result=await request('/api/visits',{method:'POST',body:valid});assert.equal(result.response.status,201);assert.match(result.data.reference,/^FS-/);assert.equal(Object.hasOwn(result.data,'name'),false);const historyCode=result.data.historyCode;assert.match(historyCode,/^FS-/);
  const disk=await fs.readFile(path.join(dataDir,'visits.enc'),'utf8');assert.equal(disk.includes(valid.name),false);assert.equal(disk.includes(valid.phone),false);
  result=await request('/.private/visits.enc');assert.equal(result.response.status,404);
  result=await request('/server.mjs');assert.equal(result.response.status,404);
  result=await request('/api/visits');assert.equal(result.response.status,401);
  result=await request('/api/session');csrf=result.data.csrf;
  result=await request('/api/login',{method:'POST',body:{username:'admin',password:'wrong'}});assert.equal(result.response.status,401);
  const anonymousCookie=cookie;
  result=await request('/api/login',{method:'POST',body:{username:'admin',password}});assert.equal(result.response.status,200);assert.notEqual(cookie,anonymousCookie);csrf=result.data.csrf;
  result=await request('/api/visits');assert.equal(result.data.visits.length,1);const visit=result.data.visits[0];assert.equal(visit.name,valid.name);assert.equal(Object.hasOwn(visit,'historyHash'),false);
  result=await request('/api/visits/'+visit.id,{method:'PATCH',body:{status:'invalid'}});assert.equal(result.response.status,422);
  result=await request('/api/visits/'+visit.id,{method:'PATCH',body:{status:'contacted'}});assert.equal(result.response.status,200);assert.equal(result.data.visit.status,'contacted');
  await new Promise(resolve=>server.close(resolve));
  server=await createApp({dataDir,key:key.toString('base64'),password});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  result=await request('/api/visits');assert.equal(result.response.status,401);
  cookie='';result=await request('/api/session');csrf=result.data.csrf;result=await request('/api/login',{method:'POST',body:{username:'admin',password}});csrf=result.data.csrf;
  result=await request('/api/visits');assert.equal(result.data.visits.length,1);assert.equal(result.data.visits[0].status,'contacted');
  result=await request('/api/history/login',{method:'POST',body:{phone:valid.phone,code:historyCode}});assert.equal(result.response.status,200);csrf=result.data.csrf;result=await request('/api/history');assert.equal(result.data.visits.length,1);
  result=await request('/api/visits/'+visit.id,{method:'DELETE',body:{}});assert.equal(result.response.status,200);
  result=await request('/api/visits');assert.equal(result.data.visits.length,0);
  result=await request('/api/logout',{method:'POST',body:{}});assert.equal(result.response.status,200);result=await request('/api/visits');assert.equal(result.response.status,401);
 }finally{await new Promise(resolve=>server.close(resolve));await fs.rm(dataDir,{recursive:true,force:true});}
});

test('encrypted storage serialises concurrent writes and removes expired requests',async()=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'manor-store-'));const store=new VisitStore(dataDir,randomBytes(32));
 try{
  await store.init();await Promise.all(Array.from({length:12},(_,i)=>store.change(rows=>rows.push({id:i,createdAt:new Date().toISOString()}))));assert.equal((await store.read()).length,12);
  await store.change(rows=>rows.push({id:'expired',createdAt:new Date(Date.now()-31*24*60*60*1000).toISOString()}));await store.change(()=>{});assert.equal((await store.read()).length,12);
 }finally{await fs.rm(dataDir,{recursive:true,force:true});}
});

test('production refuses missing credentials, insecure origins and public data storage',async()=>{
 await assert.rejects(createApp({password:'short',key:randomBytes(32).toString('base64')}),/ADMIN_PASSWORD/);
 await assert.rejects(createApp({password:'Test-Only-Password-2026!',key:'invalid'}),/DATA_KEY/);
 await assert.rejects(createApp({password:'Test-Only-Password-2026!',key:randomBytes(32).toString('base64'),production:true,origin:'http://example.com'}),/APP_ORIGIN/);
 await assert.rejects(createApp({password:'Test-Only-Password-2026!',key:randomBytes(32).toString('base64'),dataDir:path.resolve('dist/private'),publicRoot:path.resolve('dist')}),/outside/);
});

async function withBookingApp(run){
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'manor-booking-'));const server=await createApp({dataDir,key:randomBytes(32).toString('base64'),password:'Test-only-password-2026!',visitLimit:100});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const client=()=>({cookie:'',csrf:'',async request(route,method='GET',body){const response=await fetch(origin+route,{method,headers:{Cookie:this.cookie,...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':this.csrf})},body:body===undefined?undefined:JSON.stringify(body)});const setCookie=response.headers.get('set-cookie');if(setCookie)this.cookie=setCookie.split(';')[0];const data=await response.json();if(data.csrf)this.csrf=data.csrf;return {status:response.status,data};},async session(){return this.request('/api/session');}});
 try{await run(client);}finally{await new Promise(resolve=>server.close(resolve));await fs.rm(dataDir,{recursive:true,force:true});}
}
const booking=(name,phone,date,time='09:00')=>({name,phone,reason:'general-visit',visitDate:date,visitTime:time,consent:true});

test('visitor history needs the private code, isolates the same phone number and keeps signed-in repeat visits together',async()=>withBookingApp(async client=>{
 const first=client(),second=client(),reader=client();await first.session();await second.session();await reader.session();const date=futureDate();
 let result=await first.request('/api/visits','POST',booking('Synthetic Visitor A','(210) 555-0123',date));assert.equal(result.status,201);const code=result.data.historyCode;const firstReference=result.data.reference;
 result=await second.request('/api/visits','POST',booking('Synthetic Visitor B','(210) 555-0123',date,'09:30'));assert.equal(result.status,201);const secondReference=result.data.reference;
 result=await second.request('/api/history');assert.deepEqual(result.data.visits.map(visit=>visit.reference),[secondReference]);assert.equal(result.data.visits.some(visit=>visit.reference===firstReference),false);
 result=await reader.request('/api/history');assert.equal(result.status,401);
 result=await reader.request('/api/history/login','POST',{phone:'(210) 555-0123',code:'incorrect'});assert.equal(result.status,401);
 result=await reader.request('/api/history/login','POST',{phone:'(210) 555-0199',code});assert.equal(result.status,401);
 result=await reader.request('/api/history/login','POST',{phone:'+1 210 555 0123',code});assert.equal(result.status,200);
 result=await reader.request('/api/history');assert.deepEqual(result.data.visits.map(visit=>visit.reference),[firstReference]);assert.equal(Object.hasOwn(result.data.visits[0],'id'),false);assert.equal(Object.hasOwn(result.data.visits[0],'phone'),false);assert.equal(Object.hasOwn(result.data.visits[0],'historyHash'),false);
 result=await reader.request('/api/visits','POST',booking('Synthetic Visitor A','+1 210 555 0123',date,'10:00'));assert.equal(result.status,201);assert.equal(result.data.historyCode,undefined);
 result=await reader.request('/api/history');assert.equal(result.data.visits.length,2);await reader.session();
 result=await reader.request('/api/history/logout','POST',{});assert.equal(result.status,200);result=await reader.request('/api/history');assert.equal(result.status,401);
}));

test('accept/deny decisions reach visitor history and concurrent acceptance cannot double-book a slot',async()=>withBookingApp(async client=>{
 const first=client(),second=client(),admin=client(),third=client();for(const person of [first,second,admin,third])await person.session();const date=futureDate();
 const a=await first.request('/api/visits','POST',booking('Synthetic Slot A','(210) 555-0101',date));const b=await second.request('/api/visits','POST',booking('Synthetic Slot B','(210) 555-0102',date));assert.equal(a.status,201);assert.equal(b.status,201);
 let result=await admin.request('/api/login','POST',{username:'admin',password:'Test-only-password-2026!'});assert.equal(result.status,200);result=await admin.request('/api/visits');const rows=result.data.visits;
 const outcomes=await Promise.all(rows.map(row=>admin.request('/api/visits/'+row.id,'PATCH',{status:'accepted'})));assert.deepEqual(outcomes.map(outcome=>outcome.status).sort(),[200,409]);
 result=await admin.request('/api/visits');const accepted=result.data.visits.find(row=>row.status==='accepted');const pending=result.data.visits.find(row=>row.status==='new');assert.ok(accepted);assert.ok(pending);
 result=await third.request('/api/availability?date='+date);assert.equal(result.data.slots.includes('09:00'),false);
 result=await third.request('/api/visits','POST',booking('Synthetic Slot C','(210) 555-0103',date));assert.equal(result.status,409);
 result=await admin.request('/api/visits/'+pending.id,'PATCH',{status:'denied',denialReason:'The requested time is no longer available.'});assert.equal(result.status,200);
 const firstHistory=(await first.request('/api/history')).data.visits[0];const secondHistory=(await second.request('/api/history')).data.visits[0];assert.deepEqual([firstHistory.status,secondHistory.status].sort(),['accepted','denied']);
 result=await admin.request('/api/visits/'+accepted.id,'PATCH',{status:'denied',denialReason:'Please contact the team to arrange another time.'});assert.equal(result.status,200);result=await third.request('/api/availability?date='+date);assert.equal(result.data.slots.includes('09:00'),true);
 result=await admin.request('/api/admin/reauth','POST',{});assert.equal(result.status,200);result=await admin.request('/api/visits');assert.equal(result.status,401);
 result=await admin.request('/api/login','POST',{username:'admin',password:''});assert.equal(result.status,401);result=await admin.request('/api/login','POST',{username:'admin',password:'Test-only-password-2026!'});assert.equal(result.status,200);
}));

test('visit slots obey Central Time dates, weekly closing times and daylight-saving changes',()=>{
 const now=new Date('2026-09-29T07:00:00Z');assert.equal(openingSlots('2026-10-01',now).at(-1),'16:30');assert.equal(openingSlots('2026-10-03',now).at(-1),'14:30');assert.equal(openingSlots('2026-10-02',now).at(-1),'16:30');assert.deepEqual(openingSlots('2026-10-04',now),[]);assert.deepEqual(openingSlots('2026-02-30',now),[]);
 assert.equal(localClock(new Date('2026-11-01T04:30:00Z')).date,'2026-10-31');assert.deepEqual(openingSlots('2026-10-25',new Date('2026-10-24T23:30:00Z')),[]);assert.equal(openingSlots('2026-10-26',new Date('2026-10-24T23:30:00Z'))[0],'09:00');
});

test('future visits remain retained until 30 days after the requested date',async()=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'manor-retention-'));const store=new VisitStore(dataDir,randomBytes(32));try{await store.init();await store.change(rows=>rows.push({id:'future',createdAt:new Date(Date.now()-31*86400000).toISOString(),retentionUntil:new Date(Date.now()+10*86400000).toISOString()}));await store.change(()=>{});assert.equal((await store.read()).length,1);}finally{await fs.rm(dataDir,{recursive:true,force:true});}
});
