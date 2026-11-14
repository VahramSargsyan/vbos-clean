import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFinanceCreate,FinanceCreateNormalizeError,FINANCE_CREATE_ENUMS}
 from '../finance-create-normalize.mjs';
import {financeSummaryFromRows,financeScopeFromRequest} from '../finance-summary-engine.mjs';

const refs={
 clients:{'CLI-2026-0001':{clientId:'CLI-2026-0001',name:'Client One'}},
 objects:{'OBJ-2026-0001':{objectId:'OBJ-2026-0001',clientId:'CLI-2026-0001'}},
 workOrders:{'WO-2026-0001':{workOrderId:'WO-2026-0001',
  objectId:'OBJ-2026-0001',clientId:'CLI-2026-0001'}},
 workers:{'WRK-2026-0001':{workerId:'WRK-2026-0001',status:'active'},
  'WRK-2026-0002':{workerId:'WRK-2026-0002',status:'archived'}}
};
const context={todayKey:'2026-11-09',references:refs};
const create=(p={})=>normalizeFinanceCreate({category:'bonus',amountOriginal:'100',...p},context);
const metrics=(p)=>({cash:p.cashEffectBase,profit:p.profitEffectBase,debt:p.workerPayableEffectBase});
const expectInvalid=(payload,code)=>{
 assert.throws(()=>normalizeFinanceCreate({category:'bonus',...payload},context),
  e=>e instanceof FinanceCreateNormalizeError&&e.code===code,code);
};

test('old Config.js has 6 types, same categories, currencies, directions',()=>{
 assert.deepEqual(FINANCE_CREATE_ENUMS.operationTypes,[
  'INCOME','EXPENSE','WORKER_ACCRUAL','WORKER_PAYMENT',
  'WORKER_ACCRUAL_PAYMENT','OWNER_TRANSFER']);
 assert.deepEqual(FINANCE_CREATE_ENUMS.incomeCategories,[
  'current_work','advance','client_material_funds','old_debt','bonus','other']);
 assert.deepEqual(FINANCE_CREATE_ENUMS.expenseCategories,[
  'materials','client_material_purchase','transport','tools','subcontractor','office','other']);
 assert.deepEqual(FINANCE_CREATE_ENUMS.currencies,['AMD','USD','EUR']);
 assert.deepEqual(FINANCE_CREATE_ENUMS.ownerDirections,['wife','home','self','investments','other']);
});

test('original payment and earned-only effects remain separate',()=>{
 const standard=create({category:'bonus',amountOriginal:'100',commissionOriginal:'5'});
 assert.deepEqual(metrics(standard),{cash:95,profit:95,debt:0});
 assert.equal(standard.incomeRecognition,'EARNED_AND_RECEIVED');
 const earned=create({category:'bonus',incomeRecognition:'EARNED_ONLY',
  amountOriginal:'100',commissionOriginal:'0'});
 assert.deepEqual(metrics(earned),{cash:0,profit:100,debt:0});
 const oldDebt=create({category:'old_debt',amountOriginal:'100',commissionOriginal:'5'});
 assert.equal(oldDebt.incomeRecognition,'RECEIVED_ONLY');
 assert.deepEqual(metrics(oldDebt),{cash:95,profit:-5,debt:0});
 expectInvalid({operationType:'INCOME',category:'bonus',incomeRecognition:'EARNED_ONLY',
  amountOriginal:'100',commissionOriginal:'1'},'FINANCE_CREATE_UNPAID_INCOME_COMMISSION');
});

test('client material transit: principal does not create profit, order is required',()=>{
 const materialFunds=create({category:'client_material_funds',incomeRecognition:'EARNED_ONLY',
  workOrderId:'WO-2026-0001',amountOriginal:300000});
 assert.equal(materialFunds.incomeRecognition,'RECEIVED_ONLY');
 assert.deepEqual(metrics(materialFunds),{cash:300000,profit:0,debt:0});
 assert.equal(materialFunds.objectId,'OBJ-2026-0001');
 assert.equal(materialFunds.clientId,'CLI-2026-0001');
 const purchase=create({operationType:'EXPENSE',category:'client_material_purchase',
  amountOriginal:295000,commissionOriginal:10,workOrderId:'WO-2026-0001'});
 assert.deepEqual(metrics(purchase),{cash:-295010,profit:-10,debt:0});
 const subtotal=financeSummaryFromRows([materialFunds,purchase]);
 assert.equal(subtotal.profitBase,'-10.000000');
 assert.equal(subtotal.cashBalanceBase,'4990.000000');
 for(const category of ['current_work','advance','client_material_funds'])
  expectInvalid({operationType:'INCOME',category,amountOriginal:100},
   'FINANCE_CREATE_WORK_ORDER_REQUIRED');
 expectInvalid({operationType:'EXPENSE',category:'client_material_purchase',
  amountOriginal:100},'FINANCE_CREATE_WORK_ORDER_REQUIRED');
});

