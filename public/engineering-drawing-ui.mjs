// Clean Engineering drawing-first mobile editor. Actual geometry feeds pinned VBOS thermal source.
// Draft remains local until explicit JSON export; NO DB, legacy ID mapping or canonical Sheets writes.
import {newDrawing,validateDrawing,drawRect,drawingGeometry,calculateFromDrawing,exportDrawing,importDrawing} from './engineering-drawing-geometry.mjs';
export {newDrawing,validateDrawing,drawRect,calculateFromDrawing,exportDrawing,importDrawing};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nfmt=n=>Number(n).toLocaleString('ru-RU',{maximumFractionDigits:2});
const roleOptions=[['UNKNOWN','Не задано'],['EXTERIOR','Наружная'],['HEATED_ADJACENT','Смежное отапливаемое помещение']];
const names=['Верхняя','Правая','Нижняя','Левая'];
const thermalInputs=[
 ['heightMm','Высота помещения, мм'],
 ['indoorTempC','Расчётная температура внутри, °C'],
 ['outdoorTempC','Расчётная температура снаружи, °C'],
 ['wallU','U наружных стен, Вт/(м²·К)'],
 ['windowU','U окон, Вт/(м²·К)'],
 ['doorU','U наружных дверей, Вт/(м²·К)'],
 ['airChangesPerHour','Воздухообмен, 1/ч'],
 ['heatCapacityFactorWhM3K','Теплоёмкостный коэффициент воздуха, Вт·ч/(м³·К)'],
 ['reservePct','Расчётный резерв, %'],
 ['floorU','U холодного пола, Вт/(м²·К)'],
 ['floorBoundaryTempC','Температура под полом, °C'],
 ['validatedGroundHeatLossW','Подтверждённые потери в грунт, Вт'],
 ['ceilingU','U холодного потолка, Вт/(м²·К)'],
 ['ceilingBoundaryTempC','Температура над потолком, °C']
];
const select=(name,values,current)=>'<label class="ed-field"><span>'+esc(name)+'</span><select name="'+esc(values)+'">'+current.map(([v,t])=>'<option value="'+esc(v)+'"'+(t===undefined?'':"")+'>'+esc(t)+'</option>').join('')+'</select></label>';
const choice=(name,label,current,options)=>'<label class="ed-field"><span>'+esc(label)+'</span><select name="'+name+'">'+options.map(([key,title])=>'<option value="'+esc(key)+'"'+(current===key?' selected':'')+'>'+esc(title)+'</option>').join('')+'</select></label>';
const input=(name,label,value,placeholder='Без допущений')=>'<label class="ed-field"><span>'+esc(label)+'</span><input name="'+esc(name)+'" type="text" inputmode="decimal" maxlength="80" value="'+esc(value??'')+'" placeholder="'+esc(placeholder)+'"></label>';
export function pointFromTap(clientX,clientY,rect){
 if(!rect||rect.width<=0||rect.height<=0)throw Error('CANVAS_SIZE_INVALID');
 const x=Math.round(Math.max(0,Math.min(12000,(clientX-rect.left)/rect.width*12000))/250)*250;
 const y=Math.round(Math.max(0,Math.min(12000,(clientY-rect.top)/rect.height*12000))/250)*250;
 return {xMm:x,yMm:y};
}
export function commitDraftForm(draft,values){
 const d=validateDrawing(draft);
 d.roomName=String(values.roomName??'').trim().slice(0,120);
 d.name=String(values.projectName??d.name).trim().slice(0,120);
 const raw=String(values.wallThicknessMm??'').trim().replace(',','.');
 d.wallThicknessMm=raw?Number(raw):null;
 d.wallRoles=[0,1,2,3].map(i=>String(values['wallRole'+i]||'UNKNOWN'));
 d.thermal=Object.fromEntries(thermalInputs.map(([k])=>[k,String(values[k]??'').trim()]));
 d.thermal.floorBoundaryType=String(values.floorBoundaryType||'');
 d.thermal.ceilingBoundaryType=String(values.ceilingBoundaryType||'');
 // Fail closed if previously drawn openings now point at an interior or unclassified wall.
 validateDrawing(d);
 return d;
}
export function addOpening(draft,raw){
 const d=validateDrawing(draft);
 const op={
  edgeIndex:Number(raw.edgeIndex),openingType:String(raw.openingType||''),
  widthMm:Number(raw.widthMm),heightMm:Number(raw.heightMm),
  offsetFromWallStartMm:Number(raw.offsetFromWallStartMm)
 };
 d.openings.push(op);
 validateDrawing(d);
 return d;
}
export function renderDrawing(draft,result=null,anchor=null,message='',floorRooms=[]){
 const d=validateDrawing(draft);
 let geom=null;
 try{if(d.corners?.length===2&&d.wallThicknessMm)geom=drawingGeometry(d);}catch{}
 const p=d.corners?.length===2?(()=>{const [a,b]=d.corners;return {x:Math.min(a.xMm,b.xMm),y:Math.min(a.yMm,b.yMm),w:Math.abs(a.xMm-b.xMm),h:Math.abs(a.yMm-b.yMm)}})():null;
 const grid=Array.from({length:5},(_,i)=>{const v=(i+1)*2000;return '<line x1="'+v+'" y1="0" x2="'+v+'" y2="12000"/><line x1="0" y1="'+v+'" x2="12000" y2="'+v+'"/>'}).join('');
 const shape=p?'<rect class="ed-room" x="'+p.x+'" y="'+p.y+'" width="'+p.w+'" height="'+p.h+'"/>'+[0,1,2,3].map(i=>{
  const edges=[[p.x,p.y,p.x+p.w,p.y],[p.x+p.w,p.y,p.x+p.w,p.y+p.h],[p.x+p.w,p.y+p.h,p.x,p.y+p.h],[p.x,p.y+p.h,p.x,p.y]];
  const e=edges[i];return '<line class="ed-wall '+(d.wallRoles[i]==='EXTERIOR'?'ed-exterior':'')+'" x1="'+e[0]+'" y1="'+e[1]+'" x2="'+e[2]+'" y2="'+e[3]+'"/>';
 }).join(''):'';
 const overlays=Array.isArray(floorRooms)?floorRooms.filter(x=>x&&x.roomId!==d.roomId&&Array.isArray(x.corners)&&x.corners.length===2).map(x=>{const a=x.corners[0],b=x.corners[1];const x0=Math.min(a.xMm,b.xMm),y0=Math.min(a.yMm,b.yMm),w=Math.abs(a.xMm-b.xMm),h=Math.abs(a.yMm-b.yMm);return '<rect class="ed-neighbor" x="'+x0+'" y="'+y0+'" width="'+w+'" height="'+h+'"/><text class="ed-neighbor-label" x="'+(x0+w/2)+'" y="'+(y0+h/2)+'" text-anchor="middle">'+esc(String(x.roomName||'').slice(0,16))+'</text>';}).join(''):'';
 const anchorDot=anchor?'<circle cx="'+anchor.xMm+'" cy="'+anchor.yMm+'" r="200" fill="#d94826"/>':'';
 const resultHtml=result?result.status==='COMPLETE'
  ?'<div class="ed-results"><strong>'+nfmt(result.heatLoss.requiredHeatW)+' Вт</strong><span>Теплопотери по чертежу с резервом</span><p>Стены: '+nfmt(result.heatLoss.transmission.wallsW)+' Вт · Окна: '+nfmt(result.heatLoss.transmission.windowsW)+' Вт · Воздух: '+nfmt(result.heatLoss.airLossW)+' Вт</p></div>'
  :'<p class="ed-warning">Расчёт '+esc(result.status)+': нужны или требуют проверки '+esc((result.missingInputs||result.invalidInputs||[]).join(', ')||'параметры геометрии')+'</p>':'';
 return '<section class="card ed-editor"><h2>Чертёж → автоматические теплопотери</h2>'+
 '<p class="muted">На поле черти текущую комнату двумя касаниями по сетке 12×12 м с шагом 250 мм. Ранее добавленные комнаты показаны бледно — совмещай общие границы точно, тогда система определит общую стену автоматически.</p>'+
 '<svg data-ed-canvas class="ed-canvas" viewBox="0 0 12000 12000" aria-label="Чертёж комнаты; нажми два противоположных угла"><rect x="0" y="0" width="12000" height="12000" fill="transparent"/><g class="ed-grid">'+grid+'</g><g class="ed-neighbors">'+overlays+'</g>'+shape+anchorDot+'</svg>'+
 '<div class="ed-tools"><button type="button" data-ed-reset>Новый контур</button><button type="button" data-ed-export>Сохранить чертёж в JSON</button><label class="ed-import">Открыть JSON<input type="file" data-ed-import accept=".json,application/json"></label></div>'+
 (anchor?'<p class="muted">Первый угол: '+anchor.xMm+' × '+anchor.yMm+' мм. Нажми второй.</p>':'')+
 (p?'<p><strong>Контур:</strong> '+nfmt(p.w/1000)+' × '+nfmt(p.h/1000)+' м'+(geom?' · полезная площадь с учётом стен '+nfmt(geom.metrics.areaMm2/1000000)+' м²':'')+'</p>':'<p>Пока нет чертежа. Нажми на поле дважды.</p>')+
 (message?'<p class="ed-warning">'+esc(message)+'</p>':'')+
 '<form id="engineeringDrawingParameters"><fieldset><legend>Помещение и стены</legend>'+
 input('projectName','Название чертежа',d.name,'Например, квартира')+
 input('roomName','Название комнаты',d.roomName,'Например, спальня')+
 input('wallThicknessMm','Толщина стен, мм',d.wallThicknessMm??'')+
 '<div class="ed-two">'+[0,1,2,3].map(i=>choice('wallRole'+i,names[i]+' стена',d.wallRoles[i],roleOptions)).join('')+'</div></fieldset>'+
 '<fieldset><legend>Нужные теплотехнические параметры</legend><p class="muted">Размеры, площадь и объём берём из чертежа. U, температуры и воздухообмен — из выбранных материалов и проектных условий; пустые значения не угадываем.</p>'+
 '<div class="ed-two">'+thermalInputs.slice(0,9).map(([k,label])=>input(k,label,d.thermal[k]??'')).join('')+'</div>'+
 '<div class="ed-two">'+choice('floorBoundaryType','Под полом',d.thermal.floorBoundaryType,[['','Укажи'],['HEATED','Отапливаемое помещение'],['EXTERIOR','Холодное пространство'],['GROUND','Грунт — с готовым расчётом']])+
 choice('ceilingBoundaryType','Над потолком',d.thermal.ceilingBoundaryType,[['','Укажи'],['HEATED','Отапливаемое помещение'],['EXTERIOR','Холодное пространство']])+'</div>'+
 '<div class="ed-two">'+thermalInputs.slice(9).map(([k,label])=>input(k,label,d.thermal[k]??'')).join('')+'</div></fieldset>'+
 '<button class="primary wide" type="submit">Применить параметры и рассчитать</button></form>'+
 (p?'<form id="engineeringDrawingOpening"><fieldset><legend>Окна и двери</legend><p>Добавь проём на конкретной наружной стене — его площадь будет вычтена из стены.</p>'+
 choice('edgeIndex','Стена','0',names.map((name,i)=>[String(i),name]))+
 choice('openingType','Проём','WINDOW',[['WINDOW','Окно'],['DOOR','Наружная дверь']])+
 '<div class="ed-two">'+input('widthMm','Ширина проёма, мм','','')+input('heightMm','Высота проёма, мм','','')+input('offsetFromWallStartMm','Отступ от начала стены, мм','0','')+'</div>'+
 '<button type="submit">Добавить проём</button></fieldset></form>':'')+
 (d.openings.length?'<div class="ed-openings"><strong>Проёмы:</strong> '+d.openings.map((o,i)=>'<button type="button" data-ed-remove="'+i+'">'+esc(o.openingType)+' '+esc(names[o.edgeIndex])+' '+o.widthMm+'×'+o.heightMm+' мм ×</button>').join('')+'</div>':'')+
 '<div class="ed-output"><h3>Результат расчёта</h3>'+resultHtml+
 '<p class="muted">Чертёж существует только в текущем экране до экспорта JSON. Нет сохранения в PostgreSQL и нет связи со старым Engineering. Это реальный ограниченный редактор одного прямоугольного помещения, не полный Mini-CAD.</p></div></section>';
}
