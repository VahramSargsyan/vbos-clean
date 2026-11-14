/** FINANCE-MONTH-04: TEST-only monthly editor, no finance ledger postings. */
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const gainFields=Object.freeze([
 ['referralCommissionBase','Комиссии за переданные работы'],
 ['purchaseCommissionBase','Комиссии / cashback от материалов'],
 ['organizationMarginBase','Организация работ'],
 ['taxOptimizationSavingsBase','Налоговая оптимизация'],
 ['otherBusinessIncomeBase','Прочий бизнес-доход']
]);
const empty=()=>Object.fromEntries(gainFields.map(([k])=>[k,'0']));
const currentMonth=()=>{
 const p=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Yerevan',year:'numeric',month:'2-digit'}).formatToParts(new Date());
 return p.find(x=>x.type==='year').value+'-'+p.find(x=>x.type==='month').value;
};
const monthOK=x=>/^\d{4}-(0[1-9]|1[0-2])$/.test(x);
const asCents=x=>{
 const v=String(x??'0');
 if(!/^(0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(v))throw Error('Укажи корректную положительную сумму.');
 const [a,b='']=v.split('.');
 const c=BigInt(a)*100n+(BigInt(b.padEnd(6,'0'))+5000n)/10000n;
 if(c>99999999999n)throw Error('Сумма превышает предел.');
 return c;
};
export function businessGainPreview(data){
 let n=0n;
 for(const [key] of gainFields)n+=asCents(data[key]??'0');
 return String(n/100n)+'.'+String(n%100n).padStart(2,'0');
}
const formatted=x=>{
 const [a,b]=String(x).split('.');
 return a.replace(/\B(?=(\d{3})+(?!\d))/g,'\u00a0')+','+(b||'00')+' AMD';
};
const verified=(out,month)=>out?.source==='CLEAN_TEST_MONTHLY_GAINS_NO_LEDGER'&&
 out.scope==='TEST_ONLY'&&out.financialAuthority==='GOOGLE'&&
 out.currentOperationalFinance===false&&out.ledgerEffect===false&&
 out.record?.monthKey===month&&Number.isInteger(out.record.revision);
export function businessGainEditorHtml({monthKey,draft,revision,loading=false,busy=false,available=true,error='',message='',months=[]}){
 if(!monthOK(monthKey))throw Error('INVALID_MONTH_KEY');
 let total='Проверь суммы';
 try{total=formatted(businessGainPreview(draft));}catch{}
 const amountInputs=gainFields.map(([key,title])=>
  '<label>'+esc(title)+'<input type="number" min="0" max="999999999.99" step="0.01" inputmode="decimal" data-gain-amount="'+key+'" value="'+esc(draft[key]??'0')+'"'+(busy?' disabled':'')+'></label>').join('');
 return '<h2>Дополнительная прибыль бизнеса за месяц · TEST</h2>'+
  '<p class="muted">Отдельный новый TEST-реестр, без проводок. История Google выше не перенесена. Не дублируй старые суммы.</p>'+
  '<label>Месяц <input type="month" data-gain-month value="'+esc(monthKey)+'"'+(busy?' disabled':'')+'></label>'+
  (loading?'<p role="status">Загрузка месяца…</p>':
   !available?'<button type="button" data-gain-reload>Повторить загрузку месяца</button>':
   '<form data-gain-form><div class="grid">'+amountInputs+'</div>'+
   '<label>Комментарий<textarea rows="2" maxlength="2000" data-gain-notes'+(busy?' disabled':'')+'>'+esc(draft.notes||'')+'</textarea></label>'+
   '<p class="small muted">Налоговая оптимизация — только законная подтверждённая экономия. Существующие расходы не дублировать.</p>'+
   '<div class="card"><span>Итого за месяц</span><strong data-gain-total>'+esc(total)+'</strong></div>'+
   '<p class="small muted">Версия записи: '+esc(revision||'новая')+'. Не влияет на текущие финансы.</p>'+
   '<button type="submit"'+(busy?' disabled':'')+'>'+(busy?'Сохранение…':'Сохранить в TEST')+'</button>'+
   '<button type="button" data-gain-reload'+(busy?' disabled':'')+'>Перезагрузить</button></form>')+
  (months.length?'<p class="small muted">Сохранено новых TEST-месяцев: '+esc(months.length)+'</p>':'')+
  (error?'<p role="alert">'+esc(error)+'</p>':'')+
  (message?'<p role="status">'+esc(message)+'</p>':'');
}
export function mountBusinessGainEditor(root,{fetchPage}={}){
 if(!root||typeof root.addEventListener!=='function'||typeof fetchPage!=='function')
  throw Error('BUSINESS_GAIN_EDITOR_NOT_CONFIGURED');
 let active=true,seq=0,monthKey=currentMonth(),revision=0,loading=true,busy=false,available=false;
 let draft={...empty(),notes:''},months=[],error='',message='',requestKey=null;
 const draw=()=>{if(active)root.innerHTML=businessGainEditorHtml({monthKey,draft,revision,loading,busy,available,error,message,months});};
 async function load(){
  if(!active||busy)return;
  const n=++seq,m=monthKey;loading=true;available=false;error='';message='';requestKey=null;draw();
  try{
   const out=await fetchPage('/api/finance/monthly-gains?monthKey='+encodeURIComponent(m));
   if(!active||n!==seq)return;
   if(!verified(out,m))throw Error('Источник месячных данных не подтверждён.');
   available=true;
   revision=out.record.revision;
   draft={...Object.fromEntries(gainFields.map(([k])=>[k,String(out.record[k]??'0')])),notes:String(out.record.notes||'')};
   months=Array.isArray(out.months)?out.months:[];
  }catch(e){if(active&&n===seq)error=String(e?.message||'Ошибка чтения');}
  finally{if(active&&n===seq){loading=false;draw();}}
 }
 async function save(){
  if(!active||loading||busy||!available)return;
  let preview;
  try{preview=businessGainPreview(draft);}
  catch(e){error=String(e?.message||'Ошибка суммы');draw();return;}
  requestKey??=crypto.randomUUID();const request=requestKey,m=monthKey;
  busy=true;error='';message='';draw();
  try{
   const out=await fetchPage('/api/finance/monthly-gains',{monthKey:m,...draft,requestKey:request,expectedRevision:revision});
   if(!active||m!==monthKey)return;
   if(!verified(out,m)||String(out.record.totalBusinessGainsBase)!==preview)
    throw Error('Ответ сервера не совпал с проверенным итогом.');
   revision=out.record.revision;
   draft={...Object.fromEntries(gainFields.map(([k])=>[k,String(out.record[k])])),notes:String(out.record.notes||'')};
   requestKey=null;
   message=out.superseded?'Это повтор старой версии. Перезагрузи месяц.':
    out.replayed?'Повторный запрос подтверждён.':'Сохранено в отдельном TEST-реестре.';
  }catch(e){if(active)error=String(e?.message||'Ошибка сохранения, можно повторить с тем же ключом.');}
  finally{if(active){busy=false;draw();}}
 }
 const change=e=>{
  if(e.target?.matches?.('[data-gain-month]')){
   const v=String(e.target.value||'');
   if(!monthOK(v)){error='Выбери корректный месяц.';draw();return;}
   if(v!==monthKey){monthKey=v;revision=0;draft={...empty(),notes:''};void load();}
  }
 };
 const input=e=>{
  const key=e.target?.getAttribute?.('data-gain-amount');
  if(key&&gainFields.some(([k])=>k===key))draft[key]=String(e.target.value??'');
  else if(e.target?.matches?.('[data-gain-notes]'))draft.notes=String(e.target.value??'');
  else return;
  requestKey=null;
  const el=root.querySelector?.('[data-gain-total]');
  if(el){try{el.textContent=formatted(businessGainPreview(draft));}catch{el.textContent='Проверь суммы';}}
 };
 const click=e=>{if(e.target?.closest?.('[data-gain-reload]'))void load();};
 const submit=e=>{if(e.target?.matches?.('[data-gain-form]')){e.preventDefault();void save();}};
 for(const [n,fn] of [['change',change],['input',input],['click',click],['submit',submit]])
  root.addEventListener(n,fn);
 draw();void load();
 return {load,unmount(){active=false;seq++;for(const [n,fn] of [['change',change],['input',input],
  ['click',click],['submit',submit]])root.removeEventListener(n,fn);}};
}
