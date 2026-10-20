import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createApp} from '../server.mjs';
import {calendarBounds,openingSlots} from '../server/schedule.mjs';
import {internationalPhone,twilioTransport,VisitNotifications,newRequestEvent,notificationEvent} from '../server/sms.mjs';
import {VisitStore} from '../server/store.mjs';

function futureDate(){const start=calendarBounds().minDate;for(let offset=2;offset<10;offset++){const date=new Date(Date.parse(start+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);if(openingSlots(date).length)return date;}}
test('new request alerts and visitor decisions route correctly, enforce denial reasons and avoid duplicate messages',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'manor-sms-'));const calls=[];
 const transport={ready:()=>true,async send(channel,to,event){calls.push({channel,to,event});return {status:'queued',providerId:'SM'+String(calls.length).padStart(32,'0')};},async check(providerId){return {status:'delivered',providerId};}};
 const server=await createApp({dataDir:dir,key:randomBytes(32).toString('base64'),password:'Test-only-password-2026!',messageMode:'live',messageTransport:transport});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const client=()=>({cookie:'',csrf:'',async request(route,method='GET',body){const response=await fetch(origin+route,{method,headers:{Cookie:this.cookie,...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':this.csrf})},body:body===undefined?undefined:JSON.stringify(body)});const cookie=response.headers.get('set-cookie');if(cookie)this.cookie=cookie.split(';')[0];const data=await response.json();if(data.csrf)this.csrf=data.csrf;return {status:response.status,data};}});
 try{
  const visitor=client(),admin=client();await visitor.request('/api/session');await admin.request('/api/session');const date=futureDate();
  const booking={name:'Synthetic SMS Visitor',phone:'(210) 555-0122',reason:'general-visit',visitDate:date,visitTime:'09:00',consent:true,notificationChannels:['sms']};
  let result=await visitor.request('/api/visits','POST',booking);assert.equal(result.status,201);assert.equal(calls.length,1);assert.equal(calls[0].to,'+12025550123');assert.equal(calls[0].event.decision,'new_request');assert.equal(calls[0].event.body.includes(booking.name),false);assert.equal(calls[0].event.body.includes(booking.phone),false);
  await admin.request('/api/login','POST',{username:'admin',password:'Test-only-password-2026!'});result=await admin.request('/api/visits');const id=result.data.visits[0].id;assert.equal(result.data.visits[0].staffAlert.channels.sms.status,'queued');assert.equal(Object.hasOwn(result.data.visits[0].staffAlert,'to'),false);
  result=await admin.request('/api/visits/'+id,'PATCH',{status:'denied',denialReason:'   '});assert.equal(result.status,422);assert.equal(calls.length,1);
  result=await admin.request('/api/visits/'+id,'PATCH',{status:'accepted',visitDate:date,visitTime:'10:00'});assert.equal(result.status,200);assert.equal(calls.length,2);assert.equal(calls[1].to,'+12105550122');assert.match(calls[1].event.body,/confirmed.*10:00/);assert.match(calls[1].event.body,/Central Time/);assert.equal(result.data.visit.notifications.at(-1).channels.sms.status,'queued');
  result=await admin.request('/api/visits/'+id,'PATCH',{status:'accepted',visitDate:date,visitTime:'10:00'});assert.equal(result.status,200);assert.equal(calls.length,2);
  result=await visitor.request('/api/history');assert.equal(result.data.visits[0].visitTime,'10:00');
  const reason='The pharmacist is unavailable at the requested time.';result=await admin.request('/api/visits/'+id,'PATCH',{status:'denied',denialReason:reason});assert.equal(result.status,200);assert.equal(calls.length,3);assert.equal(calls[2].event.body.includes(reason),true);
  result=await visitor.request('/api/history');assert.equal(result.data.visits[0].denialReason,reason);
  result=await admin.request('/api/visits/'+id+'/notifications/check','POST',{});assert.equal(result.status,200);assert.equal(result.data.visit.notifications.at(-1).channels.sms.status,'delivered');assert.equal(result.data.visit.staffAlert.channels.sms.status,'delivered');
  await admin.request('/api/visits/'+id+'/notifications/retry','POST',{});assert.equal(calls.length,3);
  const home=await (await fetch(origin+'/index.html')).text();assert.equal(home.includes('2025550123'),false);assert.equal(home.includes('(210) 295-9371'),true);
 }finally{await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
});
test('preview sends nothing, missing setup is visible, and uncertain sends cannot be blindly retried',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'manor-sms-state-'));const store=new VisitStore(dir,randomBytes(32));let sends=0;
 const record={id:'a'.repeat(32),phone:'+12025550123',reference:'FS-TEST',status:'accepted',visitDate:futureDate(),visitTime:'09:00',notificationChannels:['sms'],createdAt:new Date().toISOString()};record.staffAlert=newRequestEvent(record);record.notifications=[notificationEvent(record)];
 try{
  await store.init();await store.change(rows=>rows.push(record));const transport={ready:()=>true,async send(){sends++;return {status:'unknown',error:'Timeout'};}};
  const preview=new VisitNotifications(store,{mode:'preview',transport});await preview.dispatchAlert(record.id);await preview.dispatch(record.id,record.notifications[0].id);assert.equal(sends,0);let saved=(await store.read())[0];assert.equal(saved.staffAlert.channels.sms.status,'preview');assert.equal(saved.notifications[0].channels.sms.status,'preview');
  const unavailable=new VisitNotifications(store,{mode:'live',transport:{ready:()=>false}});await unavailable.dispatchAlert(record.id,{retry:true});saved=(await store.read())[0];assert.equal(saved.staffAlert.channels.sms.status,'not_configured');
  const live=new VisitNotifications(store,{mode:'live',transport});await live.dispatchAlert(record.id,{retry:true});assert.equal(sends,1);await live.dispatchAlert(record.id,{retry:true});await live.recover();assert.equal(sends,1);
  await store.change(rows=>{rows[0].staffAlert.channels.sms={status:'sending',attempts:1};});await live.recover();assert.equal((await store.read())[0].staffAlert.channels.sms.status,'unknown');assert.equal(sends,1);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('SMS transport uses the provider API correctly and preserves queued status without exposing secrets',async()=>{
 const env={TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),TWILIO_API_KEY_SID:'SK'+'2'.repeat(32),TWILIO_API_KEY_SECRET:'not-a-real-secret',TWILIO_SMS_FROM:'+441234567890'};let sent;
 const transport=twilioTransport(env,async(url,options)=>{sent={url,options};return new Response(JSON.stringify({sid:'SM'+'3'.repeat(32),status:'queued'}),{status:201,headers:{'Content-Type':'application/json'}});});assert.equal(transport.ready(),true);assert.equal((await transport.send('sms','+12025550123',{body:'Synthetic message'})).status,'queued');assert.equal(sent.options.body.get('To'),'+12025550123');assert.equal(sent.options.body.get('From'),env.TWILIO_SMS_FROM);assert.match(sent.options.headers.Authorization,/^Basic /);
 const failing=twilioTransport(env,async()=>{throw new Error(env.TWILIO_API_KEY_SECRET);});const error=await failing.send('sms','+12025550123',{body:'Synthetic message'});assert.equal(error.status,'unknown');assert.equal(JSON.stringify(error).includes(env.TWILIO_API_KEY_SECRET),false);
 assert.equal(internationalPhone('(210) 555-0123'),'+12105550123');assert.equal(internationalPhone('+1 202 555 0123'),'+12025550123');assert.equal(internationalPhone('925984390'),null);
});
