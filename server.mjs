import http from 'node:http';
import {business} from './business.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,scryptSync,timingSafeEqual,createHash,createHmac} from 'node:crypto';
import {VisitStore} from './server/store.mjs';
import {createReviewsApi} from './server/reviews.mjs';
import {calendarBounds,openingSlots,slotBlocked,retentionUntil,validDate} from './server/schedule.mjs';
import {VisitNotifications,notificationEvent,notificationChannels,newRequestEvent,DEFAULT_ALERT_PHONE,internationalPhone} from './server/sms.mjs';

const directory=path.dirname(fileURLToPath(import.meta.url));
export const REASONS=Object.freeze(business.reasons);
const statuses=new Set(['new','contacted','accepted','denied','completed']);
const allowedFiles=new Set(['index.html','services.html','about.html','helpful-answers.html','history.html','admin.html','styles.css','pages.css','details.css','visit.css','history.css','admin.css','app.js','visit.js','history.js','admin.js','reviews.js','reviews.css','reviews-admin.js','assets/favicon.svg','assets/fort-sam-logo.svg','assets/pharmacy-team.jpg','assets/pharmacy-shelves.jpg','assets/pharmacy-counter.jpg']);
const normalPhone=value=>internationalPhone(value)?.slice(1)||String(value||'').replace(/\D/g,'');
const normalCode=value=>String(value||'').replace(/[\s-]/g,'').toUpperCase();
const publicStatus=value=>value==='contacted'?'new':value;
const adminVisit=record=>{const {historyHash,phoneKey,staffAlert,...details}=record;const {to,...alert}=staffAlert||{};return {...details,...(staffAlert?{staffAlert:alert}:{})};};
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg','.svg':'image/svg+xml'};
const equal=(left,right)=>{const a=Buffer.from(String(left||''));const b=Buffer.from(String(right||''));return a.length===b.length&&timingSafeEqual(a,b);};
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
const fail=(status,message)=>Object.assign(new Error(message),{status});
async function readJson(req){
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw fail(415,'Use a JSON request.');
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>4096)throw fail(413,'Request too large.');chunks.push(chunk);}
  try{const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!body||typeof body!=='object'||Array.isArray(body))throw new Error();return body;}catch{throw fail(400,'The request could not be read.');}
}
export async function createApp(options={}){
  const production=options.production??process.env.NODE_ENV==='production';
  const password=options.password??process.env.ADMIN_PASSWORD;
  const username=options.username??process.env.ADMIN_USERNAME??'admin';
  const keyString=options.key??process.env.DATA_KEY;
  const origin=options.origin??process.env.APP_ORIGIN;
  const key=Buffer.from(keyString||'','base64');
  if(typeof password!=='string'||password.length<8)throw new Error('Set ADMIN_PASSWORD to a password of at least 8 characters.');
  if(production&&password.startsWith('REPLACE_'))throw new Error('Replace the ADMIN_PASSWORD placeholder before deployment.');
  if(key.length!==32)throw new Error('Set DATA_KEY to a base64-encoded 32-byte encryption key.');
  if(production&&(!origin||!/^https:\/\//.test(origin)))throw new Error('Set APP_ORIGIN to the exact HTTPS website origin in production.');
  if(production&&!options.alertPhone&&!process.env.PHARMACY_ALERT_PHONE)throw new Error('Set PHARMACY_ALERT_PHONE privately in the hosting environment.');
  const publicRoot=path.resolve(options.publicRoot??path.join(directory,'dist'));
  const publicFiles=new Set([...allowedFiles,...(!production?(options.previewFiles??[]):[])]);
  const dataDir=path.resolve(options.dataDir??process.env.DATA_DIR??path.join(directory,'.private'));
  if(dataDir===publicRoot||dataDir.startsWith(publicRoot+path.sep))throw new Error('DATA_DIR must be outside the public website directory.');
  const store=new VisitStore(dataDir,key);await store.init();await store.change(()=>{});
  const notifications=new VisitNotifications(store,{mode:options.messageMode??process.env.MESSAGE_MODE??'preview',alertPhone:options.alertPhone??process.env.PHARMACY_ALERT_PHONE??DEFAULT_ALERT_PHONE,...(options.messageTransport?{transport:options.messageTransport}:{})});
  await notifications.recover();
  const fingerprint=(kind,value)=>createHmac('sha256',key).update(kind+':'+value).digest('hex');
  const salt=randomBytes(16);const expectedPassword=scryptSync(password,salt,64);
  const sessions=new Map();const rates=new Map();const rateSalt=randomBytes(32);
  const trustProxy=options.trustProxy??process.env.TRUST_PROXY==='1';
  const rate=(req,kind,maximum,windowMs)=>{
    const address=trustProxy?String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',')[0].trim():req.socket.remoteAddress;
    const id=kind+createHash('sha256').update(rateSalt).update(String(address)).digest('hex');
    let entry=rates.get(id);if(!entry||entry.reset<Date.now()){entry={count:0,reset:Date.now()+windowMs};rates.set(id,entry);}
    entry.count++;if(entry.count>maximum)throw fail(429,'Too many attempts. Please try again later or call the pharmacy.');
  };
  const reviewApi=await createReviewsApi({directory:dataDir,key,rate,readJson,fail,json});
  const newSession=(res,admin=false,visitor=null)=>{
    const id=randomBytes(32).toString('hex');const value={csrf:randomBytes(32).toString('hex'),admin,visitor,created:Date.now(),last:Date.now()};
    sessions.set(id,value);res.setHeader('Set-Cookie',`manor_session=${id}; HttpOnly; SameSite=Strict; Path=/api${production?'; Secure':''}`);return {id,value};
  };
  const getSession=(req,touch=true)=>{
    const id=String(req.headers.cookie||'').split(';').map(part=>part.trim()).find(part=>part.startsWith('manor_session='))?.slice(14);
    const value=sessions.get(id);
    if(!value||Date.now()-value.last>30*60*1000||Date.now()-value.created>12*60*60*1000){if(id)sessions.delete(id);return null;}
    if(touch)value.last=Date.now();return {id,value};
  };
  const security={
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'SAMEORIGIN',
    'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-src 'self' https://maps.google.com https://www.google.com; form-action 'self'; base-uri 'none'; frame-ancestors 'self'; object-src 'none'"
  };
  const server=http.createServer(async(req,res)=>{
    for(const [header,value] of Object.entries(security))res.setHeader(header,value);
    if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
    try{
      const url=new URL(req.url,'http://localhost');const route=decodeURIComponent(url.pathname);
      if(route.startsWith('/api/')){
        res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Cookie');
        if(req.method==='GET'&&route==='/api/availability'){
          rate(req,'availability',180,60*1000);const date=url.searchParams.get('date');const bounds=calendarBounds();
          if(!date)return json(res,200,bounds);
          if(!validDate(date))throw fail(422,'Choose a valid date.');
          const rows=await store.change(rows=>rows);const slots=openingSlots(date).filter(time=>!slotBlocked(rows,date,time));
          return json(res,200,{...bounds,date,slots});
        }
        if(req.method==='GET'&&route==='/api/session'){
          rate(req,'session',180,60*1000);const session=getSession(req)||newSession(res);
          return json(res,200,{authenticated:session.value.admin,visitorAuthenticated:Boolean(session.value.visitor),csrf:session.value.csrf,username:session.value.admin?username:undefined,retentionDays:30,smsAvailable:notifications.mode==='live'&&notifications.configuration().sms});
        }
        const session=getSession(req,url.searchParams.get('background')!=='1');
        if(req.method!=='GET'){
          const expectedOrigin=origin||`http://${req.headers.host}`;
          if(!equal(req.headers.origin,expectedOrigin))throw fail(403,'This request must come from the pharmacy website.');
          if(!session||!equal(req.headers['x-csrf-token'],session.value.csrf))throw fail(403,'Your session has expired. Refresh the page and try again.');
        }
        if(await reviewApi.handle(req,res,{route,session}))return;
        if(req.method==='POST'&&route==='/api/login'){
          rate(req,'login',10,15*60*1000);const body=await readJson(req);
          if(typeof body.password!=='string'||body.password.length>256)throw fail(401,'The username or password is incorrect.');
          const candidate=scryptSync(body.password,salt,64);
          if(!timingSafeEqual(candidate,expectedPassword)||!equal(body.username,username))throw fail(401,'The username or password is incorrect.');
          sessions.delete(session.id);const next=newSession(res,true,session.value.visitor);return json(res,200,{authenticated:true,csrf:next.value.csrf,username});
        }
        if(req.method==='POST'&&route==='/api/admin/reauth'){
          const visitor=session.value.visitor;sessions.delete(session.id);const next=newSession(res,false,visitor);return json(res,200,{csrf:next.value.csrf});
        }
        if(req.method==='POST'&&route==='/api/history/login'){
          rate(req,'history-login',10,15*60*1000);const body=await readJson(req);
          if(typeof body.phone!=='string'||body.phone.length>25||typeof body.code!=='string'||body.code.length>80)throw fail(401,'The phone number or history code is incorrect.');
          const phoneKey=fingerprint('phone',normalPhone(body.phone));const historyHash=fingerprint('history',normalCode(body.code));
          const exists=await store.change(rows=>rows.some(row=>equal(row.phoneKey,phoneKey)&&equal(row.historyHash,historyHash)));
          if(!exists)throw fail(401,'The phone number or history code is incorrect.');
          sessions.delete(session.id);const next=newSession(res,session.value.admin,{phoneKey,historyHash});return json(res,200,{csrf:next.value.csrf});
        }
        if(req.method==='GET'&&route==='/api/history'){
          if(!session?.value.visitor)throw fail(401,'Enter your phone number and history code to view your visits.');
          const visitor=session.value.visitor;const records=await store.change(rows=>rows.filter(row=>equal(row.phoneKey,visitor.phoneKey)&&equal(row.historyHash,visitor.historyHash)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));
          const visits=records.map(({reference,name,reason,status,visitDate,visitTime,denialReason,createdAt,updatedAt})=>({reference,name,reason,status:publicStatus(status),visitDate,visitTime,denialReason:status==='denied'?denialReason:undefined,createdAt,updatedAt}));
          return json(res,200,{visits,maskedPhone:records.length?'•••• '+normalPhone(records[0].phone).slice(-4):'',timeZone:'America/Chicago'});
        }
        if(req.method==='POST'&&route==='/api/history/logout'){
          sessions.delete(session.id);const next=newSession(res,session.value.admin);return json(res,200,{csrf:next.value.csrf});
        }
        if(req.method==='POST'&&route==='/api/visits'){
          rate(req,'visit',options.visitLimit??5,15*60*1000);const body=await readJson(req);
          const name=typeof body.name==='string'?body.name.trim():'';const phone=typeof body.phone==='string'?body.phone.trim():'';const digits=phone.replace(/\D/g,'');
          if(name.length<2||name.length>80||/[<>\x00-\x1f]/.test(name))throw fail(422,'Please enter a valid name between 2 and 80 characters.');
          if(phone.length>25||!/^[+\d\s().-]+$/.test(phone)||digits.length<7||digits.length>15)throw fail(422,'Please enter a valid phone number.');
          if(typeof body.reason!=='string'||!Object.hasOwn(REASONS,body.reason))throw fail(422,'Choose a reason for your visit.');
          if(body.consent!==true)throw fail(422,'Please agree that the pharmacy can contact you about the request.');
          if(body.notificationChannels!==undefined&&(!Array.isArray(body.notificationChannels)||body.notificationChannels.length>2||body.notificationChannels.some(channel=>!notificationChannels.includes(channel))))throw fail(422,'Choose valid message update options.');
          if(body.notificationChannels?.includes('sms')&&!internationalPhone(phone))throw fail(422,'For SMS, enter a US phone number or an international number with its +country code.');
          if(body.website)throw fail(422,'Your request could not be accepted. Please call the pharmacy.');
          if(typeof body.visitTime!=='string'||!openingSlots(body.visitDate).includes(body.visitTime))throw fail(422,'Choose a future date and time within the pharmacy opening hours.');
          const phoneKey=fingerprint('phone',normalPhone(phone));const returning=session.value.visitor&&equal(session.value.visitor.phoneKey,phoneKey);
          const historyCode=returning?undefined:'FS-'+randomBytes(12).toString('hex').toUpperCase().match(/.{4}/g).join('-');
          const historyHash=returning?session.value.visitor.historyHash:fingerprint('history',normalCode(historyCode));
          const createdAt=new Date().toISOString();const record={id:randomBytes(16).toString('hex'),reference:'FS-'+randomBytes(4).toString('hex').toUpperCase(),name,phone,reason:body.reason,status:'new',visitDate:body.visitDate,visitTime:body.visitTime,createdAt,updatedAt:createdAt,consentVersion:'visit-v3',consentedAt:createdAt,notificationChannels:[...new Set(body.notificationChannels||[])],phoneKey,historyHash,retentionUntil:retentionUntil(body.visitDate,createdAt)};
          record.staffAlert=newRequestEvent(record,notifications.alertPhone);
          await store.change(rows=>{if(rows.length>=10000)throw fail(503,'Please call the pharmacy to arrange your visit.');if(slotBlocked(rows,record.visitDate,record.visitTime))throw fail(409,'That time is no longer available. Please choose another time.');rows.push(record);});
          await notifications.dispatchAlert(record.id);
          sessions.delete(session.id);newSession(res,session.value.admin,{phoneKey,historyHash});
          return json(res,201,{reference:record.reference,historyCode,visitDate:record.visitDate,visitTime:record.visitTime});
        }
        if(!session?.value.admin)throw fail(401,'Please sign in to the admin panel.');
        if(req.method==='POST'&&route==='/api/logout'){
          sessions.delete(session.id);res.setHeader('Set-Cookie',`manor_session=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/api${production?'; Secure':''}`);return json(res,200,{ok:true});
        }
        if(req.method==='GET'&&route==='/api/visits'){
          const visits=await store.change(rows=>[...rows].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(adminVisit));return json(res,200,{visits,reasons:REASONS,messaging:notifications.configuration()});
        }
        const visitId=route.match(/^\/api\/visits\/([a-f0-9]{32})$/)?.[1];
        if(req.method==='PATCH'&&visitId){
          const body=await readJson(req);if(!statuses.has(body.status))throw fail(422,'Choose a valid request status.');
          const decision=await store.change(rows=>{
            const record=rows.find(row=>row.id===visitId);if(!record)throw fail(404,'This request is no longer available.');
            if(body.expectedUpdatedAt&&body.expectedUpdatedAt!==record.updatedAt)throw fail(409,'This request has changed. Refresh the inbox and review it again.');
            if(record.notifications?.at(-1)&&Object.values(record.notifications.at(-1).channels).some(item=>item.status==='sending'))throw fail(409,'A message update is being processed. Please wait and refresh.');
            const date=body.visitDate??record.visitDate;const time=body.visitTime??record.visitTime;
            const reason=typeof body.denialReason==='string'?body.denialReason.trim().replace(/\s+/g,' '):'';
            if(body.status==='denied'&&(reason.length<10||reason.length>240||/[<>\x00-\x1f]/.test(reason)))throw fail(422,'Enter a reason for denying this visit (10–240 characters). This reason will be shared with the visitor.');
            if(body.status==='accepted'){
              if(!openingSlots(date).includes(time))throw fail(422,'Choose a future date and time within the pharmacy opening hours.');
              if(slotBlocked(rows,date,time,record.id))throw fail(409,'Another accepted visit already uses this time. Choose an available time.');
            }
            if(body.status==='completed'&&!['accepted','completed'].includes(record.status))throw fail(422,'Accept the visit before marking it completed.');
            const changed=body.status!==record.status||(body.status==='accepted'&&(date!==record.visitDate||time!==record.visitTime))||(body.status==='denied'&&reason!==record.denialReason);
            if(body.status==='accepted'){record.visitDate=date;record.visitTime=time;record.retentionUntil=retentionUntil(date,record.createdAt);}
            record.denialReason=body.status==='denied'?reason:undefined;record.status=body.status;if(changed)record.updatedAt=new Date().toISOString();
            let eventId;if(changed&&['accepted','denied'].includes(record.status)){const event=notificationEvent(record);record.notifications??=[];record.notifications.push(event);eventId=event.id;}
            return {eventId};
          });
          if(decision.eventId)await notifications.dispatch(visitId,decision.eventId);
          const visit=await store.change(rows=>adminVisit(rows.find(row=>row.id===visitId)));return json(res,200,{visit,messaging:notifications.configuration()});
        }
        const notificationAction=route.match(/^\/api\/visits\/([a-f0-9]{32})\/notifications\/(retry|check)$/);
        if(req.method==='POST'&&notificationAction){
          rate(req,'message-action',30,60*1000);await readJson(req);const [,id,action]=notificationAction;
          const eventId=await store.change(rows=>{const record=rows.find(row=>row.id===id);if(!record)throw fail(404,'This request is no longer available.');return record.notifications?.at(-1)?.id;});
          if(action==='retry'){await notifications.dispatchAlert(id,{retry:true});if(eventId)await notifications.dispatch(id,eventId,{retry:true});}
          if(action==='check')await notifications.check(id);
          const visit=await store.change(rows=>adminVisit(rows.find(row=>row.id===id)));return json(res,200,{visit,messaging:notifications.configuration()});
        }
        if(req.method==='DELETE'&&visitId){
          await store.change(rows=>{const index=rows.findIndex(row=>row.id===visitId);if(index===-1)throw fail(404,'This request is no longer available.');rows.splice(index,1);});return json(res,200,{ok:true});
        }
        throw fail(404,'This service could not be found.');
      }
      if(req.method!=='GET'&&req.method!=='HEAD')throw fail(405,'Method not allowed.');
      const file=route==='/'?'index.html':route.slice(1);
      if(!publicFiles.has(file))throw fail(404,'Page not found.');
      const data=await fs.readFile(path.join(publicRoot,file));
      res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:data);
    }catch(error){
      if(!res.headersSent)json(res,error.status||500,{error:error.status?error.message:'The service is temporarily unavailable. Please try again or call the pharmacy.'});else res.end();
    }
  });
  const maintenance=setInterval(()=>{
    for(const [id,value] of sessions)if(Date.now()-value.last>30*60*1000||Date.now()-value.created>12*60*60*1000)sessions.delete(id);
    for(const [id,value] of rates)if(value.reset<Date.now())rates.delete(id);
    store.change(()=>{}).catch(()=>console.error('Visit retention cleanup failed. Check storage configuration.'));
    reviewApi.cleanup().catch(()=>console.error('Review retention cleanup failed. Check storage configuration.'));
  },60*60*1000);maintenance.unref();server.on('close',()=>clearInterval(maintenance));
  return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const server=await createApp();const port=Number(process.env.PORT||4173);const host=process.env.HOST||(process.env.NODE_ENV==='production'?'0.0.0.0':'127.0.0.1');
  server.listen(port,host,()=>console.log(`Pharmacy website ready on port ${port}.`));
}
