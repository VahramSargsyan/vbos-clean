// Exact pure-engine net geometry span from EngineeringRoomNetMetricsService v0.2.7,
// source blob d5eabecc60a82c988ad3b5999980ad0499fc10f7. Wrapper only supports 4-point drawn rectangles.
// The original net-area functions below depend on RoomZone normalizer and metrics.
// For drawing P1 only orthogonal 4-point rectangles are valid; adapt by fail-closed shim.
function engineeringRoomZoneNormalizeVerticesV024_(vertices){
 if(!Array.isArray(vertices)||vertices.length!==4)throw Error('RECTANGLE_ONLY_P1');
 const p=vertices.map(v=>({xMm:v.xMm,yMm:v.yMm}));
 if(p.some(v=>!Number.isSafeInteger(v.xMm)||!Number.isSafeInteger(v.yMm)||Math.abs(v.xMm)>1e6||Math.abs(v.yMm)>1e6))throw Error('BAD_MM_VERTEX');
 const xs=[...new Set(p.map(v=>v.xMm))],ys=[...new Set(p.map(v=>v.yMm))];
 if(xs.length!==2||ys.length!==2||!p.every((v,i)=>p.some(u=>u.xMm===v.xMm&&u.yMm===v.yMm)))throw Error('RECTANGLE_ONLY_P1');
 if(new Set(p.map(v=>v.xMm+':'+v.yMm)).size!==4)throw Error('DUPLICATE_CORNER');
 for(let i=0;i<4;i++){const q=p[(i+1)%4],v=p[i];if((v.xMm===q.xMm)===(v.yMm===q.yMm))throw Error('BAD_RECT_EDGE');}
 return p;
}
function engineeringRoomZoneMetricsV024_(p){
 let area2=0,perimeter=0;
 for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];area2+=a.xMm*b.yMm-b.xMm*a.yMm;perimeter+=Math.hypot(b.xMm-a.xMm,b.yMm-a.yMm)}
 const areaMm2=Math.round(Math.abs(area2)/2);if(areaMm2<=0)throw Error('NONPOSITIVE_RECT_AREA');
 return {areaMm2,perimeterMm:Math.round(perimeter)};
}
const VBOS_ENGINEERING_ROOM_NET_V027 = Object.freeze({
  maxGridAxis: 160,
  defaultWallThicknessMm: 100,
  epsilon: 0.000001
});

function engineeringRoomNetUniqueSortedV027_(values) {
  const sorted=(values||[]).filter(Number.isFinite).sort(function(a,b){return a-b;});
  const out=[];
  sorted.forEach(function(value){
    if(!out.length || Math.abs(value-out[out.length-1])>VBOS_ENGINEERING_ROOM_NET_V027.epsilon) out.push(value);
  });
  return out;
}

function engineeringRoomNetIsOrthogonalV027_(vertices) {
  if(!Array.isArray(vertices)||vertices.length<3)return false;
  for(let i=0;i<vertices.length;i+=1){
    const a=vertices[i],b=vertices[(i+1)%vertices.length];
    if(Number(a.xMm)!==Number(b.xMm) && Number(a.yMm)!==Number(b.yMm))return false;
  }
  return true;
}

function engineeringRoomNetPointInPolygonV027_(point,vertices) {
  let inside=false;
  for(let i=0,j=vertices.length-1;i<vertices.length;j=i++){
    const xi=Number(vertices[i].xMm),yi=Number(vertices[i].yMm);
    const xj=Number(vertices[j].xMm),yj=Number(vertices[j].yMm);
    const intersect=((yi>point.y)!==(yj>point.y)) && (point.x < (xj-xi)*(point.y-yi)/((yj-yi)||1e-9)+xi);
    if(intersect)inside=!inside;
  }
  return inside;
}

function engineeringRoomNetWallRectV027_(wall) {
  const x1=Number(wall.startXmm),y1=Number(wall.startYmm),x2=Number(wall.endXmm),y2=Number(wall.endYmm);
  if(![x1,y1,x2,y2].every(Number.isFinite))return null;
  let thickness=Number(wall.thicknessMm);
  if(!Number.isFinite(thickness)||thickness<=0)thickness=VBOS_ENGINEERING_ROOM_NET_V027.defaultWallThicknessMm;
  const half=thickness/2;
  if(Math.abs(y1-y2)<=VBOS_ENGINEERING_ROOM_NET_V027.epsilon && Math.abs(x1-x2)>VBOS_ENGINEERING_ROOM_NET_V027.epsilon){
    return {left:Math.min(x1,x2),right:Math.max(x1,x2),top:y1-half,bottom:y1+half,wallId:String(wall.engineeringWallId||'')};
  }
  if(Math.abs(x1-x2)<=VBOS_ENGINEERING_ROOM_NET_V027.epsilon && Math.abs(y1-y2)>VBOS_ENGINEERING_ROOM_NET_V027.epsilon){
    return {left:x1-half,right:x1+half,top:Math.min(y1,y2),bottom:Math.max(y1,y2),wallId:String(wall.engineeringWallId||'')};
  }
  return null;
}

