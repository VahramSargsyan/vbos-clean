// Clean P2 floor-level navigation and read-only whole-floor calculation presentation.
// Real geometry comes from validated P1 room drafts; no data servers or fake samples.
import {newFloor,putFloorRoom,removeFloorRoom,calculateFloor,floorSnapshot,exportFloor,importFloor} from './engineering-floor-model.mjs';
export {newFloor,putFloorRoom,removeFloorRoom,calculateFloor,exportFloor,importFloor};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n).toLocaleString('ru-RU',{maximumFractionDigits:2});
export function floorOverviewHtml(floor,activeId){
 let result,topology;
 try{result=calculateFloor(floor);topology=floor.rooms.length?floorSnapshot(floor):null}
 catch(e){result={status:'INVALID',errors:[String(e.message)],roomResults:[]};topology=null}
 const rooms=floor.rooms;
 const shapes=topology?topology.items.map((item,i)=>{
  const [a,b]=item.draft.corners,x=Math.min(a.xMm,b.xMm),y=Math.min(a.yMm,b.yMm),w=Math.abs(a.xMm-b.xMm),h=Math.abs(a.yMm-b.yMm);
  const fill=i%2?'#a8dfd2':'#ffe0a3';
  return '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" fill="'+fill+'" fill-opacity=".42" stroke="'+(activeId===item.draft.roomId?'#bd482c':'#426b77')+'" stroke-width="'+(activeId===item.draft.roomId?95:45)+'"/>'+
    '<text x="'+(x+w/2)+'" y="'+(y+h/2)+'" font-size="300" fill="#172323" text-anchor="middle">'+esc(item.draft.roomName.slice(0,18))+'</text>';
 }).join(''):'';
 const sharedLines=topology?topology.shared.map(shared=>{
  const wall=topology.snapshot.walls.find(w=>w.engineeringWallId===shared.wallId);
  return '<line x1="'+wall.startXmm+'" y1="'+wall.startYmm+'" x2="'+wall.endXmm+'" y2="'+wall.endYmm+'" stroke="#197f67" stroke-width="110" stroke-dasharray="260 120"/>';
 }).join(''):'';
 const table=rooms.map((r,i)=>{
  const rr=result.roomResults?.find(x=>x.roomId===r.roomId);
  const heat=rr?.status==='COMPLETE'?fmt(rr.heatLoss.requiredHeatW)+' Вт':rr?.status==='INCOMPLETE'?'Нужны данные':'—';
  return '<div class="ef-room"><span><strong>'+esc(r.roomName)+'</strong><small>'+esc(heat)+'</small></span><span>'+
   '<button type="button" data-ef-edit="'+esc(r.roomId)+'"'+(activeId===r.roomId?' disabled':'')+'>Изменить</button> '+
   '<button type="button" data-ef-remove="'+esc(r.roomId)+'">Удалить</button></span></div>';
 }).join('');
 const errs=(result.errors||[]).concat((result.roomResults||[]).flatMap(r=>(r.missingInputs||[]).map(x=>r.roomName+': '+x)));
 return '<section class="card ef-floor"><h2>План этажа — связанные помещения</h2>'+
  '<p class="muted">В этом блоке комнаты прямоугольные, общие стены определяются по совпадению осевых линий. Общая стена учитывается один раз. Неполные совпадения и наложения блокируются.</p>'+
  '<svg class="ef-overview" viewBox="0 0 12000 12000" aria-label="Общий план этажа" role="img"><rect x="0" y="0" width="12000" height="12000" fill="#faf9f5"/>'+shapes+sharedLines+'</svg>'+
  '<p><strong>Комнат:</strong> '+rooms.length+
  ' · <strong>Общие стены:</strong> '+(result.sharedWalls?.length||0)+
  ' · <strong>Физические стены:</strong> '+(result.physicalWallCount??'—')+'</p>'+
  (result.status==='COMPLETE'?'<div class="ef-total"><strong>'+fmt(result.totalHeatW)+' Вт</strong><span>Теплопотери всех помещений с резервом</span></div>':
    '<p class="ef-warning">Итог не рассчитан: '+esc(result.stage||'неполные данные')+'. '+esc(errs.slice(0,6).join('; '))+'</p>')+
  '<div class="ef-room-list">'+table+'</div>'+
  '<div class="ef-actions"><button type="button" data-ef-commit>Добавить / обновить комнату в плане</button>'+
  '<button type="button" data-ef-next>Сохранить текущую и чертить следующую</button>'+
  '<button type="button" data-ef-export>Сохранить весь этаж в JSON</button>'+
  '<label class="ef-file">Открыть этаж JSON<input type="file" data-ef-import accept=".json,application/json"/></label></div>'+
  '<p class="muted">План и теплопотери существуют в памяти устройства. Для продолжения после закрытия сделай JSON-экспорт. Исторические инженерные проекты и PostgreSQL этот модуль не изменяет.</p></section>';
}