test('normal expense, original USD/AMD FX and commission arithmetic',()=>{
 const expense=create({operationType:'EXPENSE',category:'transport',amountOriginal:120,
  commissionOriginal:4});
 assert.deepEqual(metrics(expense),{cash:-124,profit:-124,debt:0});
 const income=create({operationType:'INCOME',category:'bonus',currencyOriginal:'usd',
  amountOriginal:'10,25',fxRate:410,commissionOriginal:'0,50',
  transactionDate:'2026-11-08',fxRateDate:'2026-11-07',fxRateSource:'manual'});
 assert.equal(income.currencyOriginal,'USD');
 assert.equal(income.baseCurrency,'AMD');
 assert.equal(income.amountBase,4202.5);
 assert.equal(income.commissionBase,205);
 assert.deepEqual(metrics(income),{cash:3997.5,profit:3997.5,debt:0});
 assert.equal(income.fxRateSource,'manual');
 assert.equal(income.transactionDateKey,'2026-11-08');
 assert.equal(income.fxRateDate,'2026-11-07');
 const local=create({amountOriginal:25,fxRate:999,currencyOriginal:'AMD'});
 assert.equal(local.fxRate,1);
 assert.equal(local.fxRateSource,'same_currency');
 assert.equal(local.amountBase,25);
});

test('worker accrual/payment/accrual+payment exact original debt/profit/cash effects',()=>{
 const link={workerId:'WRK-2026-0001',workOrderId:'WO-2026-0001'};
 const accrual=create({...link,operationType:'WORKER_ACCRUAL',amountOriginal:200});
 assert.deepEqual(metrics(accrual),{cash:0,profit:-200,debt:200});
 const payment=create({workerId:link.workerId,operationType:'WORKER_PAYMENT',
  amountOriginal:40,commissionOriginal:2});
 assert.deepEqual(metrics(payment),{cash:-42,profit:-2,debt:-40});
 const combined=create({...link,operationType:'WORKER_ACCRUAL_PAYMENT',
  amountOriginal:40,commissionOriginal:2});
 assert.deepEqual(metrics(combined),{cash:-42,profit:-42,debt:0});
 assert.equal(combined.category,'worker');
 assert.equal(combined.workerId,link.workerId);
 expectInvalid({operationType:'WORKER_ACCRUAL',workerId:link.workerId,amountOriginal:100},
  'FINANCE_CREATE_WORK_ORDER_REQUIRED');
 expectInvalid({operationType:'WORKER_ACCRUAL',...link,amountOriginal:100,commissionOriginal:1},
  'FINANCE_CREATE_ACCRUAL_COMMISSION');
 expectInvalid({operationType:'WORKER_PAYMENT',workerId:'WRK-2026-0002',amountOriginal:100},
  'FINANCE_CREATE_WORKER_ARCHIVED');
 expectInvalid({operationType:'WORKER_PAYMENT',amountOriginal:100},'FINANCE_CREATE_WORKER_REQUIRED');
});

test('owner transfer must have a direction, clears links and never auto-allocates capital',()=>{
 const p=create({operationType:'OWNER_TRANSFER',ownerDirection:'investments',
  amountOriginal:100,commissionOriginal:5,workOrderId:'WO-2026-0001',
  clientId:'CLI-2026-0001',objectId:'OBJ-2026-0001',workerId:'WRK-2026-0001'});
 assert.deepEqual(metrics(p),{cash:-105,profit:-5,debt:0});
 assert.equal(p.ownerDirection,'investments');
 assert.equal(p.category,'owner_transfer');
 assert.equal(p.workOrderId,'');
 assert.equal(p.workerId,'');
 assert.equal(p.objectId,'');
 assert.equal(p.clientId,'');
 assert.equal(p.capitalAllocation,undefined);
 expectInvalid({operationType:'OWNER_TRANSFER',amountOriginal:100},
  'FINANCE_CREATE_INVALID_ownerDirection');
});

test('injected references enforce existing work order/object/client IDs and identities',()=>{
 const p=create({workOrderId:'WO-2026-0001',amountOriginal:100});
 assert.equal(p.clientId,'CLI-2026-0001');
 expectInvalid({workOrderId:'WO-2026-9999',amountOriginal:100},
  'FINANCE_CREATE_REFERENCE_NOT_FOUND_workOrders');
 expectInvalid({workOrderId:'WO-2026-0001',objectId:'OBJ-2026-9999',amountOriginal:100},
  'FINANCE_CREATE_ORDER_OBJECT_MISMATCH');
 expectInvalid({objectId:'OBJ-2026-9999',amountOriginal:100},
  'FINANCE_CREATE_REFERENCE_NOT_FOUND_objects');
 expectInvalid({clientId:'CLI-2026-9999',amountOriginal:100},
  'FINANCE_CREATE_REFERENCE_NOT_FOUND_clients');
 expectInvalid({objectId:'OBJ-2026-0001',clientId:'CLI-2026-9999',amountOriginal:100},
  'FINANCE_CREATE_OBJECT_CLIENT_MISMATCH');
 assert.equal(create({objectId:'OBJ-2026-0001'}).clientId,'CLI-2026-0001');
 assert.equal(create({clientId:'CLI-2026-0001'}).clientId,'CLI-2026-0001');
 assert.equal(create({workOrderId:'WO-2026-0001',clientId:'CLI-2026-9999'}).clientId,'CLI-2026-0001');
});

