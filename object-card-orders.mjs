/* VBOS Clean / OBJECT_CARD_LEGACY_PARITY_BATCH1 + PAGING_V1
 * Read-only, exact-object WorkOrder history. Initial page remains 100 recent
 * orders; additional pages are scoped to the same immutable Object UUID.
 * No changes to Orders, lifecycle or financial authority.
 */
const PAGE_LIMIT=100;
// PostgreSQL timestamptz can retain microseconds that node-postgres Date drops.
// An exact DB-derived 6-digit UTC timestamp is required for lossless keyset pagination.
const EXACT_UTC_TIMESTAMP=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

function parseOrderPageCursor(raw,objectId,uuid,AppError){
 if(raw===null||raw===undefined||raw==='')return null;
 const bad=()=>new AppError(400,'Некорректная страница заказов объекта.');
 if(typeof raw!=='string'||raw.length>360||!/^[A-Za-z0-9_-]+$/.test(raw))throw bad();
 try{
  const decoded=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
  if(!Array.isArray(decoded)||decoded.length!==3||decoded[0]!==objectId||
     typeof decoded[1]!=='string'||typeof decoded[2]!=='string'||
     !EXACT_UTC_TIMESTAMP.test(decoded[1])||
     !Number.isFinite(Date.parse(decoded[1]))||
     new Date(decoded[1]).toISOString().slice(0,19)!==decoded[1].slice(0,19))throw bad();
  return [decoded[1],uuid(decoded[2])];
 }catch{throw bad();}
}

export async function objectCardOrdersRead({pool,objectId,cursor=null,uuid,AppError}){
 const id=uuid(objectId);
 // A foreign/malformed page cursor is rejected BEFORE any DB read.
 const older=parseOrderPageCursor(cursor,id,uuid,AppError);
 const parent=await pool.query(
  'SELECT o.id,o.client_id,o.name,c.name AS client_name FROM public.mvp_objects o JOIN public.mvp_clients c ON c.id=o.client_id WHERE o.id=$1 LIMIT 1',[id]);
 if(parent.rows.length!==1)throw new AppError(404,'Объект не найден.');
 const args=older?[id,...older]:[id];
 const result=await pool.query(
  'SELECT id,object_id,lead_id,title,status,planned_on,notes,revision,created_at,updated_at, '+
  `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at `+
  'FROM public.mvp_orders WHERE object_id=$1'+
   (older?' AND (created_at,id)<($2::timestamptz,$3::uuid)':'')+
  ' ORDER BY created_at DESC,id DESC LIMIT 101',args);
 const rows=result.rows||[];
 if(rows.some(row=>String(row.object_id)!==id))
  throw new AppError(503,'Связь заказов объекта не подтверждена.');
 const items=rows.slice(0,PAGE_LIMIT),hasMore=rows.length>PAGE_LIMIT;
 let nextCursor=null;
 if(hasMore){
  const last=items.at(-1);
  try{
   const stamp=last.cursor_created_at;
   if(typeof stamp!=='string'||!EXACT_UTC_TIMESTAMP.test(stamp))throw Error('bad database timestamp');
   const orderId=uuid(last.id);
   nextCursor=Buffer.from(JSON.stringify([id,stamp,orderId])).toString('base64url');
  }catch{
   throw new AppError(503,'Следующая страница заказов не подтверждена.');
  }
 }
 return {objectId:id,clientId:parent.rows[0].client_id,
  items:items.map(({cursor_created_at,...row})=>({...row,object_name:parent.rows[0].name,client_name:parent.rows[0].client_name})),
  hasMore,nextCursor,limit:PAGE_LIMIT};
}
