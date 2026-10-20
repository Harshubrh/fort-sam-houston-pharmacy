import {business} from '../business.mjs';
const dayMs=24*60*60*1000;
const pharmacyClock=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function localClock(now=new Date()){
  const parts=Object.fromEntries(pharmacyClock.formatToParts(now).map(part=>[part.type,part.value]));
  return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`};
}
export function validDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T12:00:00Z');return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function calendarBounds(now=new Date()){
  const {date}=localClock(now);return {minDate:date,maxDate:new Date(Date.parse(date+'T12:00:00Z')+60*dayMs).toISOString().slice(0,10),timeZone:'America/Chicago'};
}
export function openingSlots(date,now=new Date()){
  if(!validDate(date))return [];
  const bounds=calendarBounds(now);if(date<bounds.minDate||date>bounds.maxDate)return [];
  const weekday=new Date(date+'T12:00:00Z').getUTCDay();const range=business.hours[weekday];if(!range)return [];
  const close=range[1];const current=localClock(now);const slots=[];
  for(let minute=range[0]*60;minute<close*60;minute+=30){const time=String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');if(date!==current.date||time>current.time)slots.push(time);}
  return slots;
}
export function slotBlocked(rows,date,time,exceptId){return rows.some(row=>row.id!==exceptId&&row.visitDate===date&&row.visitTime===time&&['accepted','completed'].includes(row.status));}
export function retentionUntil(date,createdAt=new Date().toISOString()){
  return new Date((validDate(date)?Date.parse(date+'T23:59:59Z'):Date.parse(createdAt))+30*dayMs).toISOString();
}