test('source defaults, six-decimal rounding, safe text limits and date rules',()=>{
 const p=create({category:'current_work',workOrderId:'WO-2026-0001',amountOriginal:'0.1234567',counterparty:' A '.repeat(120),
  notes:' B '.repeat(2000)});
 assert.equal(p.operationType,'INCOME');
 assert.equal(p.category,'current_work');
 assert.equal(p.transactionDate,'2026-11-09');
 assert.equal(p.fxRateDate,'2026-11-09');
 assert.equal(p.amountOriginal,0.123457);
 assert.equal(p.amountBase,0.123457);
 assert.equal(p.sourceModule,'Finance');
 assert.equal(p.notes.length,5000);
 assert.equal(p.counterparty.length,300);
 assert.equal(p.archivedAt,'');
 assert.equal(p.status,'active');
 assert.equal(Object.isFrozen(p),true);
 const dateFallback=create({transactionDate:'',fxRateDate:''});
 assert.equal(dateFallback.transactionDate,'2026-11-09');
 assert.equal(dateFallback.fxRateDate,'2026-11-09');
 const received=create({category:'advance',workOrderId:'WO-2026-0001',amountOriginal:100});
 assert.equal(received.incomeRecognition,'RECEIVED_ONLY');
});

test('fails closed on invalid dates, money, type/category/recognition, status and update IDs',()=>{
 expectInvalid({amountOriginal:100,transactionDate:'2026-02-30'},
  'FINANCE_CREATE_NONCALENDAR_transactionDate');
 expectInvalid({amountOriginal:100,fxRateDate:'2026-13-01'},
  'FINANCE_CREATE_NONCALENDAR_fxRateDate');
 expectInvalid({amountOriginal:100,transactionDate:'2026-1-9'},
  'FINANCE_CREATE_INVALID_transactionDate');
 for(const invalid of ['NaN','Infinity','-1','','hello']){
  expectInvalid({amountOriginal:invalid},invalid===''?
   'FINANCE_CREATE_REQUIRED_amountOriginal':'FINANCE_CREATE_INVALID_amountOriginal');
 }
 expectInvalid({operationType:'INCOME',amountOriginal:100,category:'forged'},
  'FINANCE_CREATE_INVALID_category');
 expectInvalid({operationType:'EXPENSE',amountOriginal:100,category:'bonus'},
  'FINANCE_CREATE_INVALID_category');
 expectInvalid({operationType:'UNKNOWN',amountOriginal:100},
  'FINANCE_CREATE_INVALID_operationType');
 expectInvalid({operationType:'INCOME',amountOriginal:100,incomeRecognition:'UNPAID'},
  'FINANCE_CREATE_INVALID_incomeRecognition');
 expectInvalid({currencyOriginal:'BTC',amountOriginal:100},
  'FINANCE_CREATE_INVALID_currencyOriginal');
 expectInvalid({currencyOriginal:'USD',amountOriginal:100,fxRate:0},
  'FINANCE_CREATE_INVALID_fxRate');
 expectInvalid({status:'archived',amountOriginal:100},
  'FINANCE_CREATE_ARCHIVED_NOT_ALLOWED');
 expectInvalid({financeTransactionId:'FIN-2026-0001',amountOriginal:100},
  'FINANCE_CREATE_NOT_AN_UPDATE');
});

test('no persistence, ID creation or source data copy in normalized output',()=>{
 const p=create({amountOriginal:20,cashEffectBase:999999,
  profitEffectBase:999999,workerPayableEffectBase:999999,
  clientRequestId:'SECRET',financeTransactionId:null,sourceModule:'UNTRUSTED'});
 assert.equal(p.cashEffectBase,20);
 assert.equal(p.profitEffectBase,20);
 assert.equal(p.workerPayableEffectBase,0);
 assert.equal(p.clientRequestId,undefined);
 assert.equal(p.financeTransactionId,undefined);
 assert.equal(p.sourceModule,'Finance');
 assert.ok(!Object.hasOwn(p,'capitalAllocation'));
 assert.deepEqual(Object.keys(p).sort(),[
  'status','transactionDate','transactionDateKey','operationType','category','incomeRecognition',
  'amountOriginal','currencyOriginal','baseCurrency','fxRate','fxRateDate','fxRateSource',
  'amountBase','commissionOriginal','commissionBase','cashEffectBase','profitEffectBase',
  'workerPayableEffectBase','clientId','objectId','workOrderId','workerId','counterparty',
  'ownerDirection','sourceModule','notes','archivedAt'
 ].sort());
 const total=financeSummaryFromRows([p],financeScopeFromRequest());
 assert.equal(total.profitBase,'20.000000');
});
