// VBOS Clean PWA: synthetic read-only Engineering preview, no data access, writes or engineering calculation.
export const SOURCE_LOCK=Object.freeze({system:'VBOS_LEGACY_ENGINEERING',schemaVersion:'v0.9.1',schemaBlobSha:'49afa9d7a557ec4f493925b9895810dd2085d1f7',commitSha:'ce72ffdcd1d0eaa04113bcb32f9b4b6065be39f9',revision:1});
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const insist=(x,c)=>{if(!x)throw Error('ENG_PREVIEW_'+c)};
const shape=a=>JSON.stringify(a.map(([xMm,yMm])=>({xMm,yMm})));
export const exampleRows=()=>({
 EngineeringProjects:[{engineeringProjectId:'ENG-2026-0001',name:'Контрольная квартира',measurementUnit:'MM',status:'DRAFT'}],
 EngineeringFloors:[{engineeringFloorId:'EFL-2026-0001',engineeringProjectId:'ENG-2026-0001',name:'Этаж 1',levelIndex:1,elevationMm:0,status:'DRAFT'},{engineeringFloorId:'EFL-2026-0002',engineeringProjectId:'ENG-2026-0001',name:'Этаж 2',levelIndex:2,elevationMm:3000,status:'DRAFT'}],
 EngineeringRooms:[['ERM-2026-0001','EFL-2026-0001','Кухня'],['ERM-2026-0002','EFL-2026-0001','Гостиная'],['ERM-2026-0003','EFL-2026-0001','Спальня'],['ERM-2026-0004','EFL-2026-0002','Кабинет'],['ERM-2026-0005','EFL-2026-0002','Спальня 2']].map(([engineeringRoomId,engineeringFloorId,name])=>({engineeringRoomId,engineeringFloorId,engineeringProjectId:'ENG-2026-0001',name,ceilingHeightMm:2800,status:'DRAFT'})),
 EngineeringRoomZones:[['ERZ-2026-0001','ERM-2026-0001','EFL-2026-0001',[[0,0],[3500,0],[3500,4000],[0,4000]]],['ERZ-2026-0002','ERM-2026-0002','EFL-2026-0001',[[3800,0],[9600,0],[9600,4000],[3800,4000]]],['ERZ-2026-0003','ERM-2026-0003','EFL-2026-0001',[[0,4400],[9600,4400],[9600,8000],[0,8000]]],['ERZ-2026-0004','ERM-2026-0004','EFL-2026-0002',[[0,0],[4000,0],[4000,4000],[0,4000]]],['ERZ-2026-0005','ERM-2026-0005','EFL-2026-0002',[[4500,0],[9000,0],[9000,4000],[4500,4000]]]].map(([engineeringRoomZoneId,engineeringRoomId,engineeringFloorId,points])=>({engineeringRoomZoneId,engineeringRoomId,engineeringFloorId,engineeringProjectId:'ENG-2026-0001',geometryType:'POLYGON',verticesJson:shape(points),status:'DRAFT'}))
});
const area=p=>Math.abs(p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length];return sum+a.xMm*b.yMm-b.xMm*a.yMm},0))/2;
const unique=(rows,key)=>{const ids=new Set();for(const r of rows){insist(typeof r[key]==='string'&&r[key].length>0,'INVALID_ID');insist(!ids.has(r[key]),'DUPLICATE_ID');ids.add(r[key])}};
const cross=(a,b,c)=>(b.xMm-a.xMm)*(c.yMm-a.yMm)-(b.yMm-a.yMm)*(c.xMm-a.xMm);
const within=(a,b,c)=>Math.min(a.xMm,c.xMm)<=b.xMm&&b.xMm<=Math.max(a.xMm,c.xMm)&&Math.min(a.yMm,c.yMm)<=b.yMm&&b.yMm<=Math.max(a.yMm,c.yMm);
const crosses=(a,b,c,d)=>{const x=cross(a,b,c),y=cross(a,b,d),z=cross(c,d,a),w=cross(c,d,b);return ((x>0&&y<0)||(x<0&&y>0))&&((z>0&&w<0)||(z<0&&w>0))||x===0&&within(a,c,b)||y===0&&within(a,d,b)||z===0&&within(c,a,d)||w===0&&within(c,b,d)};
function simplePolygon(p){for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++){if(j===i+1||(i===0&&j===p.length-1))continue;if(crosses(p[i],p[(i+1)%p.length],p[j],p[(j+1)%p.length]))return false}return true}

