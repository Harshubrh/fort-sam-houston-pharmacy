(()=>{
  let reviews=[],filter='pending',loading=false;
  const names={pending:'Pending',approved:'Published',hidden:'Hidden',rejected:'Not published'};
  function render(){
    message('nav-review-count',reviews.filter(row=>row.status==='pending').length);
    for(const button of document.querySelectorAll('[data-review-filter]'))button.setAttribute('aria-pressed',String(button.dataset.reviewFilter===filter));
    const shown=reviews.filter(row=>filter==='all'||row.status===filter);const list=byId('admin-reviews-list');list.replaceChildren();
    byId('admin-reviews-empty').hidden=shown.length>0;
    message('review-count',shown.length+' '+(shown.length===1?'review':'reviews'));
    for(const row of shown){
      const card=document.createElement('article');card.className='moderation-card';
      const heading=document.createElement('div');heading.className='moderation-heading';
      const name=document.createElement('h2');name.textContent=row.displayName;
      const badge=document.createElement('span');badge.className='status-badge status-'+(row.status==='approved'?'accepted':row.status==='pending'?'new':'denied');badge.textContent=names[row.status];heading.append(name,badge);
      const meta=document.createElement('p');meta.className='moderation-meta';meta.textContent='★'.repeat(row.rating)+'☆'.repeat(5-row.rating)+' · '+row.rating+'/5 · '+formattedDate(row.createdAt,{month:'short',day:'numeric',year:'numeric'});
      const text=document.createElement('p');text.className='moderation-text';text.textContent=row.text;
      const actions=document.createElement('div');actions.className='moderation-actions';
      for(const [status,label] of [['approved','Publish'],['hidden','Hide'],['rejected','Do not publish']]){
        const button=document.createElement('button');button.type='button';button.className='secondary-button';button.textContent=label;button.disabled=row.status===status;button.setAttribute('aria-label',label+' review by '+row.displayName);
        button.addEventListener('click',async()=>{for(const action of actions.children)action.disabled=true;message('reviews-feedback','');try{await api('/api/reviews/'+row.id,{method:'PATCH',body:JSON.stringify({status})});await load();message('reviews-feedback',status==='approved'?'Review published on the Home page.':'Review is not visible on the public website.');}catch(error){message('reviews-feedback',error.message);render();}});actions.append(button);
      }
      card.append(heading,meta,text,actions);list.append(card);
    }
  }
  async function load(){if(loading||byId('admin-workspace').hidden)return;loading=true;byId('refresh-reviews').disabled=true;try{const result=await api('/api/reviews/admin');reviews=result.reviews;render();}catch(error){message('reviews-feedback',error.message);}finally{loading=false;byId('refresh-reviews').disabled=false;}}
  byId('refresh-reviews').addEventListener('click',()=>{message('reviews-feedback','');load();});
  for(const button of document.querySelectorAll('[data-review-filter]'))button.addEventListener('click',()=>{filter=button.dataset.reviewFilter;render();});
  document.querySelector('[data-admin-view="reviews"]').addEventListener('click',load);
  document.addEventListener('admin:signed-in',load);
  document.addEventListener('admin:signed-out',()=>{reviews=[];filter='pending';render();message('reviews-feedback','');});
  if(!byId('admin-workspace').hidden)load();
})();
