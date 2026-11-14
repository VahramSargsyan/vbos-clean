/**
 * CRM26A owner-authenticated read-only legacy transfer archive.
 * Never joins source Lead/Master IDs to Clean UUIDs or modifies Lead status.
 */
export async function legacyLeadTransfersPage({pool,url,AppError}){
 const params=url.searchParams,q=String(params.get('q')||'').trim();
 if(q.length>80||q.length===1||/[\x00-\x1f]/.test(q))
  throw new AppError(400,'Поиск старой передачи: 2–80 символов или пусто.');
 const limit=Number(params.get('limit')||25);
 if(!Number.isInteger(limit)||limit<1||limit>50)
  throw new AppError(400,'Размер страницы: 1–50.');
 let cursor=null;
 const raw=params.get('cursor');
 if(raw){
  if(raw.length>500||!/^[A-Za-z0-9_-]+$/.test(raw))
   throw new AppError(400,'Неверная страница истории передач.');
  try{
   const x=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
   if(!Array.isArray(x)||x.length!==3||x[0]!==q||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(x[1])||
      typeof x[2]!=='string'||x[2].length>100||!x[2])
    throw Error('cursor');
   cursor=[x[1],x[2]];
  }catch{throw new AppError(400,'Неверная страница истории передач.');}
 }
 const where=[],args=[];
 if(q){
  args.push(q);
  where.push("strpos(lower(concat_ws(' ',source_transfer_id,source_lead_id,"+
   "source_master_id,recipient_name)),lower($1))>0");
 }
 if(cursor){
  args.push(...cursor);const n=args.length-1;
  where.push('(transferred_at,source_transfer_id)<($'+n+'::timestamptz,$'+(n+1)+'::text)');
 }
 args.push(limit+1);
 const sql='SELECT source_transfer_id,source_lead_id,source_master_id,recipient_name,'+
  'reason,comment,source_status,transferred_at_source,created_at_source,'+
  'batch_id,to_char(transferred_at AT TIME ZONE '+
  "'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'"+') AS cursor_at '+
  'FROM mvp_history.crm_legacy_lead_transfers'+
  (where.length?' WHERE '+where.join(' AND '):'')+
  ' ORDER BY transferred_at DESC,source_transfer_id DESC LIMIT $'+args.length;
 const result=await pool.query(sql,args),items=result.rows.slice(0,limit);
 const hasMore=result.rows.length>limit,last=items.at(-1);
 const nextCursor=hasMore&&last?Buffer.from(JSON.stringify([q,last.cursor_at,last.source_transfer_id])).toString('base64url'):null;
 for(const item of items)delete item.cursor_at;
 return {source:'LEGACY_GOOGLE_IMMUTABLE_ARCHIVE',items,nextCursor,hasMore,limit,q,
  linkedToClean:false};
}
