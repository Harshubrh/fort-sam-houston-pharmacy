import {business} from '../business.mjs';
import {randomBytes} from 'node:crypto';

// Reserved example number is used only for local preview and synthetic tests.
export const DEFAULT_ALERT_PHONE=process.env.PHARMACY_ALERT_PHONE||'+12025550123';
export const notificationChannels=['sms'];
const retryable=new Set(['preview','not_configured','failed']);
const activeDelivery=new Set(['queued','sending','sent']);
export function internationalPhone(value){
  const input=String(value||'').trim();let digits=input.replace(/\D/g,'');
  if(digits.startsWith('00'))digits=digits.slice(2);
  else if(/^[2-9]\d{9}$/.test(digits))digits='1'+digits;
  else if(/^1[2-9]\d{9}$/.test(digits)){} 
  else if(!input.startsWith('+'))return null;
  return /^[1-9]\d{7,14}$/.test(digits)?'+'+digits:null;
}
const dateLabel=record=>record.visitDate?new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',day:'numeric',month:'short',year:'numeric'}).format(new Date(record.visitDate+'T12:00:00Z')):'date to be arranged';
export function decisionMessage(record){
  const reason=String(record.denialReason||'').trim();const reasonSentence=/[.!?]$/.test(reason)?reason:reason+'.';
  return record.status==='accepted'
    ?`Fort Sam Houston Community Pharmacy: Your visit is confirmed for ${dateLabel(record)} at ${record.visitTime} (Central Time). Ref ${record.reference}. Call (210) 295-9371 if plans change.`
    :`Fort Sam Houston Community Pharmacy: Your visit request was declined. Reason: ${reasonSentence} Ref ${record.reference}. Call (210) 295-9371 to discuss another time.`;
}
export function notificationEvent(record){
  return {id:randomBytes(16).toString('hex'),decision:record.status,createdAt:new Date().toISOString(),body:decisionMessage(record),channels:{sms:{status:record.notificationChannels?.includes('sms')?'pending':'not_consented',attempts:0}}};
}
export function newRequestEvent(record,recipient=DEFAULT_ALERT_PHONE){
  return {id:randomBytes(16).toString('hex'),decision:'new_request',createdAt:new Date().toISOString(),to:internationalPhone(recipient),body:`Fort Sam Houston Community Pharmacy: New visit request ${record.reference} for ${dateLabel(record)} at ${record.visitTime} (Central Time). Sign in to the admin inbox to review.`,channels:{sms:{status:'pending',attempts:0}}};
}
const sidPattern=/^SM[0-9a-f]{32}$/i;
const providerStatus=value=>({accepted:'queued',scheduled:'queued',queued:'queued',sending:'sending',sent:'sent',delivered:'delivered',failed:'failed',undelivered:'failed',canceled:'failed'}[value]||'unknown');
export function twilioTransport(env=process.env,fetcher=fetch){
  const account=env.TWILIO_ACCOUNT_SID||'';const apiKey=env.TWILIO_API_KEY_SID||'';const secret=env.TWILIO_API_KEY_SECRET||'';
  const sender=env.TWILIO_SMS_FROM||'';const service=env.TWILIO_SMS_SERVICE_SID||'';
  const ready=()=>/^AC[0-9a-f]{32}$/i.test(account)&&/^SK[0-9a-f]{32}$/i.test(apiKey)&&Boolean(secret)&&(/^MG[0-9a-f]{32}$/i.test(service)||/^\+[1-9]\d{7,14}$/.test(sender)||/^[A-Za-z][A-Za-z0-9]{0,10}$/.test(sender));
  const endpoint=`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages`;
  const headers={Authorization:'Basic '+Buffer.from(apiKey+':'+secret).toString('base64')};
  async function request(url,options={}){
    let response;try{response=await fetcher(url,{...options,headers:{...headers,...options.headers},redirect:'error',signal:AbortSignal.timeout(12000)});}catch{return {status:'unknown',error:'The provider response is uncertain. Check the provider logs before sending again.'};}
    let data;try{data=await response.json();}catch{return {status:'unknown',error:'The provider response could not be verified. Check the provider logs.'};}
    if(!response.ok)return {status:response.status>=500?'unknown':'failed',error:'SMS provider rejected the request'+(Number.isInteger(data.code)?' (code '+data.code+')':'')+'.'};
    if(!sidPattern.test(data.sid||''))return {status:'unknown',error:'The provider did not return a valid SMS reference.'};
    return {status:providerStatus(data.status),providerId:data.sid,...(data.error_code?{error:'Provider delivery error '+data.error_code+'.'}:{})};
  }
  return {ready,async send(channel,to,event){
    if(channel!=='sms'||!internationalPhone(to))throw new Error('Invalid SMS destination.');
    const body=new URLSearchParams({To:to,Body:event.body});if(service)body.set('MessagingServiceSid',service);else body.set('From',sender);
    return request(endpoint+'.json',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
  },async check(providerId){if(!sidPattern.test(providerId))return {status:'unknown',error:'Invalid provider reference.'};return request(endpoint+'/'+providerId+'.json');}};
}

export class VisitNotifications{
  constructor(store,{mode='preview',transport=twilioTransport(),alertPhone=DEFAULT_ALERT_PHONE}={}){
    if(!['preview','live'].includes(mode))throw new Error('MESSAGE_MODE must be preview or live.');
    if(!internationalPhone(alertPhone))throw new Error('PHARMACY_ALERT_PHONE must be a valid international phone number.');
    this.store=store;this.mode=mode;this.transport=transport;this.alertPhone=internationalPhone(alertPhone);
  }
  configuration(){return {mode:this.mode,sms:Boolean(this.transport.ready('sms')),alertRecipient:'•••• '+this.alertPhone.slice(-4)};}
  async dispatch(visitId,eventId,options={}){return this.#dispatch(visitId,eventId,{...options,staff:false});}
  async dispatchAlert(visitId,options={}){return this.#dispatch(visitId,null,{...options,staff:true});}
  async #dispatch(visitId,eventId,{retry=false,staff=false}={}){
    const job=await this.store.change(rows=>{
      const record=rows.find(row=>row.id===visitId);const event=staff?record?.staffAlert:record?.notifications?.at(-1);
      if(!event||(!staff&&event.id!==eventId))return null;
      const item=event.channels.sms;if(item.status!=='pending'&&!(retry&&retryable.has(item.status)))return null;
      if(item.attempts>=3){item.status='failed';item.error='Maximum attempts reached. Contact the visitor by phone.';return null;}
      if(this.mode==='preview'){item.status='preview';item.error='Preview only. No SMS was sent.';return null;}
      if(!this.transport.ready('sms')){item.status='not_configured';item.error='Connect the SMS provider credentials and an approved sender.';return null;}
      const to=staff?event.to:internationalPhone(record.phone);if(!to){item.status='failed';item.error='A valid international phone number is needed. Check the destination.';return null;}
      item.status='sending';item.attempts++;item.attemptedAt=new Date().toISOString();delete item.error;
      return {to,event:structuredClone(event)};
    });
    if(!job)return;
    let result;try{result=await this.transport.send('sms',job.to,job.event);}catch{result={status:'unknown',error:'The provider response is uncertain. Check the provider logs before sending again.'};}
    await this.store.change(rows=>{
      const record=rows.find(row=>row.id===visitId);const event=staff?record?.staffAlert:record?.notifications?.find(event=>event.id===job.event.id);
      if(event)event.channels.sms={...event.channels.sms,...result,checkedAt:new Date().toISOString()};
    });
  }
  async check(visitId){
    if(this.mode!=='live')return;
    const events=await this.store.change(rows=>{const record=rows.find(row=>row.id===visitId);return structuredClone([...(record?.staffAlert?[record.staffAlert]:[]),...(record?.notifications||[])]);});
    for(const event of events){const item=event.channels.sms;if(!item.providerId||!activeDelivery.has(item.status))continue;
      let result;try{result=await this.transport.check(item.providerId);}catch{continue;}if(result.status==='unknown')continue;
      await this.store.change(rows=>{const record=rows.find(row=>row.id===visitId);const saved=(record?.staffAlert?.id===event.id?record.staffAlert:record?.notifications?.find(entry=>entry.id===event.id))?.channels.sms;if(saved&&activeDelivery.has(saved.status))Object.assign(saved,result,{checkedAt:new Date().toISOString()});});
    }
  }
  async recover(){
    const pending=await this.store.change(rows=>{
      const work=[];for(const row of rows){
        const events=[...(row.staffAlert?[row.staffAlert]:[]),...(row.notifications||[])];
        for(const event of events){const item=event.channels.sms;if(item.status==='sending'&&!item.providerId){item.status='unknown';item.error='The service restarted during sending. Check provider logs before sending again.';}}
        if(row.staffAlert?.channels.sms.status==='pending')work.push({id:row.id,staff:true});
        const latest=row.notifications?.at(-1);if(latest?.channels.sms.status==='pending')work.push({id:row.id,event:latest.id});
      }return work;
    });
    for(const job of pending){if(job.staff)await this.dispatchAlert(job.id);else await this.dispatch(job.id,job.event);}
  }
}
