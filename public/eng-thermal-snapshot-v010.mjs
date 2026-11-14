// Existing VBOS ThermalSnapshotAdapter source blob 2ac2657c9f89957010df5e960514151e9f3575c9; body verbatim below.
import {engineeringThermalLengthMFromWallV010_,engineeringThermalOpeningAreaM2V010_,engineeringThermalProfileV010_,engineeringThermalBoundarySurfaceV010_} from './eng-thermal-passport-helpers.mjs';
// FILE_NAME: EngineeringThermalSnapshotAdapter_v0_1_0.js
// FILE_VERSION: v0.1.0
// BUILD_DATE: 2026-09-22
// WORKFLOW_MODE: BUILD_NEW_APP
// PURPOSE: Pure adapter from already-loaded Floor Canvas canonical snapshot to Room Thermal Passport.
// TEST_LEVEL: STATIC_ONLY

const VBOS_ENGINEERING_THERMAL_SNAPSHOT_V010 = Object.freeze({
  version:'ENGINEERING_THERMAL_SNAPSHOT_V1',
  toleranceMm:1
});

function engineeringThermalSnapshotActiveV010_(record){
  return record && String(record.status||'').toUpperCase()!=='ARCHIVED';
}

function engineeringThermalSnapshotVerticesV010_(zone){
  try{
    const value=typeof zone.verticesJson==='string'?JSON.parse(zone.verticesJson):zone.verticesJson;
    if(!Array.isArray(value)||value.length<3)return [];
    return value.map(function(p){return {xMm:Number(p.xMm),yMm:Number(p.yMm)};})
      .filter(function(p){return Number.isFinite(p.xMm)&&Number.isFinite(p.yMm);});
  }catch(ignore){return [];}
}

function engineeringThermalSnapshotWallSpanV010_(wall){
  const x1=Number(wall.startXmm),y1=Number(wall.startYmm),x2=Number(wall.endXmm),y2=Number(wall.endYmm);
  const tol=VBOS_ENGINEERING_THERMAL_SNAPSHOT_V010.toleranceMm;
  if(![x1,y1,x2,y2].every(Number.isFinite))return null;
  if(Math.abs(y1-y2)<=tol && Math.abs(x1-x2)>tol)return {axis:'H',fixed:(y1+y2)/2,start:Math.min(x1,x2),end:Math.max(x1,x2)};
  if(Math.abs(x1-x2)<=tol && Math.abs(y1-y2)>tol)return {axis:'V',fixed:(x1+x2)/2,start:Math.min(y1,y2),end:Math.max(y1,y2)};
  return null;
}

function engineeringThermalSnapshotEdgeSpanV010_(a,b){
  return engineeringThermalSnapshotWallSpanV010_({startXmm:a.xMm,startYmm:a.yMm,endXmm:b.xMm,endYmm:b.yMm});
}

function engineeringThermalSnapshotOverlapV010_(edge,wall){
  const e=engineeringThermalSnapshotEdgeSpanV010_(edge.a,edge.b);
  const w=engineeringThermalSnapshotWallSpanV010_(wall);
  const tol=VBOS_ENGINEERING_THERMAL_SNAPSHOT_V010.toleranceMm;
  if(!e||!w||e.axis!==w.axis||Math.abs(e.fixed-w.fixed)>tol)return 0;
  return Math.max(0,Math.min(e.end,w.end)-Math.max(e.start,w.start));
}

function engineeringThermalSnapshotZoneEdgesV010_(zone){
  const vertices=engineeringThermalSnapshotVerticesV010_(zone);
  if(vertices.length<3)return [];
  const out=[];
  for(let i=0;i<vertices.length;i+=1){
    const a=vertices[i],b=vertices[(i+1)%vertices.length];
    if(!engineeringThermalSnapshotEdgeSpanV010_(a,b))return [];
    out.push({a:a,b:b,boundaryIndex:i});
  }
  return out;
}

