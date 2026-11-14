/* VBOS Clean — bounded parity adapter for TimeEngine_v1_12_0.js and
 * PlanningCapacityCalendarTimeEngineBridge_v1_12_1.html.
 * Only the legacy MANUAL duration source is authorized for this Calendar path.
 * RULE/BENCHMARK require independently verified input and separate adoption.
 * No second availability model, labor policy, worker estimate or writing API.
 */
export const TIME_ENGINE_V1120='v1.12.0';
export const CALENDAR_TIME_BRIDGE_V1121='CALENDAR_TIME_ENGINE_MANUAL_V1121';
export const CALENDAR_TIME_SOURCE_REF='CALENDAR_CAPACITY_FINDER_V1121';

export function resolveManualCalendarTimeV1120(input,AppError=Error){
 const requested=String(input?.durationSource??'MANUAL').trim().toUpperCase();
 if(requested!=='MANUAL')throw new AppError(400,'Источник времени ещё не подтверждён для календаря. Доступен только ручной ввод.');
 const raw=input?.durationWorkingDays;
 if(!Number.isInteger(raw)||raw<1||raw>60)
  throw new AppError(400,'Укажи целое число от 1 до 60 рабочих дней.');
 return {
  version:TIME_ENGINE_V1120,
  generatedAt:new Date().toISOString(),
  resolutionMode:'EXPLICIT_SOURCE_V1',
  durationSource:'MANUAL',
  requestedSource:'MANUAL',
  durationWorkingDays:raw,
  durationMinutes:null,
  durationHours:null,
  readyForCapacity:true,
  coverage:'EXPLICIT_MANUAL_WORKING_DAYS',
  sourceRef:CALENDAR_TIME_SOURCE_REF,
  sourceVersion:'',
  sourceStatus:'CONFIRMED_INPUT',
  reason:'',
  capacityAuthority:'SharedCapacityDecision_v1_11_1',
  availabilityAuthority:'ScheduleItems'
 };
}

// The only bridge owner: resolve MANUAL time first, then run the existing
// SharedCapacity reader exactly once with its validated duration.
export async function timeEngineCapacityRead(input,{readCapacity,AppError=Error}){
 const time=resolveManualCalendarTimeV1120(input,AppError);
 if(!time.readyForCapacity||!readCapacity)throw new AppError(503,'Time Engine не подготовил длительность для Capacity.');
 const capacity=await readCapacity(time.durationWorkingDays);
 if(capacity?.version!=='CAPACITY_SCHEDULE_V1'||
    capacity.sourceCoverage!=='SCHEDULE_ONLY_NOT_FULL_DURATION'||
    capacity.bookingReady!==false||
    capacity.durationWorkingDays!==time.durationWorkingDays)
   throw new AppError(503,'Shared Capacity не подтвердил источник или длительность.');
 return {
  ...capacity,
  timeBridgeVersion:CALENDAR_TIME_BRIDGE_V1121,
  time,
  timeEngineFit:capacity.fit,
  timeEngineRecommendation:capacity.windows?.length?'EARLIEST_REALISTIC_WINDOW_AVAILABLE':'NO_CONFIRMED_WINDOW_IN_HORIZON'
 };
}
