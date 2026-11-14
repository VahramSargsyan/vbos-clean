/* VBOS Clean CRM-24: owner-only canonical search filters, without schema writes.
 * Existing V3 catalog queries and four-field cursors remain backward compatible.
 * Filters are applied inside PostgreSQL before bounded keyset pagination.
 */
const choices=Object.freeze({
 clients:Object.freeze({
  status:['active','inactive','archived'],
  tier:['unset','regular','good','vip'],
  referral:['unset','none','one','active']
 }),
 leads:Object.freeze({status:['new','contacted','qualified','won','lost','transferred']})
});
export async function catalogSearch(url,{pool,AppError,uuid}){
 const entity=String(url.searchParams.get('entity')||'clients');
 const cfg={
  leads:{from:'public.mvp_leads t',select:'t.*',fields:'t.title,t.contact_name,t.phone,t.notes'},
  clients:{from:'public.mvp_clients t',select:'t.*',fields:'t.name,t.phone,t.notes'},
  objects:{from:'public.mvp_objects t LEFT JOIN public.mvp_clients c ON c.id=t.client_id',select:'t.*,t.xmin::text AS row_version,c.name AS client_name',fields:'t.name,t.address,t.notes,c.name'},
  orders:{from:'public.mvp_orders t LEFT JOIN public.mvp_objects o ON o.id=t.object_id',select:'t.*,o.name AS object_name',fields:'t.title,t.notes,o.name'}
 };
 if(!Object.hasOwn(cfg,entity))throw new AppError(400,'Неизвестный раздел поиска.');
 const limit=Number(url.searchParams.get('limit')||25);
 if(!Number.isInteger(limit)||limit<1||limit>50)throw new AppError(400,'Размер страницы: 1–50.');
 const term=String(url.searchParams.get('q')||'').trim();
 if(term.length>80||/[\x00-\x1f]/.test(term)||term.length===1)
  throw new AppError(400,'Поиск: 2–80 символов. Пустое поле показывает последние записи.');
 const status=String(url.searchParams.get('status')||'');
 const tier=String(url.searchParams.get('tier')||'');
 const referral=String(url.searchParams.get('referral')||'');
 const allowed=choices[entity];
 if([['status',status],['tier',tier],['referral',referral]].some(([key,value])=>
    value&&(!allowed?.[key]||!allowed[key].includes(value))))
  throw new AppError(400,'Фильтр не поддерживается для выбранного раздела.');
 const exact=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(term)?uuid(term):null;
 // Old unfiltered bookmarks keep their 4-part cursor; filtered queries use
 // a 5-part cursor bound to every filter to reject cross-filter reuse.
 const filterKey=JSON.stringify([status,tier,referral]),unfiltered=!status&&!tier&&!referral;
 let cursor=null;const raw=url.searchParams.get('cursor');
 if(raw){
  if(raw.length>600||!/^[A-Za-z0-9_-]+$/.test(raw))throw new AppError(400,'Неверная страница поиска.');
  try{
   const x=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
   const legacy=x.length===4,offset=legacy?2:3;
   if(!Array.isArray(x)||!(legacy&&unfiltered||x.length===5&&x[2]===filterKey)||
      x[0]!==entity||x[1]!==term||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(x[offset]))
    throw Error('bad');
   cursor=[x[offset],uuid(x[offset+1])];
  }catch{throw new AppError(400,'Неверная страница поиска.');}
 }
 const c=cfg[entity],args=[],where=[];
 if(exact){args.push(exact);where.push('t.id=$1::uuid');}
 else if(term){args.push(term);where.push("strpos(lower(concat_ws(' ',"+c.fields+")),lower($1))>0");}
 for(const [column,value] of [['status',status],['client_tier',tier],['referral_status',referral]]){
  if(!value)continue;
  args.push(value==='unset'?'':value);
  where.push('t.'+column+'=$'+args.length);
 }
 if(cursor){args.push(...cursor);const n=args.length-1;where.push('(t.created_at,t.id)<($'+n+'::timestamptz,$'+(n+1)+'::uuid)');}
 args.push(limit+1);
 const sql='SELECT '+c.select+
  ',to_char(t.created_at AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS cursor_at'+
  ' FROM '+c.from+(where.length?' WHERE '+where.join(' AND '):'')+
  ' ORDER BY t.created_at DESC,t.id DESC LIMIT $'+args.length;
 const result=await pool.query(sql,args),items=result.rows.slice(0,limit),hasMore=result.rows.length>limit,last=items.at(-1);
 const nextCursor=hasMore&&last?Buffer.from(JSON.stringify(unfiltered?
  [entity,term,last.cursor_at,last.id]:[entity,term,filterKey,last.cursor_at,last.id])).toString('base64url'):null;
 for(const item of items)delete item.cursor_at;
 return {entity,q:term,status,tier,referral,items,hasMore,nextCursor,limit};
}