function engineeringRoomNetPointInRectV027_(point,rect) {
  return point.x>rect.left+VBOS_ENGINEERING_ROOM_NET_V027.epsilon
    && point.x<rect.right-VBOS_ENGINEERING_ROOM_NET_V027.epsilon
    && point.y>rect.top+VBOS_ENGINEERING_ROOM_NET_V027.epsilon
    && point.y<rect.bottom-VBOS_ENGINEERING_ROOM_NET_V027.epsilon;
}

function engineeringRoomNetMetricsV027_(vertices,walls) {
  const normalized=engineeringRoomZoneNormalizeVerticesV024_(vertices);
  const centerline=engineeringRoomZoneMetricsV024_(normalized);
  if(!engineeringRoomNetIsOrthogonalV027_(normalized)){
    return {supported:false,areaMm2:centerline.areaMm2,perimeterMm:centerline.perimeterMm,centerlineAreaMm2:centerline.areaMm2,centerlinePerimeterMm:centerline.perimeterMm,reason:'NON_ORTHOGONAL_ZONE'};
  }

  const xs=normalized.map(function(p){return Number(p.xMm);});
  const ys=normalized.map(function(p){return Number(p.yMm);});
  const minX=Math.min.apply(null,xs),maxX=Math.max.apply(null,xs),minY=Math.min.apply(null,ys),maxY=Math.max.apply(null,ys);
  const rects=(walls||[]).map(engineeringRoomNetWallRectV027_).filter(Boolean).filter(function(rect){
    return rect.right>minX && rect.left<maxX && rect.bottom>minY && rect.top<maxY;
  });

  const xCuts=xs.slice(),yCuts=ys.slice();
  rects.forEach(function(rect){
    xCuts.push(Math.max(minX,rect.left),Math.min(maxX,rect.right));
    yCuts.push(Math.max(minY,rect.top),Math.min(maxY,rect.bottom));
  });
  const ux=engineeringRoomNetUniqueSortedV027_(xCuts),uy=engineeringRoomNetUniqueSortedV027_(yCuts);
  if(ux.length<2||uy.length<2||ux.length>VBOS_ENGINEERING_ROOM_NET_V027.maxGridAxis||uy.length>VBOS_ENGINEERING_ROOM_NET_V027.maxGridAxis){
    return {supported:false,areaMm2:centerline.areaMm2,perimeterMm:centerline.perimeterMm,centerlineAreaMm2:centerline.areaMm2,centerlinePerimeterMm:centerline.perimeterMm,reason:'GRID_LIMIT'};
  }

  const cols=ux.length-1,rows=uy.length-1,free=[];
  let area=0;
  for(let y=0;y<rows;y+=1){
    free[y]=[];
    for(let x=0;x<cols;x+=1){
      const left=ux[x],right=ux[x+1],top=uy[y],bottom=uy[y+1];
      if(right-left<=VBOS_ENGINEERING_ROOM_NET_V027.epsilon||bottom-top<=VBOS_ENGINEERING_ROOM_NET_V027.epsilon){free[y][x]=false;continue;}
      const point={x:(left+right)/2,y:(top+bottom)/2};
      const inside=engineeringRoomNetPointInPolygonV027_(point,normalized);
      const occupied=inside && rects.some(function(rect){return engineeringRoomNetPointInRectV027_(point,rect);});
      free[y][x]=inside&&!occupied;
      if(free[y][x])area+=(right-left)*(bottom-top);
    }
  }

  let perimeter=0;
  for(let y=0;y<rows;y+=1){
    for(let x=0;x<cols;x+=1){
      if(!free[y][x])continue;
      const width=ux[x+1]-ux[x],height=uy[y+1]-uy[y];
      if(x===0||!free[y][x-1])perimeter+=height;
      if(x===cols-1||!free[y][x+1])perimeter+=height;
      if(y===0||!free[y-1][x])perimeter+=width;
      if(y===rows-1||!free[y+1][x])perimeter+=width;
    }
  }

  const areaMm2=Math.round(area),perimeterMm=Math.round(perimeter);
  if(areaMm2<=0){
    return {supported:false,areaMm2:centerline.areaMm2,perimeterMm:centerline.perimeterMm,centerlineAreaMm2:centerline.areaMm2,centerlinePerimeterMm:centerline.perimeterMm,reason:'NO_FREE_AREA'};
  }
  return {
    supported:true,
    areaMm2:areaMm2,
    perimeterMm:perimeterMm,
    centerlineAreaMm2:centerline.areaMm2,
    centerlinePerimeterMm:centerline.perimeterMm,
    wallCount:rects.length
  };
}


export {engineeringRoomNetMetricsV027_ as netRoomMetrics};
