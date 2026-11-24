// Read-only owner analytics A1; same card/navigation vocabulary as existing Clean.
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const valid=x=>typeof x==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(x);
const current=()=>{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Yerevan',year:'numeric',month:'2-digit'}).formatToParts(new Date());return p.find(x=>x.type==='year').value+'-'+p.find(x=>x.type==='month').value;};
const number=x=>x===null||x===undefined?'Нет данных':Number(x).toLocaleString('ru-RU',{maximumFractionDigits:2});
const money=x=>x===null||x===undefined?'Нет данных':number(x)+' AMD';
const minutes=x=>x===null||x===undefined?'Нет данных':Math.floor(Number(x)/60)+' ч '+number(Number(x)%60)+' мин';
const percent=x=>x===null||x===undefined?'Нет данных':number(x)+'%';
const metric=(label,value,small='')=>'<div class="card"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong>'+(small?'<p class="muted small">'+esc(small)+'</p>':'')+'</div>';
const grid=x=>'<div class="summary">'+x.join('')+'</div>';
const msg=x=>'<p class="muted">'+esc(x)+'</p>';
const section=(title,desc,body)=>'<section class="card"><h2>'+esc(title)+'</h2>'+msg(desc)+body+'</section>';
const detail=(title,body)=>'<details class="card"><summary>'+esc(title)+'</summary>'+body+'</details>';
const nav=(tab,label)=>'<button type="button" data-analytics-nav="'+esc(tab)+'">'+esc(label)+'</button>';
const rows=(items,make,empty='Нет записей за выбранный месяц.')=>items.length?items.map(make).join(''):msg(empty);
const item=(head,body)=>'<div class="card"><strong>'+esc(head)+'</strong>'+msg(body)+'</div>';
const statuses={new:'Новый',contacted:'Связались',qualified:'Квалифицирован',won:'Договорились',lost:'Отказ',transferred:'Передан',unknown:'Не указано'};
const stages={new_contact:'Новый контакт',needs_discussion:'Нужно обсудить',estimate_required:'Нужна смета',estimate_sent:'Смета отправлена',negotiation:'Переговоры',approved:'Согласовано',rejected:'Отказ',unknown:'Не указано'};
const sources={repeat_client:'Повторный клиент',referral:'Сарафан',partner:'Партнёр',facebook:'Facebook',instagram:'Instagram',google:'Google',whatsapp:'WhatsApp',signboard:'Вывеска',other:'Другое',unknown:'Не указан'};
const gainLabels={referral_commission_base:'Комиссии за переданные работы',purchase_commission_base:'Комиссии / cashback от материалов',organization_margin_base:'Организация работ',tax_optimization_savings_base:'Налоговая оптимизация',other_business_income_base:'Прочий бизнес-доход'};
const coverage=f=>f.coveredMonths+'/'+f.expectedMonths+' мес. с обеими составляющими';
const countText=(xs,dict)=>xs.map(x=>(dict[x.key]||'Не указано')+': '+x.count).join(' · ');
const qty=x=>x.map(y=>number(y.value)+' '+y.unit).join(' · ')||'Нет данных';
function result(r){return r.businessResultBase!==null?money(r.businessResultBase):r.observedComponentsBase!==null?'Частично: '+money(r.observedComponentsBase):'Нет данных';}
function goal(f){
 const g=f.goal;
 return '<div class="row"><button type="button" disabled aria-describedby="analyticsGoalGate">Изменить цель</button></div><p id="analyticsGoalGate" class="muted">Сохранённая цель Clean отсутствует. Редактирование недоступно до согласования отдельного контракта хранения.</p>'+
 grid([metric('Legacy-ориентир (не установленная цель)',money(g.legacyDefaultReferenceBase),'Годовой ориентир '+money(g.referenceAnnualBase)),metric('Среднее по имеющимся полным месяцам',money(g.averageCoveredBase),coverage(f.ytd)),
 metric('Сравнение с legacy-ориентиром',percent(g.referenceProgressPercent),g.referenceGapBase===null?'Недостаточно данных':'Разрыв '+money(g.referenceGapBase)),
 metric('Нужно в оставшиеся месяцы','Недостаточно данных','Нет подтверждённой цели и полного покрытия'),metric('Rolling 12',money(g.rolling12AverageBase),coverage(f.rolling12))]);
}
function finances(f){
 const m=f.month,y=f.ytd;
 return msg('Только PostgreSQL: нативная прибыль после cutover '+(f.cutover||'не подтверждён')+' + отдельный регистр M1. Google-архив и opening profit исключены. Неполный итог — сумма известных частей, не полная прибыль.')+
 grid([metric('Business Result месяца',result(m),'Период '+m.monthKey),metric('Финансовая прибыль',money(m.financeProfitBase),m.financeStatus==='RECORDED'?'Активные операции · '+m.activeFinanceTransactionCount:'Нет подтверждённых записей за месяц'),metric('Дополнительные бизнес-доходы',money(m.businessGainsBase),m.gainsStatus==='RECORDED'?'Сохранённый итог M1':'Месяц M1 не подтверждён'),
 metric('Business Result YTD',result(y),coverage(y)),metric('Финансовая прибыль YTD',money(y.financeProfitBase),'Месяцев с записями: '+y.financeMonths),metric('Доп. прибыль YTD',money(y.businessGainsBase),'Месяцев M1: '+y.gainsMonths),
 metric('Получено за месяц',money(m.receivedBase),'Не является прибылью'),metric('Экономические расходы',money(m.economicExpenseBase)),metric('Начисленный доход',money(m.earnedBase)),metric('Денежный поток месяца',money(m.cashFlowBase),'Не является прибылью'),metric('Текущий денежный остаток',money(f.currentCashBalanceBase),'Нативный ledger · включает принятый opening cash; не входит в Business Result')])+
 detail('Состав дополнительных доходов',m.gains?grid(Object.entries(gainLabels).map(([k,l])=>metric(l,money(m.gains[k])))):msg('Сохранённой записи M1 нет.'))+
 detail('Динамика с начала года',rows(f.monthlyTrend,r=>item(r.monthKey+' · '+result(r),'Finance '+money(r.financeProfitBase)+' · M1 '+money(r.businessGainsBase))))+
 detail('Динамика Rolling 12',rows(f.rollingTrend,r=>item(r.monthKey+' · '+result(r),'Finance '+money(r.financeProfitBase)+' · M1 '+money(r.businessGainsBase))))+
 '<div class="row">'+nav('finance','Финансы')+nav('capital','Капитал · фонды')+'</div>';
}
function crm(c){
 if(!c)return msg('CRM-источник недоступен. Обнови экран.')+nav('crm','Открыть CRM');
 return grid([metric('Лиды создано',number(c.total),'Новые лиды по фактической дате · открыто сейчас '+c.active),metric('Стали клиентами',number(c.conversionEvents),'Фактические нативные связи Lead → Client'),metric('Передано мастерам',number(c.transferEvents),'Дата активной передачи'),metric('Отказ / потеря',number(c.cohortLost),'Текущий статус когорты; точная дата отказа недоступна'),metric('Конверсия когорты',percent(c.conversionPercent),'Подтверждённые связи '+c.cohortConverted+' · won без связи '+c.cohortUnconfirmedWon)])+
 detail('Стадии и статусы',msg(countText(c.stages,stages)||'Нет данных')+msg(countText(c.statuses,statuses)||'Нет данных'))+
 detail('Источники лидов',rows(c.bySource,r=>item((sources[r.source]||'Не указан')+' · '+percent(r.conversionPercent),r.total+' лидов · подтверждено '+r.confirmedConverted+' · '+countText(r.statuses,statuses))))+
 detail('События по фактическим датам',rows(c.eventsByDay,r=>item(r.date,'Создано '+r.newLeads+' · связи '+r.converted+' · передачи '+r.transferred)))+nav('crm','Открыть CRM');
}
function field(f,finance){
 if(!f)return msg('WorkLog недоступен. Обнови экран.')+nav('myWork','Моя работа');
 const p=f.planFact,r=finance.month.businessResultBase;
 const perHour=t=>r!==null&&t>0?money(Number(r)*60/t):'Нет данных';
 return grid([metric('Записано полезной работы',minutes(f.cleanMinutes),f.detailedCount+' подробных WorkLog'),metric('На объекте',minutes(f.presenceMinutes),'Закрытые интервалы присутствия · покрытие '+percent(f.loggedCoveragePercent)),metric('AMD / ч чистой работы',perHour(f.cleanMinutes),'Только при обеих составляющих Business Result'),metric('AMD / ч присутствия',perHour(f.presenceMinutes)),metric('Рабочие дни',number(f.workDayCount),f.objectCount+' объектов · '+f.workOrderCount+' заказов'),metric('Базовые WorkLog',minutes(f.basicRecordedMinutes),f.basicCount+' записей без детализации'),metric('Точки',number(f.points),number(f.pointsPerHour)+' / ч'),metric('Узлы',number(f.nodes),number(f.nodesPerHour)+' / ч'),metric('Метры',number(f.meters),number(f.metersPerHour)+' / ч'),metric('Количество',qty(f.quantityByUnit),'Единицы не складываются между собой'),metric('Разрывы с причиной',minutes(f.reasonedLongGapMinutes),'Микропереходы '+minutes(f.microTransitionMinutes)),metric('Разрывы без причины',minutes(f.unexplainedLongGapMinutes),'Порог > 15 мин · интервалы владельца'),metric('Перерывы (обед / кофе)',minutes(f.breakMinutes)),metric('Потери',minutes(f.lossMinutes)),metric('Переделки',minutes(f.reworkMinutes),f.reworkCount+' записей'),metric('Присутствие вне записанных интервалов',minutes(f.nonWorkPresenceMinutes),'Не классифицируется автоматически как потеря'),metric('Plan / Fact',minutes(p.actualCleanMinutes)+' / '+minutes(p.plannedMinutes),'Разница '+(p.varianceMinutes===null?'Нет данных':number(p.varianceMinutes)+' мин'))])+
 msg('Время присутствия и уникальное время владельца не складываются с человеко-часами WorkerTask. Подробные объёмы и ставки — только по записям с подтверждёнными полями.')+
 detail('По объектам',rows(f.byObject,x=>item(x.title||'Объект',minutes(x.cleanMinutes)+' · '+x.workLogCount+' WorkLog · точки '+number(x.points)+' ('+number(x.pointsPerHour)+'/ч) · узлы '+number(x.nodes)+' ('+number(x.nodesPerHour)+'/ч) · метры '+number(x.meters)+' ('+number(x.metersPerHour)+'/ч) · '+qty(x.quantityByUnit)))+(f.objectListTruncated?msg('Показаны 12 объектов по записанному чистому времени. Общие показатели включают все записи.'):''))+
 '<div class="row">'+nav('myWork','Моя работа')+nav('history','История работ')+nav('schedule','План')+'</div>';
}
function owner(o,finance){
 if(!o)return msg('Данные владельца недоступны.')+nav('myWork','Моя работа');
 const dayNames={FIELD:'Полевая работа',MIXED:'Смешанный',ORGANIZATIONAL:'Бизнес-время',NO_RECORDED_ACTIVITY:'Нет записанных интервалов'};
 const br=finance.month.businessResultBase;
 return grid([metric('Физическая работа (интервалы)',minutes(o.fieldTrackedMinutes),'Чистая работа '+minutes(o.fieldCleanMinutes)),metric('Организация бизнеса',minutes(o.organizationMinutes)),metric('Развитие системы',minutes(o.businessSystemMinutes)),metric('Общее уникальное время',minutes(o.uniqueMinutes),'Пересечения '+minutes(o.overlapMinutes)),metric('Business Result / ч владельца',br!==null&&o.uniqueMinutes>0?money(Number(br)*60/o.uniqueMinutes):'Нет данных'),metric('Дни с записями',number(o.recordedDayCount),'Полевых '+o.fieldDayCount+' · смешанных '+o.mixedDayCount+' · только бизнес '+o.organizationOnlyDayCount),metric('Активные таймеры',number(o.activeActivities),'Незавершённые интервалы не начисляются')])+
 msg('Учитываются только записанные интервалы OWNER / JOINT и завершённые OwnerActivity. Отсутствие записи не доказывает нулевое время.')+
 detail('Показатели по дням',rows(o.days,d=>item(d.date+' · '+(dayNames[d.dayType]||'Записи'), 'Физическая '+minutes(d.fieldTrackedMinutes)+' · организация '+minutes(d.organizationMinutes)+' · система '+minutes(d.businessSystemMinutes)+' · уникально '+minutes(d.uniqueMinutes))))+nav('myWork','Моя работа');
}
function workers(w){
 if(!w)return msg('WorkerTask недоступен.')+nav('workers','Исполнители');
 return grid([metric('Работники с заданиями',number(w.workerCount)),metric('Задания',number(w.taskCount)),metric('Завершено',number(w.completedCount)),metric('Средняя оценка','Недоступна','В WorkerTask нет finalScore')])+
 detail('По работникам',rows(w.rows,x=>item(x.name||'Исполнитель',x.taskCount+' задач · завершено '+x.completedCount+' · '+minutes(x.durationMinutes)+' · управление '+minutes(x.managementMinutes)+' · переделки '+minutes(x.reworkMinutes)))+(w.listTruncated?msg('Показаны 12 работников по записанной продолжительности. Общие показатели полные.'):''))+nav('workers','Исполнители');
}
export function analyticsBody(s){
 const f=s.finance;
 return section('Цель среднего месяца','Цель сравнивается с Business Result, а не с оборотом.',goal(f))+
 section('Финансы и Business Result','Месяц, накопление с начала года и дополнительные бизнес-доходы.',finances(f))+
 section('CRM','События по фактическим датам. Стадии и источники — текущий результат когорты выбранного месяца.',crm(s.crm))+
 section('Производительность · Room Journal','Время на объекте, записанная работа, выработка, разрывы, потери и переделки.',field(s.field,f))+
 section('Время владельца / бизнес-время','Физическая работа, организация и развитие системы. Уникальное время без повторного подсчёта.',owner(s.owner,f))+
 section('Работники','Краткая сводка WorkerTask. Рейтинг не строится.',workers(s.workers))+
 detail('Ограничения данных',rows(s.warnings||[],x=>msg(x.message)));
}
export function mountAnalyticsA1(root,{state,fetchPage,download,navigate}){
 let disposed=false,seq=0,snapshot=null,loading=false,exporting=false;
 if(!valid(state.monthKey))state.monthKey=current();
 root.innerHTML='<h1>Аналитика</h1>'+msg('Короткий управленческий разбор: цель, CRM, полевая работа, работники и бизнес-результат.')+
 '<section class="card"><form data-analytics-period><label>Месяц<input name="monthKey" id="analyticsMonth" type="month" min="2000-01" max="2099-12" required value="'+esc(state.monthKey)+'"></label><div class="row"><button type="submit" class="primary">Обновить</button><button type="button" data-analytics-export disabled>Скачать для ИИ (.txt)</button></div></form><p class="muted" data-analytics-status role="status" aria-live="polite"></p></section><div data-analytics-body></div>';
 const form=root.querySelector('[data-analytics-period]'),input=form.querySelector('input'),body=root.querySelector('[data-analytics-body]'),
  status=root.querySelector('[data-analytics-status]'),exportBtn=root.querySelector('[data-analytics-export]');
 function sync(){exportBtn.disabled=disposed||loading||exporting||!snapshot||snapshot.period.monthKey!==input.value;}
 async function load(){
  const key=input.value;if(!valid(key)){seq++;loading=false;snapshot=null;body.textContent='';status.textContent='Укажи корректный месяц (2000–2099).';sync();return;}
  state.monthKey=key;const id=++seq;loading=true;snapshot=null;body.textContent='';status.textContent='Загружаю показатели '+key+'…';sync();
  try{
   const out=await fetchPage('/api/analytics/a1?monthKey='+encodeURIComponent(key));
   if(disposed||id!==seq||input.value!==key)return;
   if(out?.version!=='CLEAN_ANALYTICS_A1_V1'||out.readonly!==true||out.period?.monthKey!==key||!out.finance)throw Error('Не подтверждён выбранный период.');
   snapshot=out;body.innerHTML=analyticsBody(out);status.textContent='Период '+key+' · Asia/Yerevan · PostgreSQL TEST';
  }catch(e){if(!disposed&&id===seq){snapshot=null;body.textContent='';status.textContent='Не удалось загрузить аналитику. Обнови экран.';}}
  finally{if(!disposed&&id===seq){loading=false;sync();}}
 }
 async function saveTxt(){
  const key=input.value;if(!snapshot||snapshot.period.monthKey!==key||loading||exporting)return;
  const id=seq;exporting=true;sync();status.textContent='Готовлю TXT-экспорт…';
  try{
   const file=await download('/api/analytics/a1/export?monthKey='+encodeURIComponent(key));
   if(disposed||id!==seq||input.value!==key)return;
   const name='VBOS_'+key+'_AI_EXPORT.txt';
   if(!file||!/^text\/plain/i.test(file.type))throw Error('TXT_REQUIRED');
   const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=name;
   document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
   status.textContent='Готово: '+name;
  }catch{if(!disposed&&id===seq)status.textContent='Не удалось скачать TXT. Повтори после обновления.';}
  finally{exporting=false;if(!disposed)sync();}
 }
 const submit=e=>{e.preventDefault();e.stopPropagation();void load();};
 const change=()=>{if(valid(input.value))state.monthKey=input.value;void load();};
 const click=e=>{const n=e.target.closest('[data-analytics-nav]');if(n){e.stopPropagation();navigate(n.dataset.analyticsNav);return;}if(e.target.closest('[data-analytics-export]')){e.stopPropagation();void saveTxt();}};
 form.addEventListener('submit',submit);input.addEventListener('change',change);root.addEventListener('click',click);
 void load();
 return {unmount(){disposed=true;seq++;form.removeEventListener('submit',submit);input.removeEventListener('change',change);root.removeEventListener('click',click);}};
}
