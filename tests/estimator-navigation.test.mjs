import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {
 listPlumbingItems,plumbingStandardForCard,calculatePlumbingEstimate,
 calculatePlumbingEstimateBatch,summarizePlumbingEstimateBatch,plumbingQuoteRows
} from '../public/estimate-plumbing.mjs';

const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
const legacy=readFileSync(new URL('./fixtures/legacy/EstimatorUi_v1_5_0.snippets.txt',import.meta.url),'utf8');
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const moduleRef={listPlumbingItems,plumbingStandardForCard,calculatePlumbingEstimate,
 calculatePlumbingEstimateBatch,summarizePlumbingEstimateBatch,plumbingQuoteRows};
const lead={id:'00000000-0000-4000-8000-000000000001',title:'Объект: сантехника',status:'qualified'};
const picker={leads:[lead]};
function extract(first,last){
 const a=app.indexOf(first),b=app.indexOf(last,a+first.length);
 assert.ok(a>=0&&b>a,'missing '+first+' -> '+last);
 return app.slice(a,b);
}
function renderEstimator(subtab='calculator',state={}){
 const script=extract('function estimatorView(){','function estimateAMD(x){');
 const context={estimatorSubtab:subtab,data:picker,estimateUI:{leadId:null},plumbingUI:{module:moduleRef},
  plumbingWorkspace:l=>'<section data-bound-lead="'+esc(l.id)+'"></section>',
  plumbingWizardMarkup:()=>'<section data-plumbing-wizard>Мастер</section>',
  estimateAMD:x=>String(x)+' AMD',esc,label:{qualified:'В работе'},estimatorBridgeMarkup:()=>'',...state};
 return runInNewContext(script+';estimatorView()',context);
}
function resultPreview(bound){
 const wizard=extract('function plumbingWizardMarkup(){','function plumbingCaptureSelection(){');
 const preview=calculatePlumbingEstimateBatch({tariff:'STANDARD_PLUS',
  cards:[{cardKey:'WC',quantity:1,water:true,sewer:true,install:true,waterPrice:'1700',sewerPrice:'600',installPrice:'8000'}],
  extraMaterials:true,extraMaterialsAmount:'2500',extraMaterialsNote:'крепёж',
  includeMaterials:false,applyFixedReferencePrices:false});
 const context={plumbingUI:{module:moduleRef},plumbingWizard:{step:3,preview,pricedResult:null,quotePrices:{}},
  estimateUI:{result:bound?{estimate:{status:'draft'}}:null,editor:bound?{lines:[]}:null},
  estimateAMD:x=>String(x)+' AMD',esc,plumbingPriceEditorMarkup:()=>'<div>editor</div>'};
 return runInNewContext(wizard+';plumbingWizardMarkup()',context);
}

test('legacy estimator tabs remain accessible under grouped Tools navigation',()=>{
 for(const item of ['data-tab="calculator"','data-tab="prices"','data-tab="cards"'])
  assert.ok(legacy.includes(item),item);
 const menu=html.indexOf('<button data-tab="estimator">Калькуляция</button>');
 assert.ok(menu>0);
 assert.ok(menu>html.indexOf('data-tab="crm"'));
 assert.ok(menu>html.indexOf('<div class="nav-section-label">'));
 assert.ok(menu>html.indexOf('Инструменты'));
 assert.equal((html.match(/data-tab="estimator"/g)||[]).length,1);
 assert.match(app,/tab==='estimator'\?estimatorView\(\)/);
 assert.match(app,/if\(tab==='estimator'\)\{estimatorSubtab='calculator';void ensurePlumbingCalculator\(\);/);
 assert.match(app,/tab==='estimator'\)render\(\)/);
});

test('standalone first screen works without preexisting Lead Estimate and explains saving',()=>{
 const out=renderEstimator();
 for(const text of ['Калькуляция','Расчёт','Цены','Карточки','data-estimator-bind',
  'data-estimator-create-lead','estimatorLeadId','data-plumbing-wizard'])
  assert.ok(out.includes(text),text);
 assert.ok(out.includes('рассчитать сразу'));
 assert.ok(out.includes('Объект: сантехника'));
 assert.ok(!out.includes('data-bound-lead'));
});