function engineeringThermalSnapshotDerivedWallIdsV010_(zone,walls){
  const edges=engineeringThermalSnapshotZoneEdgesV010_(zone);
  if(!edges.length)return {supported:false,wallIds:[]};
  const ids=[];
  edges.forEach(function(edge){
    (walls||[]).forEach(function(wall){
      if(!engineeringThermalSnapshotActiveV010_(wall))return;
      if(engineeringThermalSnapshotOverlapV010_(edge,wall)>VBOS_ENGINEERING_THERMAL_SNAPSHOT_V010.toleranceMm){
        const id=String(wall.engineeringWallId||'');
        if(id&&ids.indexOf(id)===-1)ids.push(id);
      }
    });
  });
  return {supported:true,wallIds:ids};
}

function engineeringThermalSnapshotWallRoomCountsV010_(zones,walls,links){
  const counts={};
  const activeLinks=(links||[]).filter(engineeringThermalSnapshotActiveV010_);
  if(activeLinks.length){
    activeLinks.forEach(function(link){
      const id=String(link.engineeringWallId||'');
      if(id)counts[id]=(counts[id]||0)+1;
    });
    return counts;
  }
  (zones||[]).filter(engineeringThermalSnapshotActiveV010_).forEach(function(zone){
    const derived=engineeringThermalSnapshotDerivedWallIdsV010_(zone,walls);
    if(!derived.supported)return;
    derived.wallIds.forEach(function(id){counts[id]=(counts[id]||0)+1;});
  });
  return counts;
}

