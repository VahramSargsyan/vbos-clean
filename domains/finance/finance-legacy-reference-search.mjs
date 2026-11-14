/**
 * Finance legacy-form parity B3 — native TEST worker directory, read only.
 * Never asserts a link to imported Google Finance worker IDs or writes money.
 */
export class FinanceLegacyReferenceError extends Error {
 constructor(status,code){super(code);this.status=status;this.code=code;}
}
const fail=(status,code)=>{throw new FinanceLegacyReferenceError(status,code);};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAMP=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
export async function financeLegacyWorkersPage(db,url,{authorizeOwner}={}){
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)
  fail(401,'OWNER_SESSION_REQUIRED');
 if(!db||typeof db.query!=='function')fail(503,'WORKER_SOURCE_UNAVAILABLE');
 const u=url instanceof URL?url:new URL(String(url),'http://localhost');
 const q=String(u.searchParams.get('q')||'').trim();
 const limit=Number(u.searchParams.get('limit')||25);
 if(q.length>80||q.length===1||/[\x00-\x1f]/.test(q))fail(400,'SEARCH_TERM_INVALID');
 if(!Number.isInteger(limit)||limit<1||limit>50)fail(400,'SEARCH_LIMIT_INVALID');
 const raw=u.searchParams.get('cursor');
 let cursor=null;
 if(raw){
  if(raw.length>600||!/^[A-Za-z0-9_-]+$/.test(raw))fail(400,'SEARCH_CURSOR_INVALID');
  try{
   const v=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
   if(!Array.isArray(v)||v.length!==3||v[0]!==q||typeof v[1]!=='string'||
     !STAMP.test(v[1])||!UUID.test(v[2]))throw Error('bad');
   cursor=[v[1],v[2]];
  }catch{fail(400,'SEARCH_CURSOR_INVALID');}
 }
 const values=[],where=[];
 if(q){values.push(q);where.push('strpos(lower(name),lower($1))>0');}
 if(cursor){
  values.push(...cursor);
  const start=values.length-1;
  where.push('(created_at,id)<($'+start+'::timestamptz,$'+(start+1)+'::uuid)');
 }
 values.push(limit+1);
 const sql='SELECT id,name,status,'+
  'to_char(created_at AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS cursor_at '+
  'FROM public.mvp_workers'+(where.length?' WHERE '+where.join(' AND '):'')+
  ' ORDER BY created_at DESC,id DESC LIMIT $'+values.length;
 const result=await db.query(sql,values);
 const fetched=Array.isArray(result?.rows)?result.rows:[];
 const items=fetched.slice(0,limit).map(row=>({
  id:String(row.id),name:String(row.name||''),status:String(row.status||'')
 }));
 if(items.some(x=>!UUID.test(x.id)||!x.name||x.name.length>160))
  fail(503,'WORKER_SOURCE_INVALID');
 const more=fetched.length>limit,last=fetched[limit-1];
 if(more&&(!last||!STAMP.test(String(last.cursor_at||''))))fail(503,'WORKER_CURSOR_INVALID');
 const nextCursor=more?Buffer.from(JSON.stringify([q,last.cursor_at,last.id])).toString('base64url'):null;
 return {source:'CLEAN_TEST_NATIVE_WORKER_DIRECTORY',readonly:true,financeMappingVerified:false,
  q,items,hasMore:more,nextCursor};
}
