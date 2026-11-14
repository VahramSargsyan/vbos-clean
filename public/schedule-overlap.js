'use strict';
/* VBOS Clean Capacity V1G: exact legacy PlanOverlapIndicator v1.8.6 and
 * OverlapNavigator v1.8.7. Read-only; source is the already loaded, complete
 * planned ScheduleItems hourly response, not the paged visible Plan list.
 * A "coincidence" means 2+ plans on a date, NOT confirmed time overlap.
 */
let scheduleOverlapActive='';
let scheduleFreeActive='';
function scheduleOverlapCounts(){
 if(!hourlyReady())return null; // never signal a complete zero from partial data
 const counts=new Map();
 const first=schedule.periodStart,last=schedule.periodEnd;
 for(let day=first;day<=last;day=scheduleShiftDay(day,1))counts.set(day,0);
 for(const item of hourlySchedule.items){
  if(item.status!=='planned')continue;
  const from=hourlyLocal(item.start_at).slice(0,10);
  const until=hourlyLocal(item.end_at).slice(0,10);
  let day=from<first?first:from;
  const end=until>last?last:until;
  for(;day<=end;day=scheduleShiftDay(day,1)){
   if(counts.has(day))counts.set(day,counts.get(day)+1);
  }
 }
 return counts;
}
function scheduleOverlapDays(counts){
 if(!counts)return [];
 return [...counts].filter(([,count])=>count>=2).map(([day])=>day);
}
function scheduleOverlapTitle(count){
 return 'Совпадают планы: '+count+'. Это сигнал для проверки, а не подтверждённая перегрузка.';
}
function scheduleOverlapBadge(day,counts){
 const n=counts?.get(day)||0;
 if(n<2)return '';
 return '<span class="schedule-overlap-badge" title="'+esc(scheduleOverlapTitle(n))+'">⚠ '+n+'</span>';
}
function scheduleOverlapToolbar(counts){
 if(!counts)return '<p class="muted small" data-schedule-overlap-status>Совпадения дней: полное расписание загружается или недоступно.</p>';
 const days=scheduleOverlapDays(counts),activeIndex=days.indexOf(scheduleOverlapActive);
 return '<div class="schedule-overlap-toolbar" data-schedule-overlap-nav>'+
  '<span class="muted small" title="Дни, где стоят 2+ запланированных пункта. Это не подтверждённая перегрузка.">Совпадений дней: '+days.length+'</span>'+
  '<div class="schedule-overlap-actions">'+
  '<button type="button" class="compact" data-schedule-overlap-step="-1"'+(!days.length?' disabled':'')+'>← Совпадение</button>'+
  '<span class="schedule-overlap-position" aria-live="polite">'+(activeIndex>=0?activeIndex+1:0)+' / '+days.length+'</span>'+
  '<button type="button" class="compact" data-schedule-overlap-step="1"'+(!days.length?' disabled':'')+'>Совпадение →</button>'+
  '</div></div>';
}
function scheduleOverlapNext(delta,counts){
 const days=scheduleOverlapDays(counts);
 if(!days.length||![1,-1].includes(delta))return null;
 let index=days.indexOf(scheduleOverlapActive);
 if(index<0)index=delta>0?-1:0;
 scheduleOverlapActive=days[(index+delta+days.length)%days.length];
 return scheduleOverlapActive;
}
function scheduleFreeDays(counts){
 if(!counts)return [];
 const policy=schedule.calendarDayPolicy;
 // v1.9.4: never advertise Sunday, company/IP review, or a past date
 // as an actionable free WORKING day. Unknown policy fails closed.
 if(policy?.version!=='CALENDAR_WORKING_DAY_V194_V195'||
  policy.policyVersion!=='SHARED_CAPACITY_MON_SAT_MONTHLY_BANK_REVIEW_V2'||
  policy.periodStart!==schedule.periodStart||policy.periodEnd!==schedule.periodEnd||
  !policy.days)return [];
 return [...counts].filter(([day,count])=>count===0&&day>=data.today&&
  policy.days[day]==='WORKING_DAY').map(([day])=>day);
}
function scheduleFreeToolbar(counts){
 if(!counts)return '';
 const days=scheduleFreeDays(counts),activeIndex=days.indexOf(scheduleFreeActive);
 return '<div class="schedule-free-toolbar" data-schedule-free-nav>'+
  '<div class="schedule-overlap-actions">'+
  '<button type="button" class="compact" data-schedule-free-step="-1"'+(!days.length?' disabled':'')+'>← Свободный</button>'+
  '<span class="schedule-overlap-position" aria-live="polite">'+(activeIndex>=0?activeIndex+1:0)+' / '+days.length+'</span>'+
  '<button type="button" class="compact" data-schedule-free-step="1"'+(!days.length?' disabled':'')+'>Свободный →</button>'+
  '</div></div>';
}
function scheduleFreeNext(delta,counts){
 const days=scheduleFreeDays(counts);
 if(!days.length||![1,-1].includes(delta))return null;
 let index=days.indexOf(scheduleFreeActive);
 if(index<0)index=delta>0?-1:0;
 scheduleFreeActive=days[(index+delta+days.length)%days.length];
 return scheduleFreeActive;
}
function resetScheduleOverlap(){scheduleOverlapActive='';scheduleFreeActive='';}