function engineeringThermalPassportFromSnapshotV010_(snapshot,roomId,thermalInputs){
  snapshot=snapshot||{};
  thermalInputs=thermalInputs||{};
  const rooms=(snapshot.rooms||[]).filter(engineeringThermalSnapshotActiveV010_);
  const floors=snapshot.floor?[snapshot.floor]:(snapshot.floors||[]).filter(engineeringThermalSnapshotActiveV010_);
  const zones=(snapshot.zones||[]).filter(engineeringThermalSnapshotActiveV010_);
  const walls=(snapshot.walls||[]).filter(engineeringThermalSnapshotActiveV010_);
  const openings=(snapshot.openings||[]).filter(engineeringThermalSnapshotActiveV010_);
  const links=(snapshot.roomWallLinks||[]).filter(engineeringThermalSnapshotActiveV010_);
  const room=rooms.find(function(x){return String(x.engineeringRoomId||'')===String(roomId||'');})||null;
  if(!room)return {status:'INCOMPLETE',missingInputs:['room'],passport:null};
  const floor=floors.find(function(x){return String(x.engineeringFloorId||'')===String(room.engineeringFloorId||'');})||null;
  if(!floor)return {status:'INCOMPLETE',missingInputs:['floor'],passport:null};

  const missingInputs=[],warnings=[],assumptions=['CANONICAL_FLOOR_SNAPSHOT'];
  const roomZones=zones.filter(function(x){return String(x.engineeringRoomId||'')===String(room.engineeringRoomId||'');});
  if(roomZones.length!==1){
    if(!roomZones.length)missingInputs.push('roomZone');
    else warnings.push('MULTIPLE_ACTIVE_ROOM_ZONES');
  }
  const zone=roomZones.length===1?roomZones[0]:null;
  const netFloorAreaM2=zone&&Number(zone.areaMm2)>0?Number(zone.areaMm2)/1000000:null;
  if(netFloorAreaM2===null)missingInputs.push('geometry.netFloorAreaM2');

  let ceilingHeightMm=Number(room.ceilingHeightMm);
  if(!Number.isFinite(ceilingHeightMm)||ceilingHeightMm<=0){
    ceilingHeightMm=Number(floor.defaultCeilingHeightMm);
    if(Number.isFinite(ceilingHeightMm)&&ceilingHeightMm>0)assumptions.push('CEILING_HEIGHT_FROM_FLOOR_DEFAULT');
  }
  if(!Number.isFinite(ceilingHeightMm)||ceilingHeightMm<=0)missingInputs.push('geometry.ceilingHeightM');
  const ceilingHeightM=Number.isFinite(ceilingHeightMm)&&ceilingHeightMm>0?ceilingHeightMm/1000:null;
  const volumeM3=netFloorAreaM2!==null&&ceilingHeightM!==null?netFloorAreaM2*ceilingHeightM:null;

  const indoorTempC=thermalInputs.indoorTempC,outdoorTempC=thermalInputs.outdoorTempC;
  if(indoorTempC===undefined||indoorTempC===null||String(indoorTempC).trim()==='')missingInputs.push('designConditions.indoorTempC');
  if(outdoorTempC===undefined||outdoorTempC===null||String(outdoorTempC).trim()==='')missingInputs.push('designConditions.outdoorTempC');

  let roomWallIds=[];
  if(links.length){
    links.filter(function(link){return String(link.engineeringRoomId||'')===String(room.engineeringRoomId||'');})
      .forEach(function(link){const id=String(link.engineeringWallId||'');if(id&&roomWallIds.indexOf(id)===-1)roomWallIds.push(id);});
  }else if(zone){
    const derived=engineeringThermalSnapshotDerivedWallIdsV010_(zone,walls);
    if(derived.supported){
      roomWallIds=derived.wallIds;
      assumptions.push('ROOM_WALL_ADJACENCY_DERIVED_FROM_ZONE');
    }else missingInputs.push('roomWallAdjacency');
  }
  if(!roomWallIds.length)missingInputs.push('roomWallLinks');

  const wallCounts=engineeringThermalSnapshotWallRoomCountsV010_(zones,walls,links);
  const wallProfiles=thermalInputs.wallProfiles||{},openingProfiles=thermalInputs.openingProfiles||{};
  const defaultExteriorWallProfile=thermalInputs.defaultExteriorWallProfile||null;
  const defaultWindowProfile=thermalInputs.defaultWindowProfile||null;
  const defaultExteriorDoorProfile=thermalInputs.defaultExteriorDoorProfile||null;
  const envelope={walls:[],windows:[],doors:[],floorBoundary:null,ceilingBoundary:null};

  roomWallIds.forEach(function(wallId){
    const wall=walls.find(function(x){return String(x.engineeringWallId||'')===wallId;})||null;
    if(!wall){missingInputs.push('wall:'+wallId);return;}
    const wallLengthM=engineeringThermalLengthMFromWallV010_(wall);
    if(wallLengthM===null||ceilingHeightM===null){missingInputs.push('wallGeometry:'+wallId);return;}
    const role=String(wall.wallRole||'').toUpperCase();
    const profile=engineeringThermalProfileV010_(wallProfiles,wallId,role==='EXTERIOR'?defaultExteriorWallProfile:null);
    if(role!=='EXTERIOR'&&!profile)return;

    let assignedOpeningAreaM2=0;
    openings.filter(function(op){return String(op.engineeringWallId||'')===wallId;}).forEach(function(opening){
      const ownerRoomId=String(opening.engineeringRoomId||'');
      let belongs=ownerRoomId===String(room.engineeringRoomId||'');
      if(!ownerRoomId&&Number(wallCounts[wallId]||0)===1)belongs=true;
      if(!ownerRoomId&&Number(wallCounts[wallId]||0)>1){
        missingInputs.push('openingRoomOwnership:'+String(opening.engineeringOpeningId||''));return;
      }
      if(!belongs)return;
      const openingId=String(opening.engineeringOpeningId||'');
      const areaM2=engineeringThermalOpeningAreaM2V010_(opening);
      if(areaM2===null){missingInputs.push('openingGeometry:'+openingId);return;}
      assignedOpeningAreaM2+=areaM2;
      const openingType=String(opening.openingType||'').toUpperCase();
      const fallback=openingType==='WINDOW'?defaultWindowProfile:defaultExteriorDoorProfile;
      const opProfile=engineeringThermalProfileV010_(openingProfiles,openingId,fallback);
      const list=openingType==='WINDOW'?envelope.windows:envelope.doors;
      list.push(engineeringThermalBoundarySurfaceV010_((openingType==='WINDOW'?'window:':'door:')+openingId,openingType==='WINDOW'?'WINDOW':'DOOR',openingId,areaM2,opProfile,outdoorTempC));
      if(!opProfile)missingInputs.push('openingThermalProfile:'+openingId);
    });

    const opaqueAreaM2=wallLengthM*ceilingHeightM-assignedOpeningAreaM2;
    if(opaqueAreaM2<-.000001){missingInputs.push('wallOpaqueArea:'+wallId);return;}
    envelope.walls.push(engineeringThermalBoundarySurfaceV010_('wall:'+wallId,'WALL',wallId,Math.max(0,opaqueAreaM2),profile,role==='EXTERIOR'?outdoorTempC:undefined));
    if(!profile)missingInputs.push('wallThermalProfile:'+wallId);
  });

  if(thermalInputs.floorBoundary)envelope.floorBoundary=engineeringThermalBoundarySurfaceV010_('floor:'+roomId,'FLOOR',roomId,netFloorAreaM2,thermalInputs.floorBoundary,undefined);
  else missingInputs.push('floorBoundary');
  if(thermalInputs.ceilingBoundary)envelope.ceilingBoundary=engineeringThermalBoundarySurfaceV010_('ceiling:'+roomId,'CEILING',roomId,netFloorAreaM2,thermalInputs.ceilingBoundary,undefined);
  else missingInputs.push('ceilingBoundary');
  if(thermalInputs.airChangesPerHour===undefined||thermalInputs.airChangesPerHour===null||String(thermalInputs.airChangesPerHour).trim()==='')missingInputs.push('airExchange.airChangesPerHour');
  if(thermalInputs.heatCapacityFactorWhM3K===undefined||thermalInputs.heatCapacityFactorWhM3K===null||String(thermalInputs.heatCapacityFactorWhM3K).trim()==='')missingInputs.push('airExchange.heatCapacityFactorWhM3K');

  const passport={
    passportVersion:'ENGINEERING_THERMAL_PASSPORT_SNAPSHOT_V1',
    projectId:String(room.engineeringProjectId||''),
    floorId:String(room.engineeringFloorId||''),
    roomId:String(room.engineeringRoomId||''),
    roomName:String(room.name||''),
    roomType:String(room.roomType||''),
    geometry:{netFloorAreaM2:netFloorAreaM2,perimeterM:zone&&Number(zone.perimeterMm)>0?Number(zone.perimeterMm)/1000:null,ceilingHeightM:ceilingHeightM,volumeM3:volumeM3},
    designConditions:{indoorTempC:indoorTempC,outdoorTempC:outdoorTempC},
    envelope:envelope,
    airExchange:{method:'AIR_CHANGES_PER_HOUR',airChangesPerHour:thermalInputs.airChangesPerHour,heatCapacityFactorWhM3K:thermalInputs.heatCapacityFactorWhM3K},
    reservePct:thermalInputs.reservePct,
    missingInputs:missingInputs.filter(function(v,i,a){return a.indexOf(v)===i;}),
    warnings:warnings,
    assumptions:assumptions,
    sourceRevision:[room.revision||'',floor.revision||'',zone&&zone.revision||''].join(':'),
    derivedOnly:true,
    canonicalWrites:0
  };
  return {status:passport.missingInputs.length?'INCOMPLETE':'COMPLETE',passport:passport,missingInputs:passport.missingInputs,warnings:warnings};
}

export {engineeringThermalPassportFromSnapshotV010_ as passportFromFloorSnapshot,engineeringThermalSnapshotDerivedWallIdsV010_ as deriveWallLinks};
