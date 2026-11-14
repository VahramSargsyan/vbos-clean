/**
 * CRM-17A pure legacy Estimator adapter; reference-only, no DB/Google/Finance writes.
 * Data blocks below are exact scoped snapshots of:
 *   EstimatorTariffCatalog.js (main, 2026-11-08)
 *   EstimatorNodeMaterials_v1_5_6.js (main, 2026-11-08)
 * Ready codes come from EstimatorEngineeringCatalog.js READY.
 * Pricing calculation follows EstimatorPricePolicy.js / EstimatorService.js:
 * Economy base * tariff multiplier; no unknown DB price floors inferred.
 * Legacy source package SHA256 6030a6ff90b9283d29a709a53a4dc9b2d6ebec46df806c9d31c8ef243d4fce02.
 */
import {resolveEstimatorUnitPrice} from './estimate-pricebook.mjs';
const SOURCE='LEGACY_ESTIMATOR_2026_08_30_REFERENCE_ONLY';
const MUL=Object.freeze({ECONOM:1,STANDARD_PLUS:1.25,VIP:1.5});
const READY_ITEMS=Object.freeze({"WC":{"name":"Унитаз","category":"SANITARY"},"WASH":{"name":"Раковина","category":"SANITARY"},"SH":{"name":"Душ","category":"SANITARY"},"SH+":{"name":"Душ с доп. функциями","category":"SANITARY"},"BATH":{"name":"Ванна","category":"SANITARY"},"JAC":{"name":"Джакузи","category":"SANITARY"},"KIT":{"name":"Кухонная мойка","category":"KITCHEN_APPLIANCE"},"WM":{"name":"Стиральная машина","category":"KITCHEN_APPLIANCE"},"BAXI":{"name":"Котёл","category":"EQUIPMENT"},"INSTALL":{"name":"Инсталляция","category":"EQUIPMENT"},"WMETER":{"name":"Водомер","category":"EQUIPMENT"},"I-HG":{"name":"Инсталляция с гигиеническим душем","category":"EQUIPMENT"}});
function estimatorTariffPriceRowV1_(amount, priceMode, sourceCode, sourceName, sourceUnit){
 return Object.freeze({amount:Number(amount),currency:'AMD',priceMode,sourceCode,sourceName,sourceUnit});
}
const VBOS_ESTIMATOR_TARIFF_PRICE_SOURCE_V1 = Object.freeze({
  ECONOM: Object.freeze({
    WMETER: estimatorTariffPriceRowV1_(10000, 'FIXED', 'WMETER', 'Монтаж водомера', 'Шт'),
    BAXI: estimatorTariffPriceRowV1_(30000, 'FIXED', 'BAXI', 'Монтаж газового котла', 'Шт'),
    'I-HG': estimatorTariffPriceRowV1_(30000, 'FIXED', 'IHG', 'Монтаж встроенного гигиенического душа', 'Шт'),
    SH: estimatorTariffPriceRowV1_(7250, 'FROM', 'SH', 'Установка душевого смесителя (Обычный)', 'Шт'),
    'SH+': estimatorTariffPriceRowV1_(20000, 'FROM', 'SH+', 'Установка душевого смесителя (сложный)', 'Шт'),
    INSTALL: estimatorTariffPriceRowV1_(60000, 'FIXED', 'INSTAL', 'Монтаж и установка инсталляции', 'Шт'),
    WC: estimatorTariffPriceRowV1_(15000, 'FROM', 'WC', 'Установка унитаза', 'Шт'),
    WASH: estimatorTariffPriceRowV1_(10000, 'FROM', 'WASH', 'Установка раковины', 'Шт'),
    KIT: estimatorTariffPriceRowV1_(10000, 'FROM', 'KIT', 'Установка раковины кухни', 'Шт'),
    WM: estimatorTariffPriceRowV1_(10000, 'FIXED', 'WM', 'Установка стиральной машины', 'Шт'),
    BATH: estimatorTariffPriceRowV1_(20000, 'FROM', 'BATH', 'Установка ванной', 'Шт'),
    JAC: estimatorTariffPriceRowV1_(50000, 'FROM', 'JAC', 'Установка джакузи', 'Шт')
  }),
  STANDARD_PLUS: Object.freeze({
    WMETER: estimatorTariffPriceRowV1_(12500, 'FIXED', 'WMETER', 'Монтаж водомера', 'Шт'),
    BAXI: estimatorTariffPriceRowV1_(37500, 'FIXED', 'BAXI', 'Монтаж газового котла', 'Шт'),
    'I-HG': estimatorTariffPriceRowV1_(37500, 'FIXED', 'IHG', 'Монтаж встроенного гигиенического душа', 'Шт'),
    SH: estimatorTariffPriceRowV1_(9000, 'FROM', 'SH', 'Установка душевого смесителя (Обычный)', 'Шт'),
    'SH+': estimatorTariffPriceRowV1_(25000, 'FROM', 'SH+', 'Установка душевого смесителя (сложный)', 'Шт'),
    INSTALL: estimatorTariffPriceRowV1_(75000, 'FIXED', 'INSTAL', 'Монтаж и установка инсталляции', 'Шт'),
    WC: estimatorTariffPriceRowV1_(19000, 'FROM', 'WC', 'Установка унитаза', 'Шт'),
    WASH: estimatorTariffPriceRowV1_(12500, 'FROM', 'WASH', 'Установка раковины', 'Шт'),
    KIT: estimatorTariffPriceRowV1_(12500, 'FROM', 'KIT', 'Установка раковины кухни', 'Шт'),
    WM: estimatorTariffPriceRowV1_(12500, 'FIXED', 'WM', 'Установка стиральной машины', 'Шт'),
    BATH: estimatorTariffPriceRowV1_(25000, 'FROM', 'BATH', 'Установка ванной', 'Шт'),
    JAC: estimatorTariffPriceRowV1_(62500, 'FROM', 'JAC', 'Установка джакузи', 'Шт')
  }),
  VIP: Object.freeze({
    WMETER: estimatorTariffPriceRowV1_(15000, 'FIXED', 'WMETER', 'Монтаж водомера', 'Шт'),
    BAXI: estimatorTariffPriceRowV1_(45000, 'FIXED', 'BAXI', 'Монтаж газового котла', 'Шт'),
    'I-HG': estimatorTariffPriceRowV1_(45000, 'FIXED', 'IHG', 'Монтаж встроенного гигиенического душа', 'Шт'),
    SH: estimatorTariffPriceRowV1_(10500, 'FROM', 'SH', 'Установка душевого смесителя (Обычный)', 'Шт'),
    'SH+': estimatorTariffPriceRowV1_(30000, 'FROM', 'SH+', 'Установка душевого смесителя (сложный)', 'Шт'),
    INSTALL: estimatorTariffPriceRowV1_(90000, 'FIXED', 'INSTAL', 'Монтаж и установка инсталляции', 'Шт'),
    WC: estimatorTariffPriceRowV1_(22500, 'FROM', 'WC', 'Установка унитаза', 'Шт'),
    WASH: estimatorTariffPriceRowV1_(15000, 'FROM', 'WASH', 'Установка раковины', 'Шт'),
    KIT: estimatorTariffPriceRowV1_(15000, 'FROM', 'KIT', 'Установка раковины кухни', 'Шт'),
    WM: estimatorTariffPriceRowV1_(15000, 'FIXED', 'WM', 'Установка стиральной машины', 'Шт'),
    BATH: estimatorTariffPriceRowV1_(30000, 'FROM', 'BATH', 'Установка ванной', 'Шт'),
    JAC: estimatorTariffPriceRowV1_(75000, 'FROM', 'JAC', 'Установка джакузи', 'Шт')
  })
});

