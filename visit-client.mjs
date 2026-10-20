// Build source for the public visit form. Copied to dist/visit.js by the page builder.
const visitForm=document.getElementById('quick-visit-form');
if(visitForm){
  const message=document.getElementById('visit-form-status');
  const phoneField=document.getElementById('visit-phone');
  const nameField=document.getElementById('visit-name');
  const dateField=document.getElementById('visit-date');
  const timeField=document.getElementById('visit-time');
  const timeOptions=document.getElementById('visit-time-options');
  const dateToggle=document.getElementById('visit-date-toggle');
  const dateLabel=document.getElementById('visit-date-label');
  const calendar=document.getElementById('visit-calendar');
  const calendarDays=document.getElementById('visit-calendar-days');
  const previousMonth=document.getElementById('visit-calendar-prev');
  const nextMonth=document.getElementById('visit-calendar-next');
  const scheduleHelp=document.getElementById('schedule-help');
  const success=document.getElementById('visit-success');
  let submitting=false;let availabilitySequence=0;let minDate='';let maxDate='';let calendarMonth='';
  const dateObject=value=>new Date(value+'T12:00:00Z');
  const dateString=value=>value.toISOString().slice(0,10);
  const readableDate=value=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'}).format(dateObject(value));
  const dateAllowed=value=>value>=minDate&&value<=maxDate&&dateObject(value).getUTCDay()!==0;
  function closeCalendar(restoreFocus=false){calendar.hidden=true;dateToggle.setAttribute('aria-expanded','false');if(restoreFocus)dateToggle.focus();}
  function renderCalendar(focusDate){
    const first=dateObject(calendarMonth+'-01');const count=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0,12)).getUTCDate();
    document.getElementById('visit-calendar-month').textContent=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'long',year:'numeric'}).format(first);
    previousMonth.disabled=calendarMonth<=minDate.slice(0,7);nextMonth.disabled=calendarMonth>=maxDate.slice(0,7);calendarDays.replaceChildren();
    for(let gap=0;gap<first.getUTCDay();gap++){const spacer=document.createElement('span');spacer.setAttribute('aria-hidden','true');calendarDays.append(spacer);}
    for(let day=1;day<=count;day++){
      const value=calendarMonth+'-'+String(day).padStart(2,'0');const button=document.createElement('button');button.type='button';button.textContent=day;button.dataset.date=value;button.disabled=!dateAllowed(value);button.tabIndex=-1;
      button.setAttribute('aria-label',new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(dateObject(value)));button.setAttribute('aria-pressed',String(value===dateField.value));
      if(value===minDate)button.setAttribute('aria-current','date');
      button.addEventListener('click',()=>{dateField.value=value;dateLabel.textContent=readableDate(value);dateToggle.removeAttribute('aria-invalid');message.textContent='';closeCalendar(true);loadTimes();});calendarDays.append(button);
    }
    const target=calendarDays.querySelector('[data-date="'+(focusDate||dateField.value)+'"]:not(:disabled)')||calendarDays.querySelector('button:not(:disabled)');if(target){target.tabIndex=0;if(focusDate)target.focus();}
  }
  function openCalendar(){if(!minDate||dateToggle.disabled)return;calendarMonth=(dateField.value||minDate).slice(0,7);renderCalendar();calendar.hidden=false;dateToggle.setAttribute('aria-expanded','true');calendarDays.querySelector('[tabindex="0"]')?.focus();}
  function moveMonth(direction){const first=dateObject(calendarMonth+'-01');first.setUTCMonth(first.getUTCMonth()+direction);calendarMonth=dateString(first).slice(0,7);renderCalendar();}
  dateToggle.addEventListener('click',()=>calendar.hidden?openCalendar():closeCalendar());
  previousMonth.addEventListener('click',()=>moveMonth(-1));nextMonth.addEventListener('click',()=>moveMonth(1));
  document.getElementById('visit-calendar-close').addEventListener('click',()=>closeCalendar(true));
  calendar.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();closeCalendar(true);return;}
    const value=event.target.dataset.date;if(!value)return;
    const offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};let destination=dateObject(value);
    if(Object.hasOwn(offsets,event.key))destination.setUTCDate(destination.getUTCDate()+offsets[event.key]);
    else if(event.key==='Home')destination.setUTCDate(destination.getUTCDate()-destination.getUTCDay()+1);
    else if(event.key==='End')destination.setUTCDate(destination.getUTCDate()+6-destination.getUTCDay());
    else if(event.key==='PageUp'||event.key==='PageDown'){const targetDay=destination.getUTCDate();destination.setUTCDate(1);destination.setUTCMonth(destination.getUTCMonth()+(event.key==='PageUp'?-1:1));const last=new Date(Date.UTC(destination.getUTCFullYear(),destination.getUTCMonth()+1,0)).getUTCDate();destination.setUTCDate(Math.min(targetDay,last));}
    else return;
    event.preventDefault();let next=dateString(destination);const direction=['ArrowLeft','ArrowUp','PageUp'].includes(event.key)?-1:1;
    if(!dateAllowed(next)&&next>=minDate&&next<=maxDate){destination.setUTCDate(destination.getUTCDate()+direction);next=dateString(destination);}
    if(!dateAllowed(next))return;calendarMonth=next.slice(0,7);renderCalendar(next);
  });
  document.addEventListener('click',event=>{if(!calendar.hidden&&!calendar.contains(event.target)&&!dateToggle.contains(event.target))closeCalendar();});
  const checkName=()=>nameField.setCustomValidity(nameField.value.trim().length>=2?'':'Please enter your name.');
  const checkPhone=()=>{const input=phoneField.value.trim();const digits=input.replace(/\D/g,'');const local=/^[2-9]\d{9}$/.test(digits)||/^1[2-9]\d{9}$/.test(digits);const international=(input.startsWith('+')||input.startsWith('00'))&&digits.replace(/^00/,'').length>=8&&digits.replace(/^00/,'').length<=15;phoneField.setCustomValidity(/^[+\d\s().-]+$/.test(input)&&(local||international)?'':'Enter a US phone number or an international number with its +country code.');};
  const emptyTimes=label=>{timeField.value='';timeOptions.replaceChildren();const note=document.createElement('p');note.className='visit-time-empty';note.textContent=label;timeOptions.append(note);};
  async function loadTimes(){
    const sequence=++availabilitySequence;emptyTimes('Loading times…');if(!dateField.value){emptyTimes('Choose a date first');return;}
    try{
      const response=await fetch('/api/availability?date='+encodeURIComponent(dateField.value),{cache:'no-store'});const result=await response.json();if(!response.ok)throw new Error(result.error||'Visit times could not be loaded.');if(sequence!==availabilitySequence)return;
      if(!result.slots.length){emptyTimes('No times available');scheduleHelp.textContent='No times are available on this date. Choose another day. Sundays are closed; times shown are Central Time.';return;}
      timeOptions.replaceChildren();for(const time of result.slots){const label=document.createElement('label');label.className='visit-time-slot';const input=document.createElement('input');input.type='radio';input.name='visitTimeChoice';input.value=time;input.required=true;input.setAttribute('aria-label',time+' Central Time');input.addEventListener('change',()=>{timeField.value=input.value;message.textContent='';});const number=document.createElement('span');number.textContent=time;label.append(input,number);timeOptions.append(label);}scheduleHelp.textContent='Select a numbered time slot · 24-hour clock · Central Time. The pharmacy must accept your request before it is confirmed.';
    }catch(error){if(sequence===availabilitySequence){emptyTimes('Times unavailable');scheduleHelp.textContent=error.message+' Please call (210) 295-9371 if you need help.';}}
  }
  async function initialiseSchedule(){
    dateToggle.disabled=true;try{const response=await fetch('/api/availability',{cache:'no-store'});if(!response.ok)throw new Error();const result=await response.json();minDate=result.minDate;maxDate=result.maxDate;calendarMonth=minDate.slice(0,7);dateToggle.disabled=false;}
    catch{message.textContent='Online visit requests are unavailable. Please call (210) 295-9371.';}
    try{const session=await (await fetch('/api/session',{cache:'no-store',credentials:'same-origin'})).json();document.getElementById('returning-visitor-note').hidden=!session.visitorAuthenticated;document.getElementById('sms-availability').textContent=session.smsAvailable?'We will text your confirmed date and time, or a reason if your request is declined.':'SMS updates are currently unavailable. Check Visit history for the pharmacy’s decision.';}catch{}
  }
  nameField.addEventListener('input',checkName);phoneField.addEventListener('input',checkPhone);
  visitForm.addEventListener('submit',async event=>{
    event.preventDefault();if(submitting)return;checkName();checkPhone();if(!visitForm.reportValidity())return;if(!dateField.value){message.textContent='Choose your preferred date from the calendar.';dateToggle.setAttribute('aria-invalid','true');openCalendar();return;}if(!timeField.value){message.textContent='Choose an available numbered time slot. If this date has no times, choose another date.';dateToggle.focus();return;}
    submitting=true;message.textContent='';const submit=visitForm.querySelector('[type="submit"]');submit.disabled=true;submit.textContent='Sending your request…';
    try{
      const sessionResponse=await fetch('/api/session',{credentials:'same-origin',cache:'no-store'});if(!sessionResponse.ok)throw new Error('The visit request service is unavailable. Please call (210) 295-9371.');const session=await sessionResponse.json();
      const response=await fetch('/api/visits',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:JSON.stringify({name:nameField.value.trim(),phone:phoneField.value.trim(),reason:visitForm.elements.reason.value,visitDate:dateField.value,visitTime:timeField.value,consent:visitForm.elements.consent.checked,notificationChannels:['sms'],website:visitForm.elements.website.value})});
      const result=await response.json();if(!response.ok){if(response.status===409)await loadTimes();throw new Error(result.error||'Your request could not be sent. Please call the pharmacy.');}
      visitForm.reset();dateField.value='';dateLabel.textContent='Choose a date';closeCalendar();emptyTimes('Choose a date to see available times.');visitForm.hidden=true;success.hidden=false;document.getElementById('visit-reference').textContent='REQUEST '+result.reference;
      const requestedDateLabel=new Intl.DateTimeFormat('en-US',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'America/Chicago'}).format(new Date(result.visitDate+'T12:00:00Z'));
      document.getElementById('visit-requested-slot').textContent=requestedDateLabel+' · '+result.visitTime+' (Central Time)';
      document.getElementById('history-code-box').hidden=!result.historyCode;document.getElementById('visit-history-code').textContent=result.historyCode||'';document.getElementById('returning-visitor-note').hidden=false;document.getElementById('visit-copy-status').textContent=result.historyCode?'':'This request has been added to your signed-in visit history.';success.focus();
    }catch(error){message.textContent=error instanceof TypeError?'Connection unavailable. Please try again or call (210) 295-9371.':error.message;}
    finally{submitting=false;submit.disabled=false;submit.innerHTML='Send visit request <span aria-hidden="true">↗</span>';}
  });
  document.getElementById('another-visit').addEventListener('click',()=>{success.hidden=true;visitForm.hidden=false;message.textContent='';document.getElementById('visit-history-code').textContent='';nameField.focus();});
  document.getElementById('copy-history-code').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(document.getElementById('visit-history-code').textContent);document.getElementById('visit-copy-status').textContent='History access code copied. Keep it private.';}catch{document.getElementById('visit-copy-status').textContent='Select the code above and copy it to keep it safely.';}});
  initialiseSchedule();
}
