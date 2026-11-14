/**
 * CRM-21A — prevent accidental duplicate Clients on direct create/update.
 * Source: CrmService.js saveClientService_ / normalizePhoneForMatch_.
 * Same existing Postgres canonical-phone function and advisory-lock namespace
 * as leadConversionAction: no new schema or historical re-keying.
 *
 * A candidate match is informational only; never merge/rebind objects/orders
 * or return a different Client silently as though the user's create succeeded.
 */
const createFields=({p,requireText,optText,allow})=>({
 name:requireText(p.name,160),
 phone:optText(p.phone,60),
 notes:optText(p.notes,5000),
 email:optText(p.email,200),
 address:optText(p.address,500),
 status:allow(p.status||'active',['active','inactive','archived']),
 clientTier:allow(p.clientTier||'',['','regular','good','vip']),
 referralStatus:allow(p.referralStatus||'',['','none','one','active']),
 clientLabelNote:optText(p.clientLabelNote,5000)
});
const updateFields=({p,requireText,optText,allow})=>({
 name:requireText(p.name,160),
 phone:optText(p.phone,60),
 notes:optText(p.notes,5000),
 email:p.email===undefined?null:optText(p.email,200),
 address:p.address===undefined?null:optText(p.address,500),
 status:p.status===undefined?null:allow(p.status,['active','inactive','archived']),
 clientTier:p.clientTier===undefined?null:allow(p.clientTier,['','regular','good','vip']),
 referralStatus:p.referralStatus===undefined?null:allow(p.referralStatus,['','none','one','active']),
 clientLabelNote:p.clientLabelNote===undefined?null:optText(p.clientLabelNote,5000)
});
const safeName=x=>String(x||'').trim().slice(0,160);
function duplicateError(matches,AppError){
 if(matches.length===1){
  const c=matches[0];
  return new AppError(409,'Клиент с таким телефоном уже существует: '+
    safeName(c.name)+'. Открой существующую карточку вместо создания дубликата.');
 }
 return new AppError(409,'Найдено '+matches.length+
   ' клиентов с таким телефоном. Новый клиент не создан; проверь существующие карточки.');
}
/**
 * Invoke only from the authenticated /api/action path.
 * Existing request_key create idempotency and optimistic update revision remain.
 * Advisory lock is taken BEFORE candidate scan and mutation in one transaction.
 */
export async function guardedClientAction({
 pool,type,p,key,uuid,safeRevision,requireText,optText,allow,AppError
}){
 if(type!=='client_create'&&type!=='client_update')
  throw new AppError(404,'Неизвестная операция клиента.');
 const creating=type==='client_create';
 const input=creating?createFields({p,requireText,optText,allow}):
  updateFields({p,requireText,optText,allow});
 const id=creating?null:uuid(p.id);
 const revision=creating?null:safeRevision(p.revision);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const phone=(await client.query(
   'SELECT public.mvp_crm_phone_canonical($1::text) AS normalized',[input.phone]
  )).rows[0]?.normalized||'';
  // Same namespace used by lead conversion: serialized normalized-phone writes.
  if(phone)await client.query('SELECT pg_advisory_xact_lock(151106,hashtext($1::text))',[phone]);
  if(creating){
   // Repeat an already completed same-key request without losing submitted work.
   const previous=await client.query(
    'SELECT * FROM public.mvp_clients WHERE request_key=$1 FOR UPDATE',[key]);
   if(previous.rows.length){
    await client.query('COMMIT');
    return {saved:true,item:previous.rows[0],deduplicatedRequest:true};
   }
  }
  let old=null;
  if(!creating){
   const row=await client.query(
    'SELECT id,revision,status FROM public.mvp_clients WHERE id=$1 FOR UPDATE',[id]);
   old=row.rows[0]||null;
   if(!old)throw new AppError(404,'Клиент не найден. Обнови список.');
   if(old.revision!==revision)throw new AppError(409,'Карточка клиента изменена. Обнови экран.');
  }
  // Do not prevent archival of an existing Client: it cannot create an active
  // duplicate. Re-activating an archived Client must pass the same check.
  const resultingStatus=input.status??old?.status??'active';
  if(phone&&resultingStatus!=='archived'){
   const matches=(await client.query(
    "SELECT id,name,phone FROM public.mvp_clients WHERE status<>'archived' "+
    "AND phone<>'' AND public.mvp_crm_phone_canonical(phone)=$1 "+
    (creating?'':'AND id<>$2 ')+
    'ORDER BY id FOR SHARE',
    creating?[phone]:[phone,id]
   )).rows;
   if(matches.length)throw duplicateError(matches,AppError);
  }
  let result;
  if(creating){
   result=await client.query(
    'INSERT INTO public.mvp_clients(request_key,name,phone,notes,email,address,status,client_tier,referral_status,client_label_note) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) '+
    'ON CONFLICT(request_key) DO UPDATE SET request_key=EXCLUDED.request_key RETURNING *',
    [key,input.name,input.phone,input.notes,input.email,input.address,
     input.status,input.clientTier,input.referralStatus,input.clientLabelNote]);
  }else{
   result=await client.query(
    'UPDATE public.mvp_clients SET name=$3,phone=$4,notes=$5,'+
    'email=COALESCE($6,email),address=COALESCE($7,address),status=COALESCE($8,status),'+
    'client_tier=COALESCE($9,client_tier),referral_status=COALESCE($10,referral_status),'+
    'client_label_note=COALESCE($11,client_label_note),revision=revision+1,updated_at=now() '+
    'WHERE id=$1 AND revision=$2 RETURNING *',
    [id,revision,input.name,input.phone,input.notes,input.email,input.address,
     input.status,input.clientTier,input.referralStatus,input.clientLabelNote]);
  }
  if(result.rows.length!==1)
   throw new AppError(409,'Карточка клиента изменилась. Обнови экран.');
  await client.query('COMMIT');
  return {saved:true,item:result.rows[0]};
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{client.release();}
}