test('historical Prices panel renders source-backed prices, without claiming global mutation',()=>{
 const out=renderEstimator('prices');
 assert.match(out,/Цены и тарифы/);
 assert.match(out,/Economy/);
 assert.match(out,/Standard\+/);
 assert.match(out,/VIP/);
 assert.match(out,/30.08.2026/);
 assert.match(out,/нет сохранения глобальных цен/);
 assert.ok(out.includes('Унитаз'));
 assert.ok(out.includes('от'));
 assert.ok(out.includes('<table>'));
});

test('system Cards panel shows known item counts and a route back to calculate',()=>{
 const out=renderEstimator('cards');
 assert.match(out,/Карточки приборов/);
 assert.ok(out.includes('data-estimator-use-card="WC"'));
 assert.equal((out.match(/data-estimator-use-card=/g)||[]).length,listPlumbingItems().length);
 assert.match(out,/Системные карточки старого Estimator/);
});

test('Lead bound screen uses old 3-stage wizard and create/save existing PostgreSQL draft',()=>{
 const bound=renderEstimator('calculator',{estimateUI:{leadId:lead.id}});
 assert.ok(bound.includes('data-bound-lead="'+lead.id+'"'));
 const source=extract('function plumbingWorkspace(lead){','// EST-PARITY-NAV:');
 const state={tab:'estimator',estimateUI:{loaded:true,result:{estimate:null}},
  plumbingDraftPanelOpen:false,plumbingWizardMarkup:()=>'<section data-plumbing-wizard>Мастер</section>',
  estimateView:()=>'<form data-act="estimate_create"></form>',esc};
 const view=runInNewContext(source+';plumbingWorkspace('+JSON.stringify(lead)+')',state);
 assert.match(view,/data-plumbing-wizard/);
 assert.match(view,/data-act="estimate_create"/);
 assert.match(view,/К выбору лида/);
 state.estimateUI={loaded:true,result:{estimate:{status:'draft'}}};
 state.estimateView=()=>'<form data-act="estimate_save"></form>';
 const draft=runInNewContext(source+';plumbingWorkspace('+JSON.stringify(lead)+')',state);
 assert.match(draft,/data-plumbing-wizard/);
 assert.match(draft,/data-act="estimate_save"/);
 state.estimateUI={loaded:true,result:{estimate:{status:'accepted'}}};
 const accepted=runInNewContext(source+';plumbingWorkspace('+JSON.stringify(lead)+')',state);
 assert.doesNotMatch(accepted,/data-plumbing-wizard/);
});

test('preview cannot be transferred without an owner-bound draft; can transfer after draft exists',()=>{
 const free=resultPreview(false);
 assert.match(free,/data-pw-add disabled aria-disabled="true"/);
 assert.match(free,/Чтобы сохранить его, выбери лид и создай черновик/);
 assert.match(free,/Доп. материалы/);
 const bound=resultPreview(true);
 assert.match(bound,/data-pw-add>/);
 assert.doesNotMatch(bound,/data-pw-add disabled/);
 assert.match(app,/editor\.lines\.length\+verified\.lines\.length>50/);
 assert.match(app,/estimate\.status!=='draft'/);
});

