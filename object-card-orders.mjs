/* VBOS Clean / OBJECT_CARD_LEGACY_PARITY_BATCH1
 * Read-only, exact-object counterpart of legacy getObjectService_ workOrders
 * (last 100). No changes to orders, lifecycle or financial authority.
 */
export async function objectCardOrdersRead({pool,objectId,uuid,AppError}){
 const id=uuid(objectId);
 const parent=await pool.query(
  'SELECT o.id,o.client_id,o.name,c.name AS client_name FROM public.mvp_objects o JOIN public.mvp_clients c ON c.id=o.client_id WHERE o.id=$1 LIMIT 1',[id]);
 if(parent.rows.length!==1)throw new AppError(404,'Объект не найден.');
 const result=await pool.query(
  'SELECT id,object_id,lead_id,title,status,planned_on,notes,revision,created_at,updated_at '+
  'FROM public.mvp_orders WHERE object_id=$1 ORDER BY created_at DESC,id DESC LIMIT 101',[id]);
 const rows=result.rows||[];
 if(rows.some(row=>String(row.object_id)!==id))
  throw new AppError(503,'Связь заказов объекта не подтверждена.');
 return {objectId:id,clientId:parent.rows[0].client_id,
  items:rows.slice(0,100).map(row=>({...row,object_name:parent.rows[0].name,client_name:parent.rows[0].client_name})),
  hasMore:rows.length>100,limit:100};
}
