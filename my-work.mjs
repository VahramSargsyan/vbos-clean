/*
 * VBOS Clean MVP — My Work V5 read projection
 * SOURCE: isolated PostgreSQL mvp_* tables; read-only, no A1/presence/owner-activity inference.
 */
export async function myWorkSnapshot(pool,today,requestedOrderId=null){
 const [day,current,sessions,totals,logs,recent,orders]=await Promise.all([
  pool.query('SELECT id,day_date::text AS day_date,status,opened_at,closed_at FROM public.mvp_work_days WHERE day_date=$1::date LIMIT 1',[today]),
  pool.query("SELECT s.id,s.order_id,s.description,s.started_at,s.ended_at,d.day_date::text AS day_date,o.title AS order_title,o.status AS order_status,ob.id AS object_id,ob.name AS object_name,ob.address AS object_address,c.name AS client_name FROM public.mvp_sessions s JOIN public.mvp_work_days d ON d.id=s.day_id LEFT JOIN public.mvp_orders o ON o.id=s.order_id LEFT JOIN public.mvp_objects ob ON ob.id=o.object_id LEFT JOIN public.mvp_clients c ON c.id=ob.client_id WHERE s.ended_at IS NULL LIMIT 1"),
  pool.query('SELECT s.id,s.order_id,s.description,s.started_at,s.ended_at,o.title AS order_title FROM public.mvp_sessions s JOIN public.mvp_work_days d ON d.id=s.day_id LEFT JOIN public.mvp_orders o ON o.id=s.order_id WHERE d.day_date=$1::date ORDER BY s.started_at DESC,s.id DESC LIMIT 21',[today]),
  pool.query('SELECT count(*)::int AS count,coalesce(sum(minutes),0)::bigint AS minutes FROM public.mvp_work_logs WHERE day_date=$1::date',[today]),
  pool.query('SELECT l.id,l.order_id,l.day_date::text AS day_date,l.title,l.minutes,l.quantity::text AS quantity,l.unit,l.notes,l.created_at,o.title AS order_title FROM public.mvp_work_logs l LEFT JOIN public.mvp_orders o ON o.id=l.order_id WHERE l.day_date=$1::date ORDER BY l.created_at DESC,l.id DESC LIMIT 11',[today]),
  pool.query('SELECT d.day_date::text AS day_date,d.status,agg.log_count,agg.work_minutes FROM (SELECT day_date,status FROM public.mvp_work_days WHERE day_date<=$1::date ORDER BY day_date DESC LIMIT 7) d LEFT JOIN LATERAL (SELECT count(*)::int AS log_count,coalesce(sum(minutes),0)::bigint AS work_minutes FROM public.mvp_work_logs l WHERE l.day_date=d.day_date) agg ON true ORDER BY d.day_date DESC',[today]),
  pool.query("SELECT o.id,o.title,o.status,o.planned_on::text AS planned_on,ob.id AS object_id,ob.name AS object_name,ob.address AS object_address,c.name AS client_name FROM public.mvp_orders o JOIN public.mvp_objects ob ON ob.id=o.object_id LEFT JOIN public.mvp_clients c ON c.id=ob.client_id WHERE (o.status='open' AND o.planned_on=$1::date) OR o.status='active' ORDER BY (o.planned_on=$1::date) DESC,o.updated_at DESC,o.id DESC LIMIT 26",[today])
 ]);
 const topSessions=sessions.rows.slice(0,20),topLogs=logs.rows.slice(0,10),plannedOrders=orders.rows.slice(0,25);
 // The selected order is an ephemeral screen choice, never a second canonical
 // "current order". Active session, physical visit and WorkOrder remain distinct.
 const visitResult=await pool.query(
  "SELECT p.id,p.day_date::text AS day_date,p.status,p.order_id,p.object_id,p.arrived_at,p.revision,ob.name AS object_name,ob.address AS object_address,c.name AS client_name,o.title AS order_title FROM public.mvp_object_presence p JOIN public.mvp_objects ob ON ob.id=p.object_id LEFT JOIN public.mvp_clients c ON c.id=ob.client_id LEFT JOIN public.mvp_orders o ON o.id=p.order_id WHERE p.status='open' ORDER BY p.arrived_at DESC LIMIT 1"
 );
 const currentPresence=visitResult.rows[0]||null;
 const focusOrderId=requestedOrderId||current.rows[0]?.order_id||currentPresence?.order_id||orders.rows[0]?.id||null;
 let contextOrder=null,assignedWorkers=[],moreAssignedWorkers=false;
 if(focusOrderId){
  const order=await pool.query(
   'SELECT o.id,o.title,o.status,o.planned_on::text AS planned_on,ob.id AS object_id,ob.name AS object_name,ob.address AS object_address,c.id AS client_id,c.name AS client_name FROM public.mvp_orders o JOIN public.mvp_objects ob ON ob.id=o.object_id LEFT JOIN public.mvp_clients c ON c.id=ob.client_id WHERE o.id=$1::uuid',
   [focusOrderId]
  );
  contextOrder=order.rows[0]||null;
  if(contextOrder){
   // Scoped by exact WorkOrder ID. Assignment != attendance != performed work.
   const workers=await pool.query(
    `SELECT a.worker_id,w.name,w.status AS worker_status,w.role_title,
      wd.status AS day_status,wd.arrival_at,wd.departure_at,
      wt.active_count,wt.completed_count,wt.completed_minutes,
      last_task.task_type AS latest_task_type,last_task.status AS latest_task_status,
      last_task.result_qty::text AS latest_result_qty,last_task.result_unit AS latest_result_unit,
      last_task.outcome AS latest_outcome
     FROM public.mvp_worker_order_assignments a
     JOIN public.mvp_workers w ON w.id=a.worker_id
     LEFT JOIN LATERAL (
       SELECT d.status,d.arrival_at,d.departure_at
       FROM public.mvp_worker_day_orders l
       JOIN public.mvp_worker_days d ON d.id=l.worker_day_id
       WHERE l.work_order_id=a.order_id AND l.status='active'
         AND d.worker_id=a.worker_id AND d.day_date=$2::date AND d.status<>'archived'
       ORDER BY d.created_at DESC LIMIT 1
     ) wd ON true
     LEFT JOIN LATERAL (
       SELECT count(*) FILTER (WHERE t.status='active')::int AS active_count,
        count(*) FILTER (WHERE t.status='completed')::int AS completed_count,
        coalesce(sum(t.duration_minutes) FILTER (WHERE t.status='completed'),0)::int AS completed_minutes
       FROM public.mvp_worker_tasks t
       WHERE t.order_id=a.order_id AND t.worker_id=a.worker_id AND t.day_date=$2::date
         AND t.status<>'archived'
     ) wt ON true
     LEFT JOIN LATERAL (
       SELECT t.task_type,t.status,t.result_qty,t.result_unit,t.outcome
       FROM public.mvp_worker_tasks t
       WHERE t.order_id=a.order_id AND t.worker_id=a.worker_id
         AND t.day_date=$2::date AND t.status<>'archived'
       ORDER BY t.start_at DESC,t.id DESC LIMIT 1
     ) last_task ON true
     WHERE a.order_id=$1::uuid AND a.status='active'
     ORDER BY w.name,w.id LIMIT 51`,
    [focusOrderId,today]
   );
   moreAssignedWorkers=workers.rows.length>50;
   assignedWorkers=workers.rows.slice(0,50);
  }
 }

 return {
  today,day:day.rows[0]||null,currentSession:current.rows[0]||null,
  todayTotals:{logCount:totals.rows[0].count,workMinutes:Number(totals.rows[0].minutes)},
  todayLogs:topLogs,moreTodayLogs:logs.rows.length>10,
  todaySessions:topSessions,moreTodaySessions:sessions.rows.length>20,
  recentWorkdays:recent.rows.map(x=>({...x,work_minutes:Number(x.work_minutes)})),
  plannedOrders,morePlannedOrders:orders.rows.length>25,
  selectedOrderId:focusOrderId,contextOrder,currentPresence,assignedWorkers,moreAssignedWorkers,
  sources:{a1:'INDEPENDENT_API',physicalPresence:'INDEPENDENT_API',ownerBusinessTime:'INDEPENDENT_API',workerPresence:'WORKER_DAY_SEPARATE'}
 };
}
