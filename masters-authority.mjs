// Shared MS1-MS3 authority. Missing schema/receipt is never permission to write.
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export async function mastersServicesAuthority(db,{lock=false}={}){
 let row;
 try{
  row=(await db.query('SELECT phase,master_snapshot_hash,dependency_receipt_hash FROM public.mvp_masters_services_authority WHERE id=1'+(lock?' FOR SHARE':''))).rows[0];
 }catch(err){
  if(!['42P01','42703'].includes(err?.code))throw err;
  if(lock)throw err; // transaction is aborted; caller rolls back
  return {phase:'UNAVAILABLE',writeEnabled:false};
 }
 if(!row||!['LEGACY','CLEAN'].includes(row.phase))return {phase:'UNAVAILABLE',writeEnabled:false};
 return {phase:row.phase,writeEnabled:row.phase==='CLEAN'&&hash(row.master_snapshot_hash)&&hash(row.dependency_receipt_hash)};
}
export async function requireMastersServicesAuthority(db,AppError){
 let state;
 try{state=await mastersServicesAuthority(db,{lock:true});}
 catch(err){if(!['42P01','42703'].includes(err?.code))throw err;throw new AppError(503,'Управление правом записи мастеров и услуг ещё не установлено.');}
 if(!state.writeEnabled)throw new AppError(409,'Запись мастеров и услуг заблокирована до совместного перехода.');
 return state;
}
