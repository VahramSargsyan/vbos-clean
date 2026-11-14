/* VBOS Clean client portfolio: exact owner-only PostgreSQL totals + bounded
 * client-scoped keyset pages. No schema writes, no legacy Google inferred links.
 */
const statuses=new Set(['all','open','active','done','cancelled']);
const dateCursor=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
function bad(AppError,message){throw new AppError(400,message);}
export async function clientPortfolioRead({pool,url,uuid,AppError}){
 const id=uuid(url.searchParams.get('id'));
 const kind=String(url.searchParams.get('kind')||'objects');
 if(!['objects','orders'].includes(kind))bad(AppError,'Неизвестный раздел портфеля клиента.');
 const term=String(url.searchParams.get('q')||'').trim();
 if(term.length>80||/[\x00-\x1f]/.test(term))bad(AppError,'Поиск: не более 80 символов.');
 const status=String(url.searchParams.get('status')||'all');
 if(!statuses.has(status)||(kind==='objects'&&status!=='all'))
  bad(AppError,'Неизвестный фильтр заказов.');
 const limit=Number(url.searchParams.get('limit')||12);
 if(!Number.isInteger(limit)||limit<1||limit>50)bad(AppError,'Размер страницы должен быть от 1 до 50.');
 let cursor=null;
 const raw=url.searchParams.get('cursor');
 if(raw){
  if(raw.length>800||!/^[A-Za-z0-9_-]+$/.test(raw))bad(AppError,'Некорректная страница клиента.');
  try{
   const parts=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
   if(!Array.isArray(parts)||parts.length!==6||
      parts[0]!==id||parts[1]!==kind||parts[2]!==term||parts[3]!==status||
      !dateCursor.test(parts[4]))throw Error('cursor scope');
   cursor=[parts[4],uuid(parts[5])];
  }catch{bad(AppError,'Некорректная страница клиента.');}
 }
 const parent=await pool.query('SELECT id,name FROM public.mvp_clients WHERE id=$1 LIMIT 1',[id]);
 if(parent.rows.length!==1)throw new AppError(404,'Клиент не найден.');
 const totals=await pool.query(
  "SELECT (SELECT count(*)::int FROM public.mvp_objects WHERE client_id=$1) AS objects,"+
  " (SELECT count(*)::int FROM public.mvp_orders w JOIN public.mvp_objects o ON o.id=w.object_id WHERE o.client_id=$1) AS orders,"+
  " (SELECT count(*)::int FROM public.mvp_orders w JOIN public.mvp_objects o ON o.id=w.object_id WHERE o.client_id=$1 AND w.status IN ('open','active')) AS active_orders",[id]);
 const counts={objects:Number(totals.rows[0].objects),orders:Number(totals.rows[0].orders),
  activeOrders:Number(totals.rows[0].active_orders)};
 const args=[id],where=[kind==='objects'?'t.client_id=$1':'o.client_id=$1'];
 if(term){
  args.push(term);const fields=kind==='objects'?"concat_ws(' ',t.name,t.address)":"concat_ws(' ',t.title,o.name,o.address)";
  where.push('strpos(lower('+fields+'),lower($'+args.length+'))>0');
 }
 if(kind==='orders'&&status!=='all'){
  args.push(status);where.push('t.status=$'+args.length);
 }
 if(cursor){
  args.push(cursor[0],cursor[1]);
  where.push('(t.created_at,t.id)<($'+(args.length-1)+'::timestamptz,$'+args.length+'::uuid)');
 }
 args.push(limit+1);
 const base=kind==='objects'?
  'SELECT t.id,t.client_id,t.name,t.address,t.object_type,t.created_at':
  'SELECT t.id,t.object_id,t.lead_id,t.title,t.status,t.planned_on,t.created_at,o.name AS object_name,o.client_id';
 const from=kind==='objects'?'public.mvp_objects t':
  'public.mvp_orders t JOIN public.mvp_objects o ON o.id=t.object_id';
 const sql=base+
  ',to_char(t.created_at AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS cursor_at'+
  ' FROM '+from+' WHERE '+where.join(' AND ')+
  ' ORDER BY t.created_at DESC,t.id DESC LIMIT $'+args.length;
 const rows=(await pool.query(sql,args)).rows,items=rows.slice(0,limit);
 const hasMore=rows.length>limit,last=items.at(-1);
 const nextCursor=hasMore&&last?Buffer.from(JSON.stringify([
  id,kind,term,status,last.cursor_at,last.id])).toString('base64url'):null;
 for(const item of items)delete item.cursor_at;
 if(items.some(item=>item.client_id!==id))throw new AppError(503,'Не подтверждена связь записей клиента.');
 return {clientId:id,clientName:parent.rows[0].name,kind,q:term,status,
  counts,items,hasMore,nextCursor,limit};
}