const VBOS_ESTIMATOR_POINT_PRICES_V1 = Object.freeze({
  ECONOM: Object.freeze({COLD_WATER: 6000, HOT_WATER: 6000, SEWER: 6000}),
  STANDARD_PLUS: Object.freeze({COLD_WATER: 7500, HOT_WATER: 7500, SEWER: 7500}),
  VIP: Object.freeze({COLD_WATER: 9000, HOT_WATER: 9000, SEWER: 9000})
});

function estimatorMaterialItemV156_(name, quantity, unit, section){
 return Object.freeze({name:String(name),quantity:Number(quantity),unit:String(unit||'шт'),section:String(section||'')});
}
function estimatorMaterialRecipeV156_(status, items, note){
 return Object.freeze({status:String(status),items:Object.freeze((items||[]).slice()),note:String(note||'')});
}
const VBOS_ESTIMATOR_NODE_MATERIALS_V156 = Object.freeze({
  WC:estimatorMaterialRecipeV156_('READY',[
    estimatorMaterialItemV156_('Угольник Ø20 ВР',1,'шт','Вода'),
    estimatorMaterialItemV156_('Тройник Ø20-20-20',1,'шт','Вода'),
    estimatorMaterialItemV156_('Вентиль Ø20',1,'шт','Вода'),
    estimatorMaterialItemV156_('Шланг 45 см',1,'шт','Вода'),
    estimatorMaterialItemV156_('Труба Ø20',0.5,'м','Вода'),
    estimatorMaterialItemV156_('Заглушка Ø20 НР',1,'шт','Вода'),
    estimatorMaterialItemV156_('Гофра Ø110',1,'шт','Канализация'),
    estimatorMaterialItemV156_('Тройник Ø110-110-110 45°',1,'шт','Канализация'),
    estimatorMaterialItemV156_('Переход Ø110-50',1,'шт','Канализация')
  ]),
  WASH:estimatorMaterialRecipeV156_('READY',[
    estimatorMaterialItemV156_('Z-панель',1,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Труба Ø20',0.5,'м','Вода Ø20'),
    estimatorMaterialItemV156_('Заглушка Ø20 НР',2,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Вентиль Ø20',2,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Утка Ø20',1,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Тройник Ø20-20-20',2,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Угольник Ø50 90°',1,'шт','Канализация Ø50'),
    estimatorMaterialItemV156_('Угольник Ø50 45°',3,'шт','Канализация Ø50'),
    estimatorMaterialItemV156_('Тройник Ø50 45°',1,'шт','Канализация Ø50'),
    estimatorMaterialItemV156_('Заглушка Ø50',1,'шт','Канализация Ø50')
  ]),
  SH:estimatorMaterialRecipeV156_('READY',[
    estimatorMaterialItemV156_('Z-панель',1,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Утка Ø20',1,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Тройник Ø20-20-20',2,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Труба Ø20',0.7,'м','Вода Ø20'),
    estimatorMaterialItemV156_('Заглушка Ø20 НР',2,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Тройник Ø50 45°',1,'шт','Канализация Ø50'),
    estimatorMaterialItemV156_('Угольник Ø50 45°',1,'шт','Канализация Ø50'),
    estimatorMaterialItemV156_('Угольник для трапа (короткий)',1,'шт','Канализация Ø50')
  ]),
  'SH+':estimatorMaterialRecipeV156_('READY',[
    estimatorMaterialItemV156_('Z-панель',1,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Утка Ø20',1,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Тройник Ø20-20-20',2,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Труба Ø20',0.7,'м','Вода Ø20'),
    estimatorMaterialItemV156_('Заглушка Ø20 НР',2,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Тройник Ø50 45°',1,'шт','Канализация Ø50'),
    estimatorMaterialItemV156_('Угольник Ø50 45°',1,'шт','Канализация Ø50'),
    estimatorMaterialItemV156_('Угольник для трапа (короткий)',1,'шт','Канализация Ø50')
  ]),
  BATH:estimatorMaterialRecipeV156_('READY',[
    estimatorMaterialItemV156_('Z-панель',1,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Утка Ø20',1,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Тройник Ø20-20-20',2,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Труба Ø20',0.7,'м','Вода Ø20'),
    estimatorMaterialItemV156_('Заглушка Ø20 НР',2,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Тройник Ø50 45°',1,'шт','Канализация Ø50'),
    estimatorMaterialItemV156_('Угольник Ø50 45°',1,'шт','Канализация Ø50'),
    estimatorMaterialItemV156_('Сифон для ванны',1,'шт','Канализация Ø50')
  ]),
  JAC:estimatorMaterialRecipeV156_('READY',[
    estimatorMaterialItemV156_('Z-панель',1,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Утка Ø20',1,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Тройник Ø20-20-20',2,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Труба Ø20',0.7,'м','Вода Ø20'),
    estimatorMaterialItemV156_('Заглушка Ø20 НР',2,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Тройник Ø50 45°',1,'шт','Канализация Ø50'),
    estimatorMaterialItemV156_('Угольник Ø50 45°',1,'шт','Канализация Ø50'),
    estimatorMaterialItemV156_('Сифон для джакузи',1,'шт','Канализация Ø50')
  ]),
  KIT:estimatorMaterialRecipeV156_('READY',[
    estimatorMaterialItemV156_('Z-панель',1,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Тройник Ø20-20-20',2,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Угольник Ø20 90°',2,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Заглушка Ø20 НР',2,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Вентиль Ø20',2,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Угольник Ø50 90°',1,'шт','Канализация Ø50'),
    estimatorMaterialItemV156_('Угольник Ø50 45°',2,'шт','Канализация Ø50')
  ]),
  WM:estimatorMaterialRecipeV156_('READY',[
    estimatorMaterialItemV156_('Угольник Ø20 ВР',1,'шт','Вода'),
    estimatorMaterialItemV156_('Тройник Ø20-20-20',1,'шт','Вода'),
    estimatorMaterialItemV156_('Заглушка Ø20 НР',1,'шт','Вода'),
    estimatorMaterialItemV156_('Утка Ø20',1,'шт','Вода'),
    estimatorMaterialItemV156_('Вентиль Ø25',1,'шт','Вода'),
    estimatorMaterialItemV156_('Угольник Ø50 90°',1,'шт','Канализация Ø50'),
    estimatorMaterialItemV156_('Заглушка Ø50',1,'шт','Канализация Ø50'),
    estimatorMaterialItemV156_('Тройник Ø50 45°',1,'шт','Канализация Ø50'),
    estimatorMaterialItemV156_('Тандзик',1,'шт','Канализация Ø50')
  ]),
  WMETER:estimatorMaterialRecipeV156_('READY',[
    estimatorMaterialItemV156_('Переход Ø20 ВР',3,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Угольник Ø20 90°',4,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Вентиль Ø20 ВР',1,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Фильтр Ø20',1,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Обратный клапан Ø20',2,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Труба Ø20',1,'м','Вода Ø20')
  ]),
  'I-HG':estimatorMaterialRecipeV156_('READY',[
    estimatorMaterialItemV156_('Угольник Ø20 НР',2,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Утка Ø20',1,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Тройник Ø20-20-20',2,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Труба Ø20',0.5,'м','Вода Ø20')
  ]),
  INSTALL:estimatorMaterialRecipeV156_('READY',[
    estimatorMaterialItemV156_('Американка Ø20',1,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Угольник Ø20 90°',2,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Тройник Ø20-20-20',1,'шт','Вода Ø20'),
    estimatorMaterialItemV156_('Труба Ø20',1,'м','Вода Ø20'),
    estimatorMaterialItemV156_('Угольник Ø110 45°',1,'шт','Канализация Ø110'),
    estimatorMaterialItemV156_('Заглушка Ø50',1,'шт','Канализация Ø110'),
    estimatorMaterialItemV156_('Тройник Ø110 45°',1,'шт','Канализация Ø110')
  ]),
  BAXI:estimatorMaterialRecipeV156_('REQUIRES_VARIANT',[],'Для котла BAXI в источнике есть два разных варианта подключения. Выбери вариант до автоматического расчёта материалов.')
});

export const LEGACY_PLUMBING_REFERENCE=Object.freeze({
 source:SOURCE,currency:'AMD',sourceDate:'2026-08-30',
 packageSha256:'6030a6ff90b9283d29a709a53a4dc9b2d6ebec46df806c9d31c8ef243d4fce02',
 pricingMode:'ECONOMY_BASE_MULTIPLIER_NO_DB_FLOORS',routeMaterialsIncluded:false
});
const fail=(code)=>{throw Error('ESTIMATOR_CRM17_'+code)};
function whole(v,label,maximum=100){
 const raw=String(v??'0').trim();
 if(!/^\d{1,4}$/.test(raw))fail(label+'_INVALID');
 const n=Number(raw);
 if(n>maximum)fail(label+'_TOO_LARGE');
 return n;
}
function meters(v){
 const s=String(v??'0').trim().replace(',','.');
 if(!/^\d{1,5}(?:\.\d{1,3})?$/.test(s))fail('CHASING_METERS_INVALID');
 const n=Number(s);
 if(n>10000)fail('CHASING_METERS_TOO_LARGE');
 return n;
}
const q3=n=>(Math.round(n*1000)/1000).toFixed(3);
const rounded=n=>Math.round(n);
export function estimatorLegacyEconomyPrice(actionType,cardKey=''){
 if(actionType==='WATER')return VBOS_ESTIMATOR_POINT_PRICES_V1.ECONOM.COLD_WATER;
 if(actionType==='SEWER')return VBOS_ESTIMATOR_POINT_PRICES_V1.ECONOM.SEWER;
 if(actionType==='CHASING')return null;
 if(actionType==='FIXTURE_INSTALL')return VBOS_ESTIMATOR_TARIFF_PRICE_SOURCE_V1.ECONOM[String(cardKey||'').toUpperCase()]?.amount??null;
 return null;
}
export function listPlumbingItems(catalog=[]){
 const base=Object.keys(READY_ITEMS).map(code=>({
  cardKey:code,displayName:READY_ITEMS[code].name,category:READY_ITEMS[code].category,
  materialStatus:VBOS_ESTIMATOR_NODE_MATERIALS_V156[code]?.status||'NOT_READY',
  priceMode:VBOS_ESTIMATOR_TARIFF_PRICE_SOURCE_V1.ECONOM[code].priceMode
 }));
 if(!Array.isArray(catalog)||!catalog.length)return base;
 const allowed=catalog.filter(c=>c&&c.status==='active'&&typeof c.cardKey==='string');
 const map=new Map(allowed.map(x=>[x.cardKey.toUpperCase(),x]));
 const systems=base.map(x=>{
  const owner=map.get(x.cardKey);
  if(!owner||owner.sourceType!=='SYSTEM')return x;
  return {...x,displayName:owner.displayName,category:owner.category,
   materialStatus:owner.recipeMode==='OWNER_OVERRIDE'?(owner.materials?.length?'READY':'NOT_CONFIGURED'):x.materialStatus};
 });
 const user=allowed.filter(x=>x.sourceType==='USER'&&/^USR:[0-9a-f-]{36}$/i.test(x.cardKey))
  .map(x=>({cardKey:x.cardKey.toUpperCase(),displayName:x.displayName,category:x.category,
   materialStatus:x.materials?.length?'READY':'NOT_CONFIGURED',priceMode:'NOT_CONFIGURED'}));
 return systems.concat(user);
}
export function calculatePlumbingEstimate(input={}){
 const cardKey=String(input.cardKey||'').trim().toUpperCase();
 const item=Object.hasOwn(READY_ITEMS,cardKey)?READY_ITEMS[cardKey]:null;
 if(!item)fail('CARD_NOT_READY');
 const tariff=String(input.tariff||'').trim().toUpperCase();
 if(!Object.hasOwn(MUL,tariff))fail('TARIFF_INVALID');
 const count=whole(input.quantity,'FIXTURE_QUANTITY',50);
 if(count<1)fail('FIXTURE_QUANTITY_REQUIRED');
 const cold=whole(input.coldWaterPoints,'COLD_WATER_POINTS');
 const hot=whole(input.hotWaterPoints,'HOT_WATER_POINTS');
 const sewer=whole(input.sewerPoints,'SEWER_POINTS');
 const chasing=meters(input.chasingMeters);
 const install=input.install===true;
 const includeMaterials=input.includeMaterials!==false;
 const explicitPriceConfirmation=input.applyFixedReferencePrices===true;
 const mul=MUL[tariff],lines=[],warnings=[];
 function work(description,qty,unit,economBase,priceMode,actionType){
  const suggested=economBase===null?null:String(rounded(economBase*mul));
  const apply=suggested!==null&&priceMode==='FIXED'&&explicitPriceConfirmation;
  lines.push({kind:'WORK',description,quantity:q3(qty),unit,
   unitPriceAMD:apply?suggested:'',suggestedUnitPriceAMD:suggested,
   priceMode,sourceAction:actionType,
   note:priceMode==='FROM'?'Минимальная цена «от»: введи итоговую после осмотра.':
    priceMode==='NOT_CONFIGURED'?'Цена в старом источнике не настроена. Введи вручную.':
    'Историческая справочная цена, не текущий прайс.'});
 }
 if(cold+hot>0)work('Монтаж воды (ХВС '+cold+', ГВС '+hot+')',cold+hot,'точка',
  VBOS_ESTIMATOR_POINT_PRICES_V1.ECONOM.COLD_WATER,'FIXED','WATER');
 if(sewer>0)work('Монтаж канализации',sewer,'точка',
  VBOS_ESTIMATOR_POINT_PRICES_V1.ECONOM.SEWER,'FIXED','SEWER');
 if(install){
  const rate=VBOS_ESTIMATOR_TARIFF_PRICE_SOURCE_V1.ECONOM[cardKey];
  if(!rate)fail('INSTALL_PRICE_MISSING');
  work('Установка · '+item.name,count,'шт',rate.amount,rate.priceMode,'FIXTURE_INSTALL');
 }
 if(chasing>0)work('Штробление',chasing,'м',null,'NOT_CONFIGURED','CHASING');
 if(!lines.length)fail('WORK_ACTION_REQUIRED');
 let materialsStatus='NOT_REQUESTED';
 if(includeMaterials){
  const recipe=VBOS_ESTIMATOR_NODE_MATERIALS_V156[cardKey];
  materialsStatus=recipe?.status||'NOT_READY';
  if(materialsStatus==='READY'){
   for(const material of recipe.items){
    const qty=Math.round(material.quantity*count*1000)/1000;
    if(qty<=0)continue;
    lines.push({kind:'MATERIAL',description:material.name,quantity:q3(qty),
     unit:material.unit,unitPriceAMD:'',suggestedUnitPriceAMD:null,
     priceMode:'MATERIAL_PRICE_NOT_VERIFIED',sourceAction:'NODE_CARD_MATERIAL',
     note:'Только количество по узлу; трасса и цена не включены.'});
   }
  }else warnings.push('Материалы для '+item.name+' не рассчитаны: '+materialsStatus+
   '. Необходимо выбрать вариант и проверить рецепт вручную.');
 }
 warnings.push('Трассы, длины между узлами, повороты и запас материалов не рассчитаны.');
 warnings.push('Исторические цены работ от 30.08.2026 — справка, не текущий прайс. Цены «от» не заполняются автоматически.');
 if(lines.length>50)fail('RESULT_TOO_MANY_LINES');
 return {source:SOURCE,tariff,cardKey,displayName:item.name,quantity:count,
  materialsStatus,ownerConfirmedFixedPrices:explicitPriceConfirmation,
  lines,warnings,sourcePackageSha256:LEGACY_PLUMBING_REFERENCE.packageSha256,
  pricingComplete:false,committed:false};
}


// Multi-card source-backed standard counts from EstimatorCardStandards_v1_5_1.js.
// These are per appliance, not a guessed cold/hot water split.
const VBOS_ESTIMATOR_CARD_STANDARDS_V151 = Object.freeze({
  WC:Object.freeze({pointStatus:'FIXED',waterPoints:1,sewerPoints:1,laborMode:'POINTS_AND_NODE'}),
  WASH:Object.freeze({pointStatus:'FIXED',waterPoints:2,sewerPoints:1,laborMode:'POINTS_AND_NODE'}),
  SH:Object.freeze({pointStatus:'FIXED',waterPoints:2,sewerPoints:1,laborMode:'POINTS_AND_NODE'}),
  'SH+':Object.freeze({pointStatus:'FIXED',waterPoints:2,sewerPoints:1,laborMode:'POINTS_AND_NODE'}),
  BATH:Object.freeze({pointStatus:'FIXED',waterPoints:2,sewerPoints:1,laborMode:'POINTS_AND_NODE'}),
  JAC:Object.freeze({pointStatus:'FIXED',waterPoints:2,sewerPoints:1,laborMode:'POINTS_AND_NODE'}),
  KIT:Object.freeze({pointStatus:'FIXED',waterPoints:2,sewerPoints:1,laborMode:'POINTS_AND_NODE'}),
  WM:Object.freeze({pointStatus:'FIXED',waterPoints:1,sewerPoints:1,laborMode:'POINTS_AND_NODE'}),
  WMETER:Object.freeze({pointStatus:'FIXED',waterPoints:1,sewerPoints:0,laborMode:'POINTS_AND_NODE'}),
  INSTALL:Object.freeze({pointStatus:'FIXED',waterPoints:0,sewerPoints:0,laborMode:'EXCEL_ONLY'}),
  'I-HG':Object.freeze({pointStatus:'FIXED',waterPoints:0,sewerPoints:0,laborMode:'EXCEL_ONLY'}),
  BAXI:Object.freeze({pointStatus:'NOT_DECLARED',waterPoints:null,sewerPoints:null,laborMode:'NODE_ONLY'})
});


/**
 * Pure batch adapter for the old three-step multi-card Estimator.
 * No new writes; the pre-existing estimate_save remains sole canonical writer.
 * New rows are source-annotated by readable card name; no synthetic serviceId.
 */
export function calculatePlumbingEstimateBatch(input={}){
 const catalog=Array.isArray(input.cardCatalog)?input.cardCatalog.filter(x=>x?.status==='active'):[];
 const ownerMap=new Map(catalog.map(x=>[String(x.cardKey).toUpperCase(),x]));
 const cardItems=new Map(listPlumbingItems(catalog).map(x=>[x.cardKey,x]));
 const selected=Array.isArray(input.cards)?input.cards:[];
 if(!selected.length&&!input.chasing&&input.extraMaterials!==true)fail('BATCH_EMPTY');
 if(selected.length>12)fail('BATCH_TOO_MANY_CARDS');
 const seen=new Set(),groups=[],flat=[],warnings=[];
 const tariff=String(input.tariff||'').trim().toUpperCase();
 if(!Object.hasOwn(MUL,tariff))fail('TARIFF_INVALID');
 const pricebook=input.pricebook??null;
 for(const row of selected){
  const cardKey=String(row?.cardKey||'').trim().toUpperCase();
  if(!cardItems.has(cardKey))fail('CARD_NOT_READY');
  if(seen.has(cardKey))fail('BATCH_DUPLICATE_CARD');
  seen.add(cardKey);
  const standard=plumbingStandardForCard(cardKey,catalog);
  if(!standard)fail('CARD_STANDARD_MISSING');
  const name=cardItems.get(cardKey).displayName;
  const owner=ownerMap.get(cardKey);
  const qty=whole(row.quantity,'FIXTURE_QUANTITY',50);
  if(qty<1)fail('FIXTURE_QUANTITY_REQUIRED');
  const water=row.water===true,sewer=row.sewer===true,install=row.install===true;
  if(water&&!standard.supportsWater)fail('WATER_NOT_SUPPORTED');
  if(sewer&&!standard.supportsSewer)fail('SEWER_NOT_SUPPORTED');
  if(install&&!standard.supportsInstall)fail('INSTALL_NOT_SUPPORTED');
  if(!water&&!sewer&&!install)fail('WORK_ACTION_REQUIRED');
  for(const [field,enabled] of [['waterPrice',water],['sewerPrice',sewer],['installPrice',install]]){
   if(!enabled&&String(row[field]??'').trim()!=='')fail('ACTION_PRICE_WITHOUT_ACTION');
  }
  const cold=water?standard.waterPoints*qty:0;
  const sewerPoints=sewer?standard.sewerPoints*qty:0;
  const isSystem=Object.hasOwn(READY_ITEMS,cardKey);
  const result=isSystem?calculatePlumbingEstimate({
   cardKey,tariff,quantity:qty,coldWaterPoints:cold,hotWaterPoints:0,
   sewerPoints,install,includeMaterials:input.includeMaterials!==false&&owner?.recipeMode!=='OWNER_OVERRIDE',
   applyFixedReferencePrices:input.applyFixedReferencePrices===true
  }):{lines:[],warnings:[],materialsStatus:'NOT_CONFIGURED'};
  if(!isSystem){
   const fixedPrice=rounded(VBOS_ESTIMATOR_POINT_PRICES_V1.ECONOM.COLD_WATER*MUL[tariff]);
   const makeWork=(description,quantity,unit,action,reference=null)=>{
    const suggestion=reference===null?null:String(reference);
    result.lines.push({kind:'WORK',description,quantity:q3(quantity),unit,
     unitPriceAMD:suggestion!==null&&input.applyFixedReferencePrices===true?suggestion:'',
     suggestedUnitPriceAMD:suggestion,priceMode:suggestion===null?'NOT_CONFIGURED':'FIXED',
     sourceAction:action,note:'Пользовательская карточка; проверь цену работ.'});
   };
   if(water)makeWork('Монтаж воды ('+cold+' точек)',cold,'точка','WATER',fixedPrice);
   if(sewer)makeWork('Монтаж канализации',sewerPoints,'точка','SEWER',
    rounded(VBOS_ESTIMATOR_POINT_PRICES_V1.ECONOM.SEWER*MUL[tariff]));
   if(install)makeWork('Установка · '+name,qty,'шт','FIXTURE_INSTALL');
  }
  if(owner?.recipeMode==='OWNER_OVERRIDE'||!isSystem){
   result.lines=result.lines.filter(line=>line.kind!=='MATERIAL');
   result.materialsStatus=owner?.materials?.length?'READY':'NOT_CONFIGURED';
   if(input.includeMaterials!==false){
    for(const material of owner?.materials||[]){
     const quantity=Number(material.quantity)*qty;
     if(!Number.isFinite(quantity)||quantity<=0||quantity>100000)fail('CUSTOM_MATERIAL_QUANTITY_INVALID');
     result.lines.push({kind:'MATERIAL',description:material.name,quantity:q3(quantity),
      unit:material.unit,unitPriceAMD:'',suggestedUnitPriceAMD:null,
      priceMode:'MATERIAL_PRICE_NOT_VERIFIED',sourceAction:'NODE_CARD_MATERIAL',
      note:'Рецепт владельца; трасса и закупочная цена не включены.'});
    }
    if(!owner?.materials?.length)result.warnings.push('Материалы не настроены для '+name+'.');
   }else result.materialsStatus='NOT_REQUESTED';
  }
  const lines=result.lines.map(line=>{
   const x={...line,description:name+' · '+line.description,cardKey};
   if(water&&line.sourceAction==='WATER'){
    x.description=name+' · Монтаж воды ('+cold+' точек)';
    x.note='Количество точек по выбранной карточке; распределение ХВС/ГВС не установлено.';
   }
   if(x.kind==='WORK'&&['WATER','SEWER','FIXTURE_INSTALL'].includes(x.sourceAction)){
    const originalBase=x.sourceAction==='WATER'?VBOS_ESTIMATOR_POINT_PRICES_V1.ECONOM.COLD_WATER:
     x.sourceAction==='SEWER'?VBOS_ESTIMATOR_POINT_PRICES_V1.ECONOM.SEWER:
     VBOS_ESTIMATOR_TARIFF_PRICE_SOURCE_V1.ECONOM[cardKey]?.amount??null;
    const resolved=resolveEstimatorUnitPrice(pricebook,{actionType:x.sourceAction,cardKey,tariff,
     legacyEconomy:originalBase,legacyPriceMode:x.priceMode});
    x.suggestedUnitPriceAMD=resolved.price;
    x.priceMode=resolved.priceMode;
    if(resolved.configured){
     x.unitPriceAMD=input.applyFixedReferencePrices===true?resolved.price:'';
     x.note='Общий прайс владельца; цена не сохранена в смету без подтверждения.';
    }else{
     // The profile may have changed even without an explicit price rule:
     // never copy the stale fixed-price from the legacy default multiplier.
     x.unitPriceAMD=x.priceMode==='FIXED'&&input.applyFixedReferencePrices===true?
      resolved.price??'':'';
    }
   }
   const localPrice=line.sourceAction==='WATER'?row.waterPrice:
    line.sourceAction==='SEWER'?row.sewerPrice:
    line.sourceAction==='FIXTURE_INSTALL'?row.installPrice:null;
   if(localPrice!==null&&localPrice!==undefined&&String(localPrice).trim()!==''){
    const amount=quoteMoney(localPrice);
    x.unitPriceAMD=amount;x.suggestedUnitPriceAMD=amount;
    x.priceMode='OWNER_ENTERED';x.note='Цена владельца только для этого расчёта.';
   }
   return x;
  });
  flat.push(...lines);
  groups.push({cardKey,displayName:name,quantity:qty,
   materialsStatus:result.materialsStatus,lines});
  for(const msg of result.warnings){
   const w=name+': '+msg;
   if(!warnings.includes(w))warnings.push(w);
  }
 }
 if(input.chasing){
  const r=calculatePlumbingEstimate({
   cardKey:'WC',tariff,quantity:1,
   install:false,chasingMeters:input.chasingMeters,
   includeMaterials:false,applyFixedReferencePrices:false
  });
  const row=r.lines.find(x=>x.sourceAction==='CHASING');
  if(!row)fail('CHASING_RESULT_MISSING');
  const chasing={...row,cardKey:'SPECIAL:CHASING'};
  const suggestedChasing=resolveEstimatorUnitPrice(pricebook,{actionType:'CHASING',tariff,
   legacyEconomy:null,legacyPriceMode:'NOT_CONFIGURED'});
  chasing.suggestedUnitPriceAMD=suggestedChasing.price;
  chasing.priceMode=suggestedChasing.priceMode;
  if(suggestedChasing.configured){
   chasing.unitPriceAMD=input.applyFixedReferencePrices===true?suggestedChasing.price:'';
   chasing.note='Общий прайс владельца · штробление. Подтверди для сметы.';
  }
  if(input.chasingPrice!==null&&input.chasingPrice!==undefined&&String(input.chasingPrice).trim()!==''){
   const amount=quoteMoney(input.chasingPrice);
   chasing.unitPriceAMD=amount;chasing.suggestedUnitPriceAMD=amount;
   chasing.priceMode='OWNER_ENTERED';chasing.note='Цена владельца только для этого расчёта.';
  }
  groups.push({cardKey:'SPECIAL:CHASING',displayName:'Штробление',quantity:1,materialsStatus:'NOT_REQUESTED',lines:[chasing]});
  flat.push(chasing);
 }
 if(input.extraMaterials===true){
  const amount=quoteMoney(input.extraMaterialsAmount);
  if(amount===null)fail('EXTRA_MATERIAL_PRICE_REQUIRED');
  const note=String(input.extraMaterialsNote??'').trim();
  if(note.length>180)fail('EXTRA_MATERIAL_NOTE_TOO_LONG');
  const line={kind:'MATERIAL',description:'Доп. материалы'+(note?' ('+note+')':''),
   quantity:'1.000',unit:'сумма',unitPriceAMD:amount,suggestedUnitPriceAMD:amount,
   priceMode:'OWNER_ENTERED',sourceAction:'EXTRA_MATERIALS',
   note:'Ручная сумма владельца. Не является ценой материалов из карточек.'};
  groups.push({cardKey:'SPECIAL:EXTRA_MATERIALS',displayName:'Доп. материалы',quantity:1,
   materialsStatus:'NOT_REQUESTED',lines:[line]});
  flat.push(line);
 }
 // Preview is read-only: the 50-line limit belongs to canonical estimate_save.
 // Never hide an otherwise valid calculation because its draft transfer is too large.
 const previewLineLimitExceeded=flat.length>50;
 return {source:SOURCE,tariff,cards:selected.length,groups,lines:flat,
  previewLineLimitExceeded,estimateMaxLines:50,
  warnings:[...new Set([...warnings,'Объёмы трасс между приборами и текущие цены материалов не определяются автоматически.',
   ...(previewLineLimitExceeded?['Предпросмотр рассчитан, но для переноса в черновик нужно сократить количество строк до 50.']:[]),
   ...(pricebook?.rules?.length?['Общие цены из PostgreSQL показаны как ориентир; для переноса в смету нужно подтверждение.']:[])])],
  pricingComplete:false,committed:false,sourcePackageSha256:LEGACY_PLUMBING_REFERENCE.packageSha256};
}


export function plumbingStandardForCard(cardKey,catalog=[]){
 const key=String(cardKey||'').trim().toUpperCase();
 const owner=Array.isArray(catalog)?catalog.find(x=>x?.status==='active'&&String(x.cardKey).toUpperCase()===key):null;
 if(owner&&((owner.sourceType==='USER'&&/^USR:[0-9a-f-]{36}$/i.test(key))||
  (owner.sourceType==='SYSTEM'&&Object.hasOwn(READY_ITEMS,key)))){
  return {pointStatus:'FIXED',waterPoints:owner.waterPoints||0,sewerPoints:owner.sewerPoints||0,
   supportsWater:owner.supportsWater===true,supportsSewer:owner.supportsSewer===true,
   supportsInstall:owner.supportsInstall===true};
 }
 if(!Object.hasOwn(READY_ITEMS,key))fail('CARD_NOT_READY');
 const row=VBOS_ESTIMATOR_CARD_STANDARDS_V151[key];
 if(!row)fail('CARD_STANDARD_MISSING');
 return {pointStatus:row.pointStatus,waterPoints:row.waterPoints,
  sewerPoints:row.sewerPoints,supportsWater:row.pointStatus==='FIXED'&&row.waterPoints>0,
  supportsSewer:row.pointStatus==='FIXED'&&row.sewerPoints>0,supportsInstall:true};
}


/**
 * CRM-17D: legacy v1.5.6 compact result projection, READ-ONLY.
 * Historical action prices are indicative even for legacy FROM work.
 * Material recipes carry quantities, never verified acquisition prices.
 * This view never mutates unitPriceAMD or canonical Estimate totals.
 */
export function summarizePlumbingEstimateBatch(result){
 if(!result||!Array.isArray(result.groups)||!Array.isArray(result.lines))
  fail('SUMMARY_RESULT_INVALID');
 const byMaterial=new Map();
 const groups=[];
 let laborReferenceAMD=0,extraMaterialsAMD=0,workWithoutReference=0,fromWorkCount=0;
 for(const group of result.groups){
  let cardReferenceAMD=0,cardMaterialsAMD=0,cardMissing=0,cardFrom=0,cardWork=0;
  for(const line of group.lines||[]){
   const quantity=Number(line.quantity);
   if(!Number.isFinite(quantity)||quantity<=0)fail('SUMMARY_QUANTITY_INVALID');
   if(line.kind==='WORK'){
    cardWork++;
    const price=line.suggestedUnitPriceAMD;
    if(price===null||price===undefined||String(price).trim()===''){
     workWithoutReference++;
     cardMissing++;
    }else{
     const amount=Number(price);
     if(!Number.isSafeInteger(amount)||amount<0)fail('SUMMARY_PRICE_INVALID');
     const subtotal=Math.round(amount*quantity);
     if(!Number.isSafeInteger(subtotal))fail('SUMMARY_TOTAL_INVALID');
     cardReferenceAMD+=subtotal;
     laborReferenceAMD+=subtotal;
     if(line.priceMode==='FROM'){fromWorkCount++;cardFrom++;}
    }
   }else if(line.kind==='MATERIAL'){
    if(line.sourceAction==='EXTRA_MATERIALS'){
     const amount=quoteMoney(line.unitPriceAMD);
     if(amount===null)fail('EXTRA_MATERIAL_PRICE_REQUIRED');
     cardMaterialsAMD+=Number(amount)*quantity;
     extraMaterialsAMD+=Number(amount)*quantity;
    }else{
     const plainName=String(line.description||'').replace(/^.*? · /,'');
     const key=plainName+'|'+line.unit;
     const existing=byMaterial.get(key);
     if(existing)existing.quantity=Math.round((existing.quantity+quantity)*1000)/1000;
     else byMaterial.set(key,{name:plainName,unit:line.unit,quantity:Math.round(quantity*1000)/1000});
    }
   }
  }
  groups.push({cardKey:group.cardKey,name:group.displayName,quantity:group.quantity,
   workLines:cardWork,referenceWorkAMD:cardReferenceAMD,referenceMaterialsAMD:cardMaterialsAMD,
   unpricedWorkLines:cardMissing,fromWorkLines:cardFrom,
   materialsStatus:group.materialsStatus});
 }
 return {
  currency:'AMD',
  laborReferenceAMD,
  extraMaterialsAMD,
  referenceTotalAMD:laborReferenceAMD+extraMaterialsAMD,
  unpricedWorkLines:workWithoutReference,
  fromWorkLines:fromWorkCount,
  hasCurrentVerifiedPricing:false,
  materialPositions:byMaterial.size,
  materials:[...byMaterial.values()],
  groups
 };
}


/**
 * CRM18A: in-quote owner-entered prices only. The legacy PROD source currently has
 * material identities/aliases/card refs but 0 variant/brand/supplier price facts.
 * These helpers must NOT treat the historical reference price as a procurement
 * price, change canonical identities, or persist a global material price list.
 */
function quoteMaterialName(line){
 const raw=String(line.description||'');
 const marker=raw.indexOf(' · ');
 return marker<0?raw:raw.slice(marker+3);
}
const quoteQuantityMilli=value=>{
 const s=String(value??'').trim();
 if(!/^\d{1,6}(?:\.\d{1,3})?$/.test(s))fail('QUOTE_QUANTITY_INVALID');
 const [whole,frac='']=s.split('.');
 const n=BigInt(whole)*1000n+BigInt(frac.padEnd(3,'0')||'0');
 if(n<=0n||n>100000000n)fail('QUOTE_QUANTITY_INVALID');
 return n;
};
function quoteMoney(value){
 if(value===null||value===undefined)return null;
 const s=String(value).trim();
 if(s==='')return null;
 if(!/^(0|[1-9]\d{0,9})$/.test(s)||BigInt(s)>1000000000n)
  fail('QUOTE_OWNER_PRICE_INVALID');
 return s;
}
function quoteScaled(n){
 const whole=n/1000n,frac=(n%1000n).toString().padStart(3,'0');
 return whole.toString()+'.'+frac;
}
export function plumbingQuoteRows(result){
 if(!result||!Array.isArray(result.lines))fail('QUOTE_RESULT_INVALID');
 const work=[],materials=new Map();
 result.lines.forEach((line,index)=>{
  const qty=quoteQuantityMilli(line.quantity);
  if(line.kind==='WORK'){
   work.push({key:'W:'+index,index,name:String(line.description||''),
    unit:String(line.unit||''),quantity:quoteScaled(qty),
    referenceUnitPriceAMD:line.suggestedUnitPriceAMD??null,
    currentUnitPriceAMD:line.unitPriceAMD??'',priceMode:line.priceMode});
  }else if(line.kind==='MATERIAL'){
   const name=quoteMaterialName(line),unit=String(line.unit||'');
   const key='M:'+name+'|'+unit;
   const prev=materials.get(key);
   if(prev)prev.quantityMilli+=qty;
   else materials.set(key,{key,name,unit,quantityMilli:qty,
    currentUnitPriceAMD:line.unitPriceAMD??''});
  }else fail('QUOTE_LINE_KIND_INVALID');
 });
 return {works:work,materials:[...materials.values()].map(x=>({
  key:x.key,name:x.name,unit:x.unit,quantity:quoteScaled(x.quantityMilli),
  currentUnitPriceAMD:x.currentUnitPriceAMD
 }))};
}
export function plumbingApplyQuotePrices(result,rawPrices={}){
 if(!rawPrices||typeof rawPrices!=='object'||Array.isArray(rawPrices))fail('QUOTE_PRICES_INVALID');
 const rows=plumbingQuoteRows(result);
 const validKeys=new Set([...rows.works,...rows.materials].map(x=>x.key));
 for(const key of Object.keys(rawPrices)){
  if(!validKeys.has(key))fail('QUOTE_UNEXPECTED_PRICE_KEY');
 }
 let labor=0n,material=0n,missing=0,pricedCount=0;
 const groupWorks=Array.from(result.groups||[],()=>0n);
 const groupMaterials=Array.from(result.groups||[],()=>0n);
 const groupMissing=Array.from(result.groups||[],()=>0);
 let index=0;
 const pricedGroups=(result.groups||[]).map((group,g)=>{
  const lines=(group.lines||[]).map(line=>{
   const key=line.kind==='WORK'?'W:'+index:'M:'+quoteMaterialName(line)+'|'+line.unit;
   const given=Object.hasOwn(rawPrices,key)?quoteMoney(rawPrices[key]):
    quoteMoney(line.unitPriceAMD);
   const priced={...line,unitPriceAMD:given===null?'':given};
   const milli=quoteQuantityMilli(line.quantity);
   if(given===null){missing++;groupMissing[g]++;}
   else{
    const subtotal=milli*BigInt(given);
    if(line.kind==='WORK'){labor+=subtotal;groupWorks[g]+=subtotal;}
    else {material+=subtotal;groupMaterials[g]+=subtotal;}
    pricedCount++;
   }
   index++;
   return priced;
  });
  return {...group,lines};
 });
 if(index!==result.lines.length)fail('QUOTE_GROUP_LINE_MISMATCH');
 if(pricedCount===0&&missing===0)fail('QUOTE_EMPTY_RESULT');
 return {
  lines:pricedGroups.flatMap(x=>x.lines),
  groups:pricedGroups,
  totals:{
   laborKnownAMD:quoteScaled(labor),
   materialsKnownAMD:quoteScaled(material),
   knownTotalAMD:quoteScaled(labor+material),
   pricedCount,unpricedCount:missing,lineCount:index,
   pricingComplete:index>0&&missing===0
  },
  groupWorkKnownAMD:groupWorks.map(quoteScaled),
  groupMaterialKnownAMD:groupMaterials.map(quoteScaled),
  groupUnpricedCount:groupMissing,
  ownerQuoteOnly:true,
  catalogPriceFactsAvailable:false
 };
}
