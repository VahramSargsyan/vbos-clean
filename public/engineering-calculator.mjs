// Real manual room engineering calculator. Uses pinned VBOS v0.1.0 source kernels; no server/API writes.
import {calculateHeatLoss} from './eng-heat-loss-v010.mjs';
import {evaluateRadiatorCandidates} from './eng-radiator-v010.mjs';

export const ENGINE_SOURCE=Object.freeze({
 heatLoss:{file:'EngineeringHeatLossEngine_v0_1_0.js',blob:'bc66bff2948618aa9f97cfca510cd52cae960b63',version:'ENGINEERING_HEAT_LOSS_V1'},
 radiator:{file:'EngineeringRadiatorSizingEngine_v0_1_0.js',blob:'d27605dd3fbacc0dd81f241798d25bd14da46b6a',version:'ENGINEERING_RADIATOR_SIZING_V1'}
});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n).toLocaleString('ru-RU',{maximumFractionDigits:1});
const INPUTS=[
 ['lengthM','Длина помещения, м'],['widthM','Ширина помещения, м'],['heightM','Высота помещения, м'],
 ['indoorTempC','Внутренняя расчётная температура, °C'],['outdoorTempC','Наружная расчётная температура, °C'],
 ['wallAreaM2','Наружные стены (чистая площадь без окон и дверей), м²'],['wallU','U наружных стен, Вт/(м²·К)'],
 ['windowAreaM2','Окна, м²'],['windowU','U окон, Вт/(м²·К)'],
 ['doorAreaM2','Наружные двери, м²'],['doorU','U дверей, Вт/(м²·К)'],
 ['floorU','U пола над холодным пространством, Вт/(м²·К)'],['floorBoundaryTempC','Температура под полом, °C'],['groundHeatLossW','Подтверждённые потери пола к грунту, Вт'],
 ['ceilingU','U наружного перекрытия, Вт/(м²·К)'],['ceilingBoundaryTempC','Температура над потолком, °C'],
 ['ach','Кратность воздухообмена, 1/ч'],['airFactor','Теплоёмкостный коэффициент воздуха, Вт·ч/(м³·К)'],['reservePct','Расчётный резерв, %'],
 ['ufhW','Полезный вклад тёплого пола, Вт'],['otherW','Другое отопление, Вт'],
 ['supplyTempC','Подача к радиатору, °C'],['returnTempC','Обратка радиатора, °C'],
 ['radiatorNominalW','Паспортная мощность одного прибора / секции, Вт'],
 ['radiatorRefDeltaTK','Паспортная ΔT, К'],['radiatorExponentN','Показатель степени n изготовителя']
];
const LABELS=Object.fromEntries(INPUTS.map(([k,v])=>[k,v]));
LABELS.floorType='Тип нижней границы';
LABELS.ceilingType='Тип верхней границы';
const numeric=(input,key,{min=-150,max=150,required=true}={},missing,invalid)=>{
 const raw=String(input[key]??'').trim().replace(',','.');
 if(!raw){if(required)missing.push(key);return null;}
 const n=Number(raw);
 if(!Number.isFinite(n)||n<min||n>max){invalid.push(key);return null;}
 return n;
};
const surface=(key,type,area,u,outdoor)=>({key,type,areaM2:area,uValueWm2K:u,boundaryTempC:outdoor,boundaryType:'OUTDOOR'});
export function calculateRoomHeating(input={}){
 const missing=[],invalid=[];
 const n=(key,o)=>numeric(input,key,o,missing,invalid);
 const length=n('lengthM',{min:0.01,max:1000});
 const width=n('widthM',{min:0.01,max:1000});
 const height=n('heightM',{min:0.01,max:100});
 const indoor=n('indoorTempC',{min:-50,max:80});
 const outdoor=n('outdoorTempC',{min:-100,max:80});
 const wallA=n('wallAreaM2',{min:0,max:100000});
 const windowA=n('windowAreaM2',{min:0,max:100000});
 const doorA=n('doorAreaM2',{min:0,max:100000});
 const wallU=wallA>0?n('wallU',{min:0,max:20}):null;
 const windowU=windowA>0?n('windowU',{min:0,max:20}):null;
 const doorU=doorA>0?n('doorU',{min:0,max:20}):null;
 const ach=n('ach',{min:0,max:50});
 const airFactor=n('airFactor',{min:0.0001,max:2});
 const reserve=n('reservePct',{min:0,max:200});
 const floorType=String(input.floorType||'');
 const ceilingType=String(input.ceilingType||'');
 if(!['HEATED','EXTERIOR','GROUND'].includes(floorType))missing.push('floorType');
 if(!['HEATED','EXTERIOR'].includes(ceilingType))missing.push('ceilingType');
 const floorU=floorType==='EXTERIOR'?n('floorU',{min:0,max:20}):null;
 const floorBoundaryTemp=floorType==='EXTERIOR'?n('floorBoundaryTempC',{min:-100,max:100}):null;
 const groundW=floorType==='GROUND'?n('groundHeatLossW',{min:0,max:100000}):null;
 const ceilingU=ceilingType==='EXTERIOR'?n('ceilingU',{min:0,max:20}):null;
 const ceilingBoundaryTemp=ceilingType==='EXTERIOR'?n('ceilingBoundaryTempC',{min:-100,max:100}):null;
 if(missing.length||invalid.length)return {status:invalid.length?'INVALID':'INCOMPLETE',missingInputs:missing,invalidInputs:invalid};
 if(outdoor>=indoor)return {status:'INVALID',invalidInputs:['outdoorTempC'],missingInputs:[],note:'Наружная температура должна быть ниже внутренней для режима отопления.'};
 const roomArea=length*width,volume=roomArea*height;
 const envelope={
 walls:wallA>0?[surface('walls','WALL',wallA,wallU,outdoor)]:[],
 windows:windowA>0?[surface('windows','WINDOW',windowA,windowU,outdoor)]:[],
 doors:doorA>0?[surface('doors','DOOR',doorA,doorU,outdoor)]:[]
 };
 if(floorType==='EXTERIOR')envelope.floorBoundary=surface('floor','FLOOR',roomArea,floorU,floorBoundaryTemp);
 if(floorType==='GROUND')envelope.floorBoundary={key:'ground',type:'FLOOR',boundaryType:'GROUND',validatedGroundHeatLossW:groundW};
 if(ceilingType==='EXTERIOR')envelope.ceilingBoundary=surface('ceiling','CEILING',roomArea,ceilingU,ceilingBoundaryTemp);
 const heat=calculateHeatLoss({
 roomId:String(input.roomName||'Ручной расчёт').slice(0,120),
 geometry:{volumeM3:volume},
 designConditions:{indoorTempC:indoor,outdoorTempC:outdoor},
 envelope,
 airExchange:{airChangesPerHour:ach,heatCapacityFactorWhM3K:airFactor},
 reservePct:reserve
 });
 if(heat.status!=='COMPLETE')return {status:heat.status,stage:'HEAT_LOSS',heatLoss:heat,roomAreaM2:roomArea,volumeM3:volume};
 const base={status:'COMPLETE',stage:'HEAT_LOSS',heatLoss:heat,roomAreaM2:roomArea,volumeM3:volume,source:ENGINE_SOURCE};
 const ufhStatus=String(input.ufhStatus||'NONE').toUpperCase();
 if(!['NONE','ESTIMATED','VALIDATED'].includes(ufhStatus))return {...base,status:'INVALID',stage:'RADIATOR',invalidInputs:['ufhStatus']};
 const radFields=['supplyTempC','returnTempC','radiatorNominalW','radiatorRefDeltaTK','radiatorExponentN'];
 const anyRad=radFields.some(k=>String(input[k]??'').trim()!=='');
 if(!anyRad)return {...base,stage:'HEAT_LOSS_ONLY',radiatorStatus:'INCOMPLETE'};
 const ufh=ufhStatus==='NONE'?0:n('ufhW',{min:0,max:100000});
 const other=n('otherW',{min:0,max:100000,required:false})??0;
 const supply=n('supplyTempC',{min:-20,max:150});
 const ret=n('returnTempC',{min:-20,max:150});
 const nominal=n('radiatorNominalW',{min:0.0001,max:100000});
 const reference=n('radiatorRefDeltaTK',{min:0.0001,max:150});
 const exponent=n('radiatorExponentN',{min:0.0001,max:5});
 if(missing.length||invalid.length)return {...base,stage:'RADIATOR',radiatorStatus:invalid.length?'INVALID':'INCOMPLETE',missingInputs:missing,invalidInputs:invalid};
 const kind=String(input.radiatorKind||'PANEL');
 const sized=evaluateRadiatorCandidates({
 requiredHeatW:heat.requiredHeatW,
 ufhContributionStatus:ufhStatus,
 ufhContributionW:ufh,
 otherHeatingContributionW:other,
 regime:{supplyTempC:supply,returnTempC:ret,roomTempC:indoor},
 candidates:[{candidateId:'USER_SUPPLIED_'+kind,model:kind==='SECTIONAL'?'Одна секция':'Один прибор',catalogueOutputW:nominal,referenceDeltaTK:reference,exponentN:exponent}]
 });
 return {...base,stage:'RADIATOR',radiatorStatus:sized.status,radiatorSizing:sized};
}
const field=(name,values)=>'<label class="engc-field"><span>'+esc(LABELS[name])+'</span><input type="number" inputmode="decimal" step="any" name="'+name+'" value="'+esc(values[name]??'')+'" placeholder="Введите значение"></label>';
const fields=(names,values)=>'<div class="engc-grid">'+names.map(n=>field(n,values)).join('')+'</div>';
const select=(name,label,values,options)=>'<label class="engc-field"><span>'+esc(label)+'</span><select name="'+name+'">'+options.map(([v,t])=>'<option value="'+esc(v)+'"'+(String(values[name]??'')===v?' selected':'')+'>'+esc(t)+'</option>').join('')+'</select></label>';
const issue=(r)=>{const a=(r.missingInputs||[]).map(k=>LABELS[k]||k),b=(r.invalidInputs||[]).map(k=>LABELS[k]||k);return (a.length?'<p class="engc-note">Нужны данные: '+esc(a.join('; '))+'</p>':'')+(b.length?'<p class="engc-note">Проверьте значения: '+esc(b.join('; '))+'</p>':'')+(r.note?'<p>'+esc(r.note)+'</p>':'');};
export function calculatorHtml({values={},result=null}={}){
 let output='<section class="engc-result"><h3>Результат</h3>';
 if(!result)output+='<p>Введите фактические параметры и нажмите «Рассчитать». Расчёт не сохраняется в базе.</p>';
 else if(!result.heatLoss||result.heatLoss.status!=='COMPLETE')output+='<p>Теплопотери пока не рассчитаны.</p>'+issue(result.heatLoss||result);
 else{
  const h=result.heatLoss;
  output+='<div class="engc-kpis"><div><strong>'+fmt(h.requiredHeatW)+' Вт</strong><span>Расчётная нагрузка с резервом</span></div><div><strong>'+fmt(h.transmission.totalW)+' Вт</strong><span>Ограждающие конструкции</span></div><div><strong>'+fmt(h.airLossW)+' Вт</strong><span>Воздухообмен</span></div><div><strong>'+fmt(result.roomAreaM2)+' м²</strong><span>Площадь помещения</span></div></div>';
  output+='<details><summary>Разбивка и происхождение расчёта</summary><p>Стены: '+fmt(h.transmission.wallsW)+' Вт; окна: '+fmt(h.transmission.windowsW)+' Вт; двери: '+fmt(h.transmission.doorsW)+' Вт; пол: '+fmt(h.transmission.floorW)+' Вт; потолок: '+fmt(h.transmission.ceilingW)+' Вт.</p><p>Теплопотери до резерва: '+fmt(h.baseHeatLossW)+' Вт; резерв: '+fmt(h.reservePct)+' %; объём: '+fmt(result.volumeM3)+' м³.</p><p>Engine: '+esc(h.calculationVersion)+'. Пол к грунту допускается только по уже проверенному внешнему расчёту.</p></details>';
  if(result.radiatorStatus==='COMPLETE'&&result.radiatorSizing?.candidates?.length){
   const r=result.radiatorSizing,c=r.candidates[0],kind=String(values.radiatorKind||'PANEL');
   output+='<div class="engc-kpis"><div><strong>'+fmt(r.residualLoad.residualRadiatorLoadW)+' Вт</strong><span>Остаток на радиатор</span></div><div><strong>'+fmt(c.correctedOutputW)+' Вт</strong><span>Мощность при выбранных температурах</span></div><div><strong>'+fmt(c.requiredUnits)+'</strong><span>'+(kind==='SECTIONAL'?'Количество секций':'Количество радиаторов')+'</span></div><div><strong>'+fmt(c.marginW)+' Вт</strong><span>Запас подобранной мощности</span></div></div>';
   if(r.warnings?.length)output+='<p class="engc-note">Внимание: вклад тёплого пола введён как оценка и не рассчитан этим модулем.</p>';
  }else output+='<p>Теплопотери рассчитаны. Подбор радиатора не завершён.</p>'+issue(result)+issue(result.radiatorSizing||{});
 }
 output+='</section>';
 return '<section class="card engc"><h2>Инженерия · теплопотери и радиаторы</h2><p>Расчётные движки VBOS v0.1.0. Используются только явно введённые исходные значения. Это расчёт одного помещения, не перенос старых проектов и не сертифицированный проект отопления.</p>'+
 '<form id="engineeringCalculationForm" class="engc-form">'+
 '<fieldset><legend>Помещение и расчётные температуры</legend><label class="engc-field"><span>Название помещения</span><input name="roomName" maxlength="120" value="'+esc(values.roomName??'')+'" placeholder="Например, спальня"></label>'+
 fields(['lengthM','widthM','heightM','indoorTempC','outdoorTempC'],values)+'</fieldset>'+
 '<fieldset><legend>Наружные конструкции: площади и U</legend><p class="engc-hint">Площади стен без окон и дверей. Не подставляйте выдуманные коэффициенты.</p>'+
 fields(['wallAreaM2','wallU','windowAreaM2','windowU','doorAreaM2','doorU'],values)+
 '<div class="engc-grid">'+select('floorType','Пол граничит с…',values,[['','Выберите'],['HEATED','Отапливаемым помещением'],['EXTERIOR','Холодным пространством / улицей — с заданной температурой'],['GROUND','Грунтом — есть проверенный результат']])+
 select('ceilingType','Потолок граничит с…',values,[['','Выберите'],['HEATED','Отапливаемым помещением'],['EXTERIOR','Холодным чердаком / улицей — с заданной температурой']])+'</div>'+
 '<p class="engc-hint">Если пол наружный, в расчёт входит его площадь. Если грунт — только проверенная мощность потерь, без упрощённой формулы.</p>'+
 fields(['floorU','floorBoundaryTempC','groundHeatLossW','ceilingU','ceilingBoundaryTempC'],values)+'</fieldset>'+
 '<fieldset><legend>Воздухообмен и резерв</legend>'+fields(['ach','airFactor','reservePct'],values)+'</fieldset>'+
 '<fieldset><legend>Радиатор (необязательно)</legend><p class="engc-hint">Оставьте температурный режим и паспортную мощность пустыми, если нужен только расчёт теплопотерь. Для секционного радиатора паспортная мощность вводится на ОДНУ секцию.</p>'+
 '<div class="engc-grid">'+select('radiatorKind','Вид прибора',values,[['PANEL','Панельный прибор'],['SECTIONAL','Секционный радиатор']])+
 select('ufhStatus','Вклад тёплого пола',values,[['NONE','Не учитывается'],['ESTIMATED','Оценка из другого расчёта'],['VALIDATED','Проверенная мощность']])+'</div>'+
 fields(['ufhW','otherW','supplyTempC','returnTempC','radiatorNominalW','radiatorRefDeltaTK','radiatorExponentN'],values)+'</fieldset>'+
 '<button type="submit" class="engc-run">Рассчитать</button><p class="engc-hint">Данные остаются только в текущем экране до обновления страницы. Сохранение в проект и расчёт гидравлики — отдельные этапы.</p></form>'+output+'</section>';
}