export function previewSnapshot(rows=exampleRows(),source=SOURCE_LOCK){
 insist(source&&Object.keys(SOURCE_LOCK).every(k=>source[k]===SOURCE_LOCK[k]),'SOURCE_MISMATCH');
 insist(rows&&['EngineeringProjects','EngineeringFloors','EngineeringRooms','EngineeringRoomZones'].every(k=>Array.isArray(rows[k])),'COLLECTIONS_REQUIRED');
 const [projects,floors,rooms,zones]=[rows.EngineeringProjects,rows.EngineeringFloors,rows.EngineeringRooms,rows.EngineeringRoomZones];
 insist(projects.length===1&&projects[0].measurementUnit==='MM'&&projects[0].status!=='ARCHIVED','PROJECT_INVALID');
 const p=projects[0];insist(floors.length>0&&floors.length<=50&&rooms.length<=1000&&zones.length<=1000,'SIZE_LIMIT');
 unique(floors,'engineeringFloorId');unique(rooms,'engineeringRoomId');unique(zones,'engineeringRoomZoneId');
 const output=floors.map(f=>{
  insist(f.engineeringProjectId===p.engineeringProjectId&&f.status!=='ARCHIVED'&&Number.isInteger(f.elevationMm),'FLOOR_INVALID');
  const mapped=rooms.filter(r=>r.engineeringFloorId===f.engineeringFloorId).map(r=>{
   insist(r.engineeringProjectId===p.engineeringProjectId&&r.status!=='ARCHIVED'&&Number.isInteger(r.ceilingHeightMm)&&r.ceilingHeightMm>0,'ROOM_INVALID');
   const own=zones.filter(z=>z.engineeringRoomId===r.engineeringRoomId);
   insist(own.length===1,'ZONE_CARDINALITY');
   const z=own[0];insist(z.engineeringFloorId===f.engineeringFloorId&&z.engineeringProjectId===p.engineeringProjectId&&z.geometryType==='POLYGON'&&z.status!=='ARCHIVED','ZONE_INVALID');
   let boundary;try{boundary=JSON.parse(z.verticesJson)}catch{throw Error('ENG_PREVIEW_POLYGON_JSON')};
   insist(Array.isArray(boundary)&&boundary.length>=3&&boundary.length<=24&&boundary.every(v=>v&&Number.isInteger(v.xMm)&&Number.isInteger(v.yMm)&&Math.abs(v.xMm)<=1000000&&Math.abs(v.yMm)<=1000000),'BAD_POLYGON');
   insist(boundary.every((v,i)=>v.xMm!==boundary[(i+1)%boundary.length].xMm||v.yMm!==boundary[(i+1)%boundary.length].yMm)&&area(boundary)>0,'DEGENERATE_POLYGON');
   insist(simplePolygon(boundary),'SELF_INTERSECTING_POLYGON');
   return {engineeringRoomId:r.engineeringRoomId,engineeringRoomZoneId:z.engineeringRoomZoneId,name:r.name,ceilingHeightMm:r.ceilingHeightMm,boundary,areaMm2:area(boundary),noHeatZones:[]};
  });
  insist(mapped.length>0,'EMPTY_FLOOR');return {engineeringFloorId:f.engineeringFloorId,name:f.name,levelIndex:f.levelIndex,elevationMm:f.elevationMm,rooms:mapped};
 }).sort((a,b)=>a.levelIndex-b.levelIndex);
 insist(output.reduce((n,f)=>n+f.rooms.length,0)===rooms.length&&zones.length===rooms.length,'ORPHAN_ENTITY');
 return {contractVersion:'VBOS_ENGINEERING_SNAPSHOT_V2_DRAFT',engineeringProjectId:p.engineeringProjectId,geometryUnit:'MM',source:{...source},projectName:p.name,fixtureKind:'SYNTHETIC_SCHEMA_ALIGNED',floors:output};
}
export function previewHtml(s,{floorId='',roomId=''}={}){
 insist(s&&s.floors&&s.floors.length,'SNAPSHOT_REQUIRED');
 const f=s.floors.find(x=>x.engineeringFloorId===floorId)||s.floors[0],r=f.rooms.find(x=>x.engineeringRoomId===roomId)||f.rooms[0];
 const pts=f.rooms.flatMap(r=>r.boundary),xs=pts.map(v=>v.xMm),ys=pts.map(v=>v.yMm),minX=Math.min(...xs),minY=Math.min(...ys),maxX=Math.max(...xs),maxY=Math.max(...ys);
 const fm=n=>(n/1e6).toLocaleString('ru-RU',{maximumFractionDigits:2});
 const floorBtns=s.floors.map(x=>'<button type="button" data-eg-floor="'+esc(x.engineeringFloorId)+'" aria-pressed="'+(x===f)+'">'+esc(x.name)+'</button>').join('');
 const drawings=f.rooms.map(x=>{const xx=x.boundary.map(q=>q.xMm),yy=x.boundary.map(q=>q.yMm),cx=(Math.min(...xx)+Math.max(...xx))/2,cy=(Math.min(...yy)+Math.max(...yy))/2;return '<g class="'+(x===r?'eg-selected':'')+'"><polygon points="'+x.boundary.map(v=>v.xMm+','+v.yMm).join(' ')+'"/><text x="'+cx+'" y="'+(cy-110)+'" text-anchor="middle">'+esc(x.name)+'</text><text x="'+cx+'" y="'+(cy+150)+'" text-anchor="middle" class="eg-area">'+fm(x.areaMm2)+' м²</text></g>'}).join('');
 const roomBtns=f.rooms.map(x=>'<button type="button" data-eg-room="'+esc(x.engineeringRoomId)+'" aria-pressed="'+(x===r)+'"><b>'+esc(x.name)+'</b><span>'+fm(x.areaMm2)+' м²</span></button>').join('');
 return '<section class="eg-preview"><div class="eg-heading"><h1>Инженерия</h1><strong>ДЕМО · только просмотр</strong></div><p>'+esc(s.projectName)+'</p><p class="eg-warning">Тестовая геометрия, соответствующая структуре EngineeringProjects / Floors / Rooms / RoomZones. Это не реальные проекты или данные PostgreSQL. Теплопотери и тёплый пол не рассчитываются.</p><div class="eg-summary"><b>'+s.floors.length+' этажа</b><b>'+s.floors.reduce((n,x)=>n+x.rooms.length,0)+' помещений</b><b>Координаты: мм</b></div><div class="eg-floors">'+floorBtns+'</div><div class="eg-columns"><div class="eg-card"><h2>План · '+esc(f.name)+'</h2><svg viewBox="'+[minX-400,minY-400,maxX-minX+800,maxY-minY+800].join(' ')+'" role="img" aria-label="Контуры помещений">'+drawings+'</svg><p class="muted">Площадь по контуру Room Zone; без вычета стен и исключений.</p></div><div class="eg-card"><h2>Помещения</h2><div class="eg-rooms">'+roomBtns+'</div><hr><b>'+esc(r.name)+'</b><p class="muted">ID: '+esc(r.engineeringRoomId)+'<br>Zone: '+esc(r.engineeringRoomZoneId)+'<br>Высота: '+r.ceilingHeightMm+' мм</p></div></div><p class="muted">Схема v0.9.1, blob '+esc(s.source.schemaBlobSha.slice(0,12))+'…; источник TEST commit '+esc(s.source.commitSha.slice(0,12))+'…; сами комнаты синтетические.</p></section>';
}
