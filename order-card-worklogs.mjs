/* VBOS Clean legacy WorkOrder card WorkLog history.
 * Read-only canonical WorkLogs, exact WorkOrder scope, keyset 10/page.
 * No imported Google WorkLog rows are inferred or backfilled.
 */
export async function orderCardWorklogsRead({pool,url,uuid,AppError}){
 const orderId=uuid(url.searchParams.get('id'));
 const raw=url.searchParams.get('cursor');
 let cursor=null;
 if(raw){
  if(raw.length>360||!/^[A-Za-z0-9_-]+$/.test(raw))throw new AppError(400,'Некорректная страница истории заказа.');
  try{
   const decoded=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
   if(!Array.isArray(decoded)||decoded.length!==4||decoded[0]!==orderId||
      typeof decoded[1]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(decoded[1])||
      typeof decoded[2]!=='string'||!Number.isFinite(Date.parse(decoded[2]))||
      new Date(decoded[2]).toISOString()!==decoded[2])
    throw Error('bad cursor');
   cursor=[decoded[1],decoded[2],uuid(decoded[3])];
  }catch{throw new AppError(400,'Некорректная страница истории заказа.');}
 }
 const parent=await pool.query(
  'SELECT o.id,o.object_id,b.client_id,b.name AS object_name,c.name AS client_name '+
  'FROM public.mvp_orders o JOIN public.mvp_objects b ON b.id=o.object_id '+
  'JOIN public.mvp_clients c ON c.id=b.client_id WHERE o.id=$1 LIMIT 1',[orderId]);
 if(parent.rows.length!==1)throw new AppError(404,'Заказ не найден.');
 const args=[orderId],older=cursor?
  ' AND (l.day_date,l.created_at,l.id)<($2::date,$3::timestamptz,$4::uuid)':'';
 if(cursor)args.push(...cursor);
 args.push(11);
 const out=await pool.query(
  'SELECT l.*,l.day_date::text AS day_date,to_jsonb(d) AS detail FROM public.mvp_work_logs l '+
  'LEFT JOIN public.mvp_work_log_details d ON d.work_log_id=l.id '+
  'WHERE l.order_id=$1'+older+
  ' ORDER BY l.day_date DESC,l.created_at DESC,l.id DESC LIMIT $'+args.length,args);
 const items=out.rows.slice(0,10),hasMore=out.rows.length>10,last=items.at(-1);
 if(items.some(item=>String(item.order_id)!==orderId))
  throw new AppError(503,'Связь выполненной работы с заказом не подтверждена.');
 const row=parent.rows[0];
 return {orderId,objectId:row.object_id,clientId:row.client_id,
  objectName:row.object_name,clientName:row.client_name,items,hasMore,limit:10,
  coverage:'CLEAN_NATIVE_WORKLOGS_ONLY',
  nextCursor:hasMore&&last?Buffer.from(JSON.stringify([
   orderId,String(last.day_date).slice(0,10),new Date(last.created_at).toISOString(),last.id
  ])).toString('base64url'):null};
}
