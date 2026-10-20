import {randomBytes} from 'node:crypto';
import {VisitStore} from './store.mjs';
const day=24*60*60*1000;
const publicReview=({id,displayName,rating,text,createdAt})=>({id,displayName,rating,text,createdAt,source:'website'});
export async function createReviewsApi({directory,key,rate,readJson,fail,json}){
  const store=new VisitStore(directory,key,{filename:'reviews.enc'});await store.init();
  return {cleanup:()=>store.change(()=>{}),async handle(req,res,{route,session}){
    if(route==='/api/reviews'&&req.method==='GET'){
      const result=await store.change(rows=>{const published=rows.filter(row=>row.status==='approved').sort((a,b)=>b.createdAt.localeCompare(a.createdAt));return {reviews:published.slice(0,6).map(publicReview),summary:{count:published.length,average:published.length?Number((published.reduce((sum,row)=>sum+row.rating,0)/published.length).toFixed(1)):null}};});json(res,200,result);return true;
    }
    if(route==='/api/reviews'&&req.method==='POST'){
      rate(req,'review',3,60*60*1000);const body=await readJson(req);
      const displayName=typeof body.displayName==='string'?body.displayName.trim().replace(/\s+/g,' '):'';const text=typeof body.text==='string'?body.text.trim():'';
      if(displayName.length<2||displayName.length>60||/[<>\x00-\x1f]/.test(displayName))throw fail(422,'Enter a display name between 2 and 60 characters.');
      if(!Number.isInteger(body.rating)||body.rating<1||body.rating>5)throw fail(422,'Choose a rating from 1 to 5 stars.');
      if(text.length<20||text.length>800||/[<>\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))throw fail(422,'Write a review between 20 and 800 characters, without HTML.');
      if(body.consent!==true)throw fail(422,'Please agree that your display name and review may be published.');
      if(body.website)throw fail(422,'Your review could not be accepted.');
      const record={id:randomBytes(16).toString('hex'),displayName,rating:body.rating,text,status:'pending',createdAt:new Date().toISOString(),consentedAt:new Date().toISOString(),consentVersion:'website-review-v1',retentionUntil:new Date(Date.now()+30*day).toISOString()};
      await store.change(rows=>{if(rows.length>=5000)throw fail(503,'Reviews are temporarily unavailable. Please try again later.');rows.push(record);});json(res,201,{status:'pending'});return true;
    }
    const id=route.match(/^\/api\/reviews\/([a-f0-9]{32})$/)?.[1];
    if(route==='/api/reviews/admin'||id){
      if(!session?.value.admin)throw fail(401,'Please sign in to moderate reviews.');
      if(route==='/api/reviews/admin'&&req.method==='GET'){
        const reviews=await store.change(rows=>[...rows].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));json(res,200,{reviews});return true;
      }
      if(id&&req.method==='PATCH'){
        const body=await readJson(req);if(!['approved','hidden','rejected'].includes(body.status))throw fail(422,'Choose a valid review status.');
        const review=await store.change(rows=>{const row=rows.find(row=>row.id===id);if(!row)throw fail(404,'This review is no longer available.');if(row.status!==body.status){row.status=body.status;row.moderatedAt=new Date().toISOString();row.retentionUntil=new Date(Date.now()+(body.status==='approved'?365:30)*day).toISOString();}return row;});json(res,200,{review});return true;
      }
    }
    return false;
  }};
}
