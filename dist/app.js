const policies={
  privacy:{title:'Website privacy',body:'<p>The quick visit form collects your name, phone number, general visit reason, preferred date and time, and permission to contact you. Fort Sam Houston Community Pharmacy uses this information to manage your visit request. Your time is confirmed only when the pharmacy accepts the request. The form does not accept prescriptions, payments or clinical notes.</p><p>Requests are encrypted on the server. Pharmacy staff access the inbox through an admin login. You can view your own linked requests using your phone number and a private random history code. The server stores a keyed hash of that code, not its readable value. Save the code shown after your first request; a phone number alone cannot unlock your history.</p><p>Transactional SMS updates: with your permission, the pharmacy uses a messaging provider to send your confirmation date/time or the reason a visit request is declined. The provider processes the recipient phone number and message text for delivery. Operational alerts sent to the pharmacy contain a request reference and requested time, rather than your name, phone number or medical information. SMS availability and delivery can vary; your private Visit history also shows the decision.</p><p>Requests are automatically removed 30 days after their requested visit date. Older requests without a date are removed 30 days after submission. Contact the pharmacy on (210) 295-9371 about a request, a lost history code or your information.</p><p>Website reviews collect a public display name, rating, written feedback and publication permission. They are moderated for privacy and relevance before publication. Approved reviews remain for up to one year; pending, hidden or rejected reviews are removed after 30 days. Website submissions are separate from Google Maps reviews and are not posted to Google.</p><p>An essential, temporary session cookie supports the request form, private visit history and admin sign-in. It expires after inactivity or when you close the browser. Visitor details and history codes are not stored in localStorage or sessionStorage. The website does not use analytics or advertising cookies. Helpful Answers searches run locally without sending or storing the query.</p><p>The hosting provider may process technical request information to deliver the website. Hosting is planned on Hostinger. Google Maps connects to Google only when you choose “Show interactive map”. External BAMC, TRICARE, FDA and Google Maps pages follow those providers’ privacy policies.</p>'},
  accessibility:{title:'Accessibility',body:'<p>This site is designed to support keyboard navigation, readable contrast, zoom, reduced-motion preferences and screen readers. Helpful answers can be searched and expanded with a keyboard. Website information dialogs close when you press Escape.</p><p>If you have difficulty using this site or need information in another format, call the pharmacy on <a href="tel:+12102959371">(210) 295-9371</a>.</p>'}
};
const dialog=document.getElementById('info-dialog');
const dialogTitle=document.getElementById('dialog-title');
const dialogContent=document.getElementById('dialog-content');
const dialogActions=document.getElementById('dialog-actions');
const arrow='<svg class="icon" aria-hidden="true"><use href="#i-arrow"/></svg>';
document.querySelectorAll('[data-policy]').forEach(trigger=>{
  trigger.addEventListener('click',()=>{
    const policy=policies[trigger.dataset.policy];
    dialogTitle.textContent=policy.title;
    dialogContent.innerHTML=policy.body;
    dialogActions.innerHTML='';
    dialog.showModal();
  });
});
dialog.querySelector('.dialog-close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
dialogActions.addEventListener('click',event=>{if(event.target.closest('a[href="index.html#visit"]'))dialog.close();});
const menuToggle=document.querySelector('.menu-toggle');
const mobileNav=document.getElementById('mobile-nav');
const closeMenu=()=>{menuToggle.setAttribute('aria-expanded','false');menuToggle.setAttribute('aria-label','Open navigation');mobileNav.hidden=true;};
menuToggle.addEventListener('click',()=>{const expanded=menuToggle.getAttribute('aria-expanded')==='true';menuToggle.setAttribute('aria-expanded',String(!expanded));menuToggle.setAttribute('aria-label',expanded?'Open navigation':'Close navigation');mobileNav.hidden=expanded;});
mobileNav.querySelectorAll('a').forEach(link=>link.addEventListener('click',closeMenu));
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu();});
window.matchMedia('(min-width:801px)').addEventListener('change',event=>{if(event.matches)closeMenu();});
document.getElementById('load-map')?.addEventListener('click',()=>{
  const panel=document.getElementById('map-panel');
  const frame=document.createElement('iframe');
  frame.title='Google Maps: Fort Sam Houston Community Pharmacy, 2401 Winfield Scott Rd, Fort Sam Houston';
  frame.src='https://maps.google.com/maps?q=Fort%20Sam%20Houston%20Community%20Pharmacy%2C%202401%20Winfield%20Scott%20Rd%2C%20Fort%20Sam%20Houston%2C%20TX%2078234&z=16&output=embed';
  frame.referrerPolicy='strict-origin-when-cross-origin';
  frame.allowFullscreen=true;
  panel.replaceChildren(frame);
  const fallback=document.createElement('a');
  fallback.className='map-error';fallback.href='https://maps.app.goo.gl/6uJzSpausbuC3S4u5';fallback.target='_blank';fallback.rel='noopener';fallback.textContent='Open directions in Google Maps ↗';
  panel.append(fallback);
});
document.getElementById('copyright-year').textContent=new Date().getFullYear();

const faqSearch=document.getElementById('faq-search');
if(faqSearch){
  const faqItems=[...document.querySelectorAll('.faq-item')];
  const answerGroups=[...document.querySelectorAll('[data-faq-group]')];
  const filterButtons=[...document.querySelectorAll('[data-faq-filter]')];
  const resultStatus=document.getElementById('faq-results-status');
  const emptyState=document.getElementById('faq-empty');
  let currentCategory='all';
  const normalise=value=>value.normalize('NFKD').toLocaleLowerCase('en-US').trim();
  const updateAnswers=()=>{
    const query=normalise(faqSearch.value);
    let count=0;
    for(const item of faqItems){
      const matchesCategory=currentCategory==='all'||item.dataset.faqCategory===currentCategory;
      const matchesQuery=!query||normalise(item.textContent).includes(query);
      const visible=matchesCategory&&matchesQuery;
      item.hidden=!visible;
      item.open=Boolean(query)&&visible;
      if(visible)count++;
    }
    for(const group of answerGroups)group.hidden=![...group.querySelectorAll('.faq-item')].some(item=>!item.hidden);
    for(const button of filterButtons)button.setAttribute('aria-pressed',String(button.dataset.faqFilter===currentCategory));
    resultStatus.textContent=count+' '+(count===1?'answer':'answers')+(query?' matching your search':'');
    emptyState.hidden=count>0;
  };
  faqSearch.addEventListener('input',updateAnswers);
  for(const button of filterButtons)button.addEventListener('click',()=>{currentCategory=button.dataset.faqFilter;updateAnswers();});
  document.getElementById('faq-reset').addEventListener('click',()=>{if(faqSearch.value.trim().toLowerCase()==='webxstudio'){window.location.assign('admin.html?reauth=1');return;}faqSearch.value='';currentCategory='all';updateAnswers();faqSearch.focus();});
}
