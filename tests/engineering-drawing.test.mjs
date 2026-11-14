import assert from 'node:assert/strict';
import {test} from 'node:test';
import {newDrawing,validateDrawing,drawRect,drawingGeometry,calculateFromDrawing,exportDrawing,importDrawing} from '../public/engineering-drawing-geometry.mjs';
import {commitDraftForm,addOpening,pointFromTap,renderDrawing} from '../public/engineering-drawing-ui.mjs';
const SID='CLEAN-DRAFT-TEST-00000001';
function fixture(){
 let d=newDrawing(SID,'Спальня');
 d=drawRect(d,{xMm:1000,yMm:1500},{xMm:6000,yMm:5500});
 d=commitDraftForm(d,{
  projectName:'Реальная квартира',roomName:'Спальня',wallThicknessMm:'100',
  wallRole0:'EXTERIOR',wallRole1:'EXTERIOR',wallRole2:'EXTERIOR',wallRole3:'EXTERIOR',
  heightMm:'2500',indoorTempC:'20',outdoorTempC:'-10',wallU:'0.4',
  windowU:'1.6',airChangesPerHour:'0.5',heatCapacityFactorWhM3K:'0.34',reservePct:'10',
  floorBoundaryType:'HEATED',ceilingBoundaryType:'HEATED'
 });
 return addOpening(d,{edgeIndex:'0',openingType:'WINDOW',widthMm:'2000',heightMm:'1000',offsetFromWallStartMm:'500'});
}
test('actual geometry and VBOS net room metrics from two drawn corners',()=>{
 const d=fixture(),geo=drawingGeometry(d);
 assert.equal(geo.walls.length,4);
 assert.equal(geo.openingRows.length,1);
 assert.equal(geo.metrics.centerlineAreaMm2,20_000_000);
 assert.equal(geo.metrics.areaMm2,19_110_000);
 assert.equal(geo.metrics.perimeterMm,17_600);
 assert.equal(geo.openingRows[0].engineeringWallId,geo.walls[0].engineeringWallId);
});
test('pinned Thermal Snapshot Adapter automatically derives opening/opaque walls and heat',()=>{
 const r=calculateFromDrawing(fixture());
 assert.equal(r.status,'COMPLETE',JSON.stringify(r.missingInputs||[]));
 assert.equal(r.passport.geometry.netFloorAreaM2,19.11);
 assert.equal(r.passport.geometry.volumeM3,47.775);
 assert.equal(r.passport.envelope.walls.length,4);
 assert.equal(r.passport.envelope.windows.length,1);
 assert.equal(r.passport.envelope.windows[0].areaM2,2);
 assert.equal(r.heatLoss.transmission.wallsW,516);
 assert.equal(r.heatLoss.transmission.windowsW,96);
 assert.ok(Math.abs(r.heatLoss.requiredHeatW-941.21775)<0.001);
 assert.equal(r.heatLoss.canonicalWrites,0);
 assert.equal(r.canonicalWrites,0);
});
test('missing thermal and UNKNOWN walls block calculations, no guessed climate',()=>{
 const d=newDrawing('CLEAN-DRAFT-TEST-00000002','Кухня');
 const r=calculateFromDrawing(d);assert.equal(r.status,'INCOMPLETE');
 const a=drawRect(d,{xMm:0,yMm:0},{xMm:5000,yMm:4000});
 a.wallThicknessMm=100;
 assert.equal(calculateFromDrawing(a).status,'INCOMPLETE');
 assert.ok(calculateFromDrawing(a).missingInputs.includes('wallRoles'));
});
test('exterior opening cannot exceed wall or silently attach to interior',()=>{
 const a=fixture();
 assert.throws(()=>addOpening(a,{edgeIndex:'1',openingType:'WINDOW',widthMm:'5000',heightMm:'1200',offsetFromWallStartMm:'500'}),/OPENING_EXCEEDS_WALL/);
 const b=fixture();b.wallRoles[1]='HEATED_ADJACENT';
 assert.throws(()=>addOpening(b,{edgeIndex:'1',openingType:'DOOR',widthMm:'900',heightMm:'2100',offsetFromWallStartMm:'100'}),/OPENING_REQUIRES_EXTERIOR_WALL/);
});
test('local JSON roundtrip, origin and IDs are never interpreted as legacy Engineering ID',()=>{
 const a=fixture(),json=exportDrawing(a),again=importDrawing(json);
 assert.deepEqual(again,a);
 assert.equal(again.source,'CLEAN_PWA_DRAFT_NOT_LEGACY');
 assert.throws(()=>importDrawing(JSON.stringify({...a,source:'VBOS_LEGACY_ENGINEERING'})),/DRAWING_FORMAT_OR_SOURCE_REJECTED/);
 assert.throws(()=>importDrawing(JSON.stringify({...a,floorId:'EFL-2026-0001'})),/DRAWING_ID_CONFLICT/);
});
test('drawing geometry fail closed on self-degenerate/invalid and overspecified input',()=>{
 const d=newDrawing('CLEAN-DRAFT-TEST-00000003');
 assert.throws(()=>drawRect(d,{xMm:0,yMm:0},{xMm:0,yMm:1000}),/RECT_TOO_SMALL/);
 assert.throws(()=>drawRect(d,{xMm:0,yMm:0},{xMm:100000,yMm:1000}),/INVALID_x/);
 const bad=fixture();bad.openings.push({...bad.openings[0]});assert.throws(()=>validateDrawing(bad),/ONE_OPENING_PER_EDGE/);
});
test('touch-to-mm conversion uses snap and viewport coordinates, no server access',()=>{
 assert.deepEqual(pointFromTap(110,220,{left:10,top:20,width:400,height:400}),{xMm:3000,yMm:6000});
 assert.throws(()=>pointFromTap(0,0,{left:0,top:0,width:0,height:100}),/CANVAS_SIZE_INVALID/);
});
test('UI escapes user-provided names and is an actual drawing canvas, not sample geometry',()=>{
 const d=fixture();d.roomName='<img src=x onerror=alert(1)>';
 const html=renderDrawing(d,calculateFromDrawing(d));
 assert.match(html,/data-ed-canvas/);
 assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
 assert.doesNotMatch(html,/<img src=x/);
 assert.match(html,/941,22|941.22/);
 assert.doesNotMatch(html,/fetch\(|\/api\/action|data-act=/);
});
test('floor boundary must be explicitly classified and ground needs validated W',()=>{
 const a=fixture();a.thermal.floorBoundaryType='';assert.equal(calculateFromDrawing(a).status,'INCOMPLETE');
 const b=fixture();b.thermal.floorBoundaryType='GROUND';assert.equal(calculateFromDrawing(b).status,'INCOMPLETE');
 b.thermal.validatedGroundHeatLossW='100';
 assert.equal(calculateFromDrawing(b).status,'COMPLETE');
});

test('redrawing real room clears stale openings and wall roles without corrupting draft ID',()=>{
 const before=fixture();
 const updated=drawRect(before,{xMm:2000,yMm:2000},{xMm:4500,yMm:5000});
 assert.equal(updated.roomId,before.roomId);
 assert.equal(updated.openings.length,0);
 assert.deepEqual(updated.wallRoles,['UNKNOWN','UNKNOWN','UNKNOWN','UNKNOWN']);
 assert.equal(calculateFromDrawing(updated).status,'INCOMPLETE');
});