test('quote prices survive tab navigation; owner save/refresh/reopen stays on canonical API',()=>{
 const source=extract('function estimatorSaveVisibleWizard(){','function estimatorView(){');
 const rows={works:[{key:'W:0'}],materials:[{key:'M:труба|м'}]};
 const wizard={step:3,preview:{lines:[]},quotePrices:{},pricedResult:{previous:true}};
 const form={elements:{namedItem:n=>({value:n==='pwWorkPrice_0'?'1200':'800'})}};
 let saved=0;
 runInNewContext(source+';estimatorSaveVisibleWizard()',{
  plumbingWizard:wizard,plumbingUI:{module:{plumbingQuoteRows:()=>rows}},
  $:name=>name==='#pwPriceEditor'?form:null,
  estimateCaptureForm:()=>{saved++;},
 });
 assert.equal(wizard.quotePrices['W:0'],'1200');
 assert.equal(wizard.quotePrices['M:труба|м'],'800');
 assert.equal(wizard.pricedResult,null);
 assert.equal(saved,1);
 assert.match(app,/if\(\(tab==='crm'\|\|tab==='estimator'\)&&\['estimate_create','estimate_save','estimate_accept_handoff'\]/);
 assert.match(app,/await loadLeadEstimate\(\)/);
 assert.match(app,/\/api\/estimates\?leadId=/);
 assert.match(app,/data-act="estimate_save"/);
});

test('mobile UX has large touch targets and retained lead picker, no schema/API change',()=>{
 assert.match(css,/\.estimator-legacy-tabs button\{min-height:48px/);
 assert.match(css,/\.estimator-lead-chooser button\{min-height:48px/);
 assert.match(css,/@media\(max-width:520px\)\{\.estimator-legacy-tabs/);
 assert.match(html,/class="drawer-nav"/);
 assert.match(app,/data-estimator-back|data-estimate-back/);
 assert.match(app,/data-act="estimate_create"/);
 assert.match(app,/data-act="estimate_save"/);
});

test('service bridge opens visibly inside the chosen card, not after the grid',()=>{
 const source=extract('var estimatorBridgePanel=null;','async function submitEstimatorBridge');
 const view=extract('function estimatorView(){','function estimateAMD(x){');
 const context={estimatorSubtab:'cards',tab:'estimator',data:picker,estimateUI:{leadId:null},
  plumbingUI:{module:moduleRef},esc,estimatorCardState:{loaded:true,items:listPlumbingItems().map(x=>({...x,sourceType:'SYSTEM',status:'active'})),editor:null}};
 const out=runInNewContext(source+view+`;estimatorBridgePanel={cardKey:"BATH",result:{writeEnabled:false,items:[{action_type:"FIXTURE_INSTALL",service_id:"SRV-2026-0013"},{action_type:"WATER",service_id:"SRV-2026-0024"},{action_type:"SEWER",service_id:"SRV-2026-0025"}],candidates:[]}};estimatorView()`,context);
 const selected=out.indexOf('data-estimator-bridge-open="BATH" aria-expanded="true"');
 const panel=out.indexOf('id="estimatorBridgePanel"');
 assert.ok(selected>=0&&panel>selected&&panel<out.indexOf('</article>',selected));
 assert.equal((out.match(/id="estimatorBridgePanel"/g)||[]).length,1);
 assert.match(out,/data-estimator-bridge-open="WC" aria-expanded="false"/);
 for(const id of ['SRV-2026-0013','SRV-2026-0024','SRV-2026-0025'])assert.ok(out.includes(id));
 assert.doesNotMatch(out,/data-est-bridge-save=|data-est-bridge-archive=/);
});
test('bridge open shows loading immediately, handles errors and restores trigger focus on close',async()=>{
 const source=extract('var estimatorBridgePanel=null;','async function submitEstimatorBridge');
 let html='',focused=0,scrolled=0,triggerFocused=0,triggerScrolled=0,resolve,reject;
 const heading={focus:()=>{focused++;document.activeElement=heading;}};
 const document={activeElement:null};
 const root={querySelector:()=>heading,contains:x=>x===heading,scrollIntoView:()=>scrolled++};
 const trigger={dataset:{estimatorBridgeOpen:'BATH'},focus:()=>triggerFocused++,scrollIntoView:()=>triggerScrolled++};
 const context={tab:'estimator',estimatorSubtab:'cards',esc,document,
  $:selector=>selector==='#estimatorBridgePanel'?root:selector==='#content'?{querySelectorAll:()=>[trigger]}:null,
  render:()=>{html=controller.markup('BATH')},api:path=>{assert.equal(path,'/api/estimator/service-bridges?cardKey=BATH');return new Promise((yes,no)=>{resolve=yes;reject=no;});}};
 const controller=runInNewContext(source+';({open:openEstimatorBridges,close:closeEstimatorBridges,markup:estimatorBridgeMarkup})',context);
 const pending=controller.open('BATH');
 assert.match(html,/role="status">Загружаю/);assert.equal(focused,1);assert.equal(scrolled,1);
 resolve({writeEnabled:false,items:[],candidates:[]});await pending;
 assert.match(html,/Связи доступны для чтения/);assert.equal(focused,2);
 assert.equal(controller.markup('WC'),'');
 controller.close();assert.equal(html,'');assert.equal(triggerFocused,1);assert.equal(triggerScrolled,1);
 const failed=controller.open('BATH');reject(Error('test API error'));await failed;
 assert.match(html,/role="alert">test API error/);
 const stale=controller.open('BATH');controller.close();resolve({writeEnabled:false,items:[],candidates:[]});await stale;
 assert.equal(html,'');
});
