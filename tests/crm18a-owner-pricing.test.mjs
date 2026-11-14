import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {
 calculatePlumbingEstimateBatch,plumbingQuoteRows,plumbingApplyQuotePrices,
 summarizePlumbingEstimateBatch
} from '../public/estimate-plumbing.mjs';

const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const demo=()=>calculatePlumbingEstimateBatch({
 tariff:'STANDARD_PLUS',cards:[
  {cardKey:'WC',quantity:2,water:true,sewer:true,install:true},
  {cardKey:'WASH',quantity:1,water:true,sewer:true,install:true}
 ],includeMaterials:true,applyFixedReferencePrices:false
});
const scaled=x=>{
 const [whole,frac='']=String(x).split('.');
 return BigInt(whole)*1000n+BigInt(frac.padEnd(3,'0')||'0');
};
const moneyScaled=x=>(x/1000n).toString()+'.'+(x%1000n).toString().padStart(3,'0');

test('read-only material identity is name+unit and repeats are aggregated without inventing brand/supplier',()=>{
 const src=demo(),rows=plumbingQuoteRows(src);
 assert.ok(rows.works.length>=6);
 const materialRows=src.lines.filter(x=>x.kind==='MATERIAL');
 assert.ok(rows.materials.length<materialRows.length,'two cards share recipe materials');
 const count=rows.materials.find(x=>x.name==='Тройник Ø20-20-20');
 assert.ok(count&&count.key.startsWith('M:'));
 assert.equal(count.quantity,'4.000');
 assert.ok(rows.works.every(x=>x.currentUnitPriceAMD===''));
 assert.equal(summarizePlumbingEstimateBatch(src).hasCurrentVerifiedPricing,false);
});
test('owner can price all actions and all shared materials once; exact 3-decimal AMD totals and source unchanged',()=>{
 const src=demo(),snap=JSON.stringify(src),rows=plumbingQuoteRows(src);
 const price={};
 rows.works.forEach((r,i)=>{price[r.key]=String(1000+i*250);});
 rows.materials.forEach((r,i)=>{price[r.key]=String(400+i*10);});
 const out=plumbingApplyQuotePrices(src,price);
 assert.equal(out.totals.pricingComplete,true);
 assert.equal(out.totals.unpricedCount,0);
 assert.equal(out.totals.pricedCount,src.lines.length);
 assert.equal(out.groups.length,src.groups.length);
 assert.equal(JSON.stringify(src),snap,'no mutation of legacy quote preview');
 assert.ok(out.lines.every(x=>/^\d+$/.test(x.unitPriceAMD)));
 let labor=0n,material=0n;
 for(const [i,r] of src.lines.entries()){
  const k=r.kind==='WORK'?'W:'+i:
   'M:'+r.description.slice(r.description.indexOf(' · ')+3)+'|'+r.unit;
  const sum=scaled(r.quantity)*BigInt(price[k]);
  if(r.kind==='WORK')labor+=sum;else material+=sum;
 }
 assert.equal(out.totals.laborKnownAMD,moneyScaled(labor));
 assert.equal(out.totals.materialsKnownAMD,moneyScaled(material));
 assert.equal(out.totals.knownTotalAMD,moneyScaled(labor+material));
 assert.equal(out.ownerQuoteOnly,true);
 assert.equal(out.catalogPriceFactsAvailable,false);
});
test('material quantity 0.500 and unit price 1001 produce 500.500 AMD, no monetary rounding loss',()=>{
 const r=calculatePlumbingEstimateBatch({tariff:'ECONOM',cards:[
  {cardKey:'WC',quantity:1,water:false,sewer:false,install:true}
 ],includeMaterials:true,applyFixedReferencePrices:false});
 const mat=r.lines.find(x=>x.kind==='MATERIAL'&&x.quantity==='0.500');
 assert.ok(mat);
 const key='M:'+mat.description.slice(mat.description.indexOf(' · ')+3)+'|'+mat.unit;
 const out=plumbingApplyQuotePrices(r,{[key]:'1001'});
 assert.equal(out.lines.find(x=>x.description===mat.description).unitPriceAMD,'1001');
 assert.equal(out.totals.materialsKnownAMD,'500.500');
 assert.equal(out.totals.pricingComplete,false);
 assert.ok(out.totals.unpricedCount>0);
});
test('legacy FROM installation price stays unpriced until explicit owner price; missing != zero',()=>{
 const src=demo(),wc=src.lines.find(x=>x.sourceAction==='FIXTURE_INSTALL'&&x.cardKey==='WC');
 assert.equal(wc.priceMode,'FROM');
 assert.equal(wc.unitPriceAMD,'');
 const init=plumbingApplyQuotePrices(src,{});
 assert.equal(init.totals.materialsKnownAMD,'0.000');
 assert.equal(init.totals.laborKnownAMD,'0.000');
 assert.ok(init.totals.unpricedCount>0);
 const x=plumbingQuoteRows(src).works.find(r=>r.name===wc.description);
 const zero=plumbingApplyQuotePrices(src,{[x.key]:'0'});
 assert.equal(zero.lines[x.index].unitPriceAMD,'0');
 assert.equal(zero.totals.pricedCount,1);
 assert.equal(zero.totals.pricingComplete,false);
});
test('invalid/suspicious unit price and foreign quote key fail closed without changing source',()=>{
 const src=demo(),before=JSON.stringify(src),key=plumbingQuoteRows(src).materials[0].key;
 for(const invalid of ['-1','1.25',' 1 000 ','1000000001','1e3','NaN','abc']){
  assert.throws(()=>plumbingApplyQuotePrices(src,{[key]:invalid}),/QUOTE_OWNER_PRICE_INVALID/);
 }
 assert.throws(()=>plumbingApplyQuotePrices(src,{'M:unknown|шт':'1'}),/QUOTE_UNEXPECTED_PRICE_KEY/);
 assert.throws(()=>plumbingApplyQuotePrices(src,[]),/QUOTE_PRICES_INVALID/);
 assert.equal(JSON.stringify(src),before);
});
test('actual price editor markup stays inside collapsed summary, no automatic source-price writes',()=>{
 const start=ui.indexOf('function plumbingPriceEditorMarkup(result){');
 const end=ui.indexOf('function plumbingCaptureQuotePrices(){',start);
 assert.ok(start>=0&&end>start);
 const result=demo(),mod={plumbingQuoteRows,plumbingApplyQuotePrices};
 const html=runInNewContext(ui.slice(start,end)+'\nplumbingPriceEditorMarkup(result);',{
  result,plumbingWizard:{quotePrices:{},pricedResult:null},
  plumbingUI:{module:mod},esc:escape,estimateAMD:x=>String(x)+' AMD'
 });
 assert.match(html,/details class="plumbing-price-editor"/);
 assert.doesNotMatch(html,/plumbing-price-editor" open/);
 assert.match(html,/Цена материала, AMD\/ед./);
 assert.match(html,/Цена работы, AMD\/ед./);
 assert.match(html,/Пересчитать по моим ценам/);
 assert.match(html,/Фактические закупочные цены отсутствуют/);
 assert.match(css,/\.plumbing-price-editor>summary/);
});
test('price capture applies only owner quote inputs; result transfer uses verified lines and existing guarded Save',()=>{
 const start=ui.indexOf('function plumbingCaptureQuotePrices(){');
 const end=ui.indexOf('function plumbingPriceError(error){',start);
 assert.ok(start>=0&&end>start);
 const src=demo(),rows=plumbingQuoteRows(src),fields=new Map();
 rows.works.forEach((r,i)=>fields.set('pwWorkPrice_'+i,{value:String(3000+i)}));
 rows.materials.forEach((r,i)=>fields.set('pwMaterialPrice_'+i,{value:String(150+i)}));
 const ctx={
  $:selector=>selector==='#pwPriceEditor'?{elements:{namedItem:key=>fields.get(key)||null}}:null,
  plumbingUI:{module:{plumbingQuoteRows,plumbingApplyQuotePrices}},
  plumbingWizard:{preview:src,quotePrices:{},pricedResult:null}
 };
 const priced=runInNewContext(ui.slice(start,end)+'\nplumbingCaptureQuotePrices();',ctx);
 assert.equal(priced.totals.pricingComplete,true);
 assert.ok(ctx.plumbingWizard.pricedResult?.ownerQuoteOnly);
 assert.match(ui,/const verified=plumbingCaptureQuotePrices\(\);/);
 assert.match(ui,/editor\.lines\.push\(\.\.\.verified\.lines\.map/);
 assert.match(ui,/estimateCaptureForm\(\)/);
 assert.match(ui,/estimate_save/);
 assert.doesNotMatch(ui.slice(start,end),/fetch\(|sendAction\(|pool\.query\(/);
});
