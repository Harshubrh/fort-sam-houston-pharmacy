import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createApp} from '../server.mjs';
async function withReviews(run){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pharmacy-reviews-'));
 const app=await createApp({dataDir:directory,key:randomBytes(32).toString('base64'),password:'Test-only-password-2026!'});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+app.address().port;
 const client=()=>({cookie:'',csrf:'',async request(route,{method='GET',body,token=this.csrf,requestOrigin=origin}={}){
   const res=await fetch(origin+route,{method,headers:{Cookie:this.cookie,...(method==='GET'?{}:{Origin:requestOrigin,'Content-Type':'application/json','X-CSRF-Token':token})},body:body===undefined?undefined:JSON.stringify(body)});
   if(res.headers.get('set-cookie'))this.cookie=res.headers.get('set-cookie').split(';')[0];const data=await res.json();if(data.csrf)this.csrf=data.csrf;return {status:res.status,data};
 }});
 try{await run({client,directory});}finally{await new Promise(resolve=>app.close(resolve));await fs.rm(directory,{recursive:true,force:true});}
}
const review={displayName:'Synthetic Reviewer',rating:1,text:'This is synthetic feedback used only to test the review workflow.',consent:true,website:''};
test('website reviews stay private until moderated, support every rating, persist encrypted, and can be hidden',()=>withReviews(async({client,directory})=>{
 const visitor=client(),admin=client();await visitor.request('/api/session');await admin.request('/api/session');
 assert.equal((await visitor.request('/api/reviews/admin')).status,401);
 assert.equal((await visitor.request('/api/reviews',{method:'POST',body:review,token:'bad'})).status,403);
 assert.equal((await visitor.request('/api/reviews',{method:'POST',body:review,requestOrigin:'https://other.example'})).status,403);
 assert.equal((await visitor.request('/api/reviews',{method:'POST',body:review})).status,201);
 assert.equal((await visitor.request('/api/reviews',{method:'POST',body:{...review,rating:5,displayName:'Second Synthetic Reviewer'}})).status,201);
 assert.deepEqual((await visitor.request('/api/reviews')).data,{reviews:[],summary:{count:0,average:null}});
 await admin.request('/api/login',{method:'POST',body:{username:'admin',password:'Test-only-password-2026!'}});
 const pending=(await admin.request('/api/reviews/admin')).data.reviews;assert.equal(pending.length,2);assert.ok(pending.every(row=>row.status==='pending'));
 assert.equal((await visitor.request('/api/reviews/'+pending[0].id,{method:'PATCH',body:{status:'approved'}})).status,401);
 for(const row of pending)assert.equal((await admin.request('/api/reviews/'+row.id,{method:'PATCH',body:{status:'approved'}})).status,200);
 let result=(await visitor.request('/api/reviews')).data;assert.deepEqual(result.summary,{count:2,average:3});assert.deepEqual(result.reviews.map(row=>row.rating).sort(),[1,5]);assert.equal(Object.hasOwn(result.reviews[0],'consentedAt'),false);assert.equal(Object.hasOwn(result.reviews[0],'status'),false);
 await admin.request('/api/reviews/'+pending[0].id,{method:'PATCH',body:{status:'hidden'}});result=(await visitor.request('/api/reviews')).data;assert.equal(result.summary.count,1);assert.equal(result.reviews.some(row=>row.id===pending[0].id),false);
 assert.equal((await admin.request('/api/reviews/'+pending[0].id,{method:'PATCH',body:{status:'invented'}})).status,422);
 await admin.request('/api/reviews/'+pending[0].id,{method:'PATCH',body:{status:'approved'}});assert.equal((await visitor.request('/api/reviews')).data.summary.count,2);
 const disk=await fs.readFile(path.join(directory,'reviews.enc'),'utf8');assert.equal(disk.includes(review.text),false);assert.equal(disk.includes(review.displayName),false);
}));
test('review input enforces consent, valid ratings and spam throttling',()=>withReviews(async({client})=>{
 const person=client();await person.request('/api/session');
 for(const mutation of [{consent:false},{rating:6},{text:'<script>alert(1)</script>'}])assert.equal((await person.request('/api/reviews',{method:'POST',body:{...review,...mutation}})).status,422);
 assert.equal((await person.request('/api/reviews',{method:'POST',body:review})).status,429);
}));
