const historyById=id=>document.getElementById(id);
const historyLabels={new:'Pending',accepted:'Accepted',denied:'Denied',completed:'Completed'};
const historyReasons={'prescription-collection':'Prescription pickup','prescription-enquiry':'Prescription activation','medicine-advice':'Medication question','refill-enquiry':'Refill inquiry','general-visit':'General visit'};
const historyNotes={new:'Your request is awaiting the pharmacy’s decision. Please check again before travelling.',accepted:'The pharmacy has accepted this date and time. Call the team if your plans change.',denied:'The pharmacy cannot accept this request. Please call the team or request another available time.',completed:'The pharmacy has marked this visit as completed.'};
let historyCsrf='';let visitorVisits=[];let historyFilter='all';let historyBusy=false;
async function historyApi(url,options={}){
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options,headers:{'Content-Type':'application/json','X-CSRF-Token':historyCsrf,...options.headers}});let result;
  try{result=await response.json();}catch{throw new Error('Visit history is unavailable. Please try again later.');}
  if(!response.ok){const error=new Error(result.error||'The request could not be completed.');error.status=response.status;throw error;}return result;
}
function closeHistory(){visitorVisits=[];historyFilter='all';historyById('history-visits').replaceChildren();historyById('history-summary').replaceChildren();historyById('history-identity').textContent='';historyById('history-code').value='';historyById('history-results').hidden=true;historyById('history-login').hidden=false;historyById('history-result-message').textContent='';}
function addHistoryText(parent,tag,text,className){const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;parent.append(node);return node;}
function renderHistory(){
  const summary=historyById('history-summary');summary.replaceChildren();for(const [status,label] of [['all','All visits'],['new','Pending'],['accepted','Accepted']]){const cell=addHistoryText(summary,'div','');addHistoryText(cell,'strong',status==='all'?visitorVisits.length:visitorVisits.filter(visit=>visit.status===status).length);addHistoryText(cell,'span',label);}
  const visible=visitorVisits.filter(visit=>historyFilter==='all'||visit.status===historyFilter);const list=historyById('history-visits');list.replaceChildren();
  for(const visit of visible){
    const article=addHistoryText(list,'article','','history-visit');const top=addHistoryText(article,'div','','history-visit-top');addHistoryText(top,'span',visit.reference);addHistoryText(top,'span',historyLabels[visit.status]||'Pending','visit-state state-'+visit.status);
    const date=new Intl.DateTimeFormat('en-US',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'America/Chicago'}).format(new Date(visit.visitDate+'T12:00:00Z'));addHistoryText(article,'h3',date);addHistoryText(article,'p',visit.visitTime+' · Central Time','history-visit-time');
    const facts=addHistoryText(article,'dl','');for(const [label,value] of [['Visitor',visit.name],['Reason for visit',historyReasons[visit.reason]]]){const row=addHistoryText(facts,'div','');addHistoryText(row,'dt',label);addHistoryText(row,'dd',value);}
    addHistoryText(article,'p',historyNotes[visit.status]||historyNotes.new,'history-visit-note');if(visit.status==='denied'){const reason=addHistoryText(article,'div','','history-denial-reason');addHistoryText(reason,'strong','Why this request was declined');addHistoryText(reason,'p',visit.denialReason||'Please contact the pharmacy for more information.');const link=addHistoryText(article,'a','Request another time ↗');link.href='index.html#quick-visit';}
  }
  historyById('history-empty').hidden=visible.length>0;for(const button of document.querySelectorAll('[data-history-filter]'))button.setAttribute('aria-pressed',String(button.dataset.historyFilter===historyFilter));
}
async function loadHistory(){
  const refresh=historyById('refresh-history');refresh.disabled=true;historyById('history-result-message').textContent='';
  try{const result=await historyApi('/api/history');visitorVisits=result.visits;historyById('history-login').hidden=true;historyById('history-results').hidden=false;historyById('history-identity').textContent='Phone '+result.maskedPhone+' · Your linked visit requests';renderHistory();}
  catch(error){if(error.status===401){closeHistory();historyById('history-login-message').textContent='Enter your phone number and history access code to view your visits.';}else historyById(historyById('history-results').hidden?'history-login-message':'history-result-message').textContent=error.message;}
  finally{refresh.disabled=false;}
}
historyById('history-login-form').addEventListener('submit',async event=>{
  event.preventDefault();if(historyBusy)return;historyBusy=true;const button=event.currentTarget.querySelector('[type="submit"]');button.disabled=true;historyById('history-login-message').textContent='';
  try{const session=await historyApi('/api/session');historyCsrf=session.csrf;const result=await historyApi('/api/history/login',{method:'POST',body:JSON.stringify({phone:historyById('history-phone').value.trim(),code:historyById('history-code').value.trim()})});historyCsrf=result.csrf;historyById('history-code').value='';await loadHistory();}catch(error){historyById('history-login-message').textContent=error.message;}finally{historyBusy=false;button.disabled=false;}
});
historyById('history-logout').addEventListener('click',async()=>{try{const session=await historyApi('/api/session');historyCsrf=session.csrf;const result=await historyApi('/api/history/logout',{method:'POST',body:'{}'});historyCsrf=result.csrf;closeHistory();historyById('history-phone').value='';historyById('history-login-message').textContent='You have signed out of visit history.';}catch(error){historyById('history-result-message').textContent=error.message;}});
historyById('refresh-history').addEventListener('click',loadHistory);for(const button of document.querySelectorAll('[data-history-filter]'))button.addEventListener('click',()=>{historyFilter=button.dataset.historyFilter;renderHistory();});
async function initialiseHistory(){try{const session=await historyApi('/api/session');historyCsrf=session.csrf;if(session.visitorAuthenticated)await loadHistory();}catch(error){historyById('history-login-message').textContent=error.message;}}
initialiseHistory();window.addEventListener('pageshow',event=>{if(event.persisted){closeHistory();initialiseHistory();}});
