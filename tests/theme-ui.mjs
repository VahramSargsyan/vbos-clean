import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const html=read('public/index.html');
const css=read('public/style.css');
const src=read('public/theme.js');

const header=html.match(/<header\b[^>]*>[\s\S]*?<\/header>/)?.[0];
assert.ok(header);
assert.ok(header.indexOf('id="menuToggle"')<header.indexOf('class="brand"'),'Menu must be on the left');
assert.ok(!header.includes('id="logout"'),'Logout must not be in the header');
assert.ok(!header.includes('id="installApp"'),'Install should not crowd mobile header');
const nav=html.match(/<nav id="tabs"[\s\S]*?<\/nav>/)?.[0];
assert.ok(nav && nav.includes('class="drawer-links"') && nav.includes('class="drawer-footer"'));
const footer=nav.match(/<div class="drawer-footer">([\s\S]*?)<\/div>/)?.[1];
assert.ok(header.includes('id="themeToggle"'),'Theme control belongs in the header');
assert.ok(header.indexOf('id="menuToggle"')<header.indexOf('id="themeToggle"') && header.indexOf('id="themeToggle"')<header.indexOf('class="brand"'));
assert.ok(footer && !footer.includes('id="themeToggle"') && footer.includes('id="logout"'));
assert.equal((html.match(/id="themeToggle"/g)||[]).length,1);
assert.equal(footer.match(/id="logout"/g)?.length,1);
assert.equal((html.match(/id="logout"/g)||[]).length,1);
assert.equal((nav.match(/data-tab="/g)||[]).length,18);
assert.ok(nav.includes('data-tab="finance"'),'Finance archive must be visible in original Clean menu');
assert.ok(nav.includes('data-tab="capital"'),'Capital fund archive must be visible in original Clean menu');
assert.ok(nav.indexOf('data-tab="finance"')<nav.indexOf('data-tab="capital"'),'Finance should precede Capital');
assert.ok(nav.includes('data-tab="serviceReference"'),'Legacy source-only Services catalog must be independently visible');
assert.ok(nav.indexOf('data-tab="orders"')<nav.indexOf('data-tab="serviceReference"'),'Reference list appears after Orders without replacing Search');
assert.ok(nav.includes('data-tab="history"'),'Existing WorkLog history menu entry must stay available');
assert.ok(nav.includes('data-tab="historyOrders"'),'Source-gated old WorkOrder history must have a separate entry');
assert.ok(nav.includes('data-tab="engineering"'),'Read-only Engineering preview belongs in menu');
assert.ok(nav.includes('data-tab="schedule"'),'Plan belongs in hidden menu');
assert.ok(!nav.includes('data-tab="capacity"'),'Capacity must appear in Plan, never as separate menu route');
assert.ok(read('public/schedule.js').includes('s+=capacityPanelView();'),'Capacity finder must render within Calendar');
assert.ok(nav.indexOf('data-tab="crm"')<nav.indexOf('data-tab="clients"') && nav.indexOf('data-tab="clients"')<nav.indexOf('data-tab="objects"'),"Clients must have a separate menu entry after CRM");
assert.ok(css.includes('min-height:0;overflow-y:auto'),'Drawer links must scroll separately');
assert.ok(css.includes('margin-top:auto;flex:0 0 auto'),'Drawer footer must stay at bottom');
assert.ok(css.includes('html[data-theme] .card'),'Both themes must cover cards through shared tokens');
assert.ok(css.includes('html[data-theme] input'),'Both themes must cover inputs through shared tokens');
// Capacity remains inside Plan; SOP and Orders are quick links; Search and Estimator remain reachable (18 routes).
const linksArea=nav.match(/<div class="drawer-links">([\s\S]*?)<div class="drawer-footer">/)?.[1];
assert.ok(linksArea && html.includes('href="/menu-groups.css"'));
const quickArea=linksArea.split('<details')[0];
assert.deepEqual([...quickArea.matchAll(/data-tab="([^"]+)"/g)].map(x=>x[1]),['today','myWork','knowledge','schedule','crm','orders']);
const groups=[...linksArea.matchAll(/<details class="nav-group" name="vbos-nav-group">\s*<summary><span class="nav-group-label">([^<]+)<\/span><span class="nav-chevron" aria-hidden="true">▼<\/span><\/summary>\s*<div class="nav-submenu">([\s\S]*?)<\/div>\s*<\/details>/g)];
assert.deepEqual(groups.map(x=>x[1]),['Клиенты и продажи','Исполнение и история','Финансы и отчёты','Инструменты']);
const groupIds=[['clients','objects','catalog'],['workers','history','historyOrders'],['finance','capital','report'],['estimator','engineering','serviceReference']];
for(let i=0;i<groups.length;i++){
  assert.deepEqual([...groups[i][2].matchAll(/data-tab="([^"]+)"/g)].map(x=>x[1]),groupIds[i]);
}
const routeIds=[...linksArea.matchAll(/data-tab="([^"]+)"/g)].map(x=>x[1]);
assert.equal(new Set(routeIds).size,18,'Exactly one navigation target per route, including SOP and Estimator');
assert.equal(routeIds.filter(x=>x==='estimator').length,1,'Calculator must remain reachable in Tools');
assert.equal(routeIds.filter(x=>x==='catalog').length,1,'Search must remain reachable in Clients and Sales');
assert.equal(quickArea.match(/data-tab="orders"/g)?.length,1,'Orders must be a quick destination');
assert.equal(quickArea.match(/data-tab="knowledge"/g)?.length,1,'Legacy SOP must be a unique quick destination');
assert.ok(css.includes('min-height:0;overflow-y:auto'),'Existing scrollable drawer preserved');
const navCss=read('public/menu-groups.css');
const serverSource=read('server.mjs');
assert.match(serverSource,
 /'\/menu-groups\.css': \['text\/css; charset=utf-8',readFileSync\(new URL\('\.\/public\/menu-groups\.css',import\.meta\.url\)\)\]/,
 'Menu CSS must be served by the explicit Node static manifest (regression for missing styles)');
assert.match(navCss,/\.app-header #themeToggle/, 'Theme button must be styled outside the drawer');
assert.match(navCss,/max-width:650px/, 'Theme icon must fit narrow mobile header');
assert.match(navCss,/display:flex;flex-direction:column;flex-wrap:nowrap;align-items:stretch/,
 'All submenu items must stack vertically with full-width tap targets');
assert.ok(navCss.includes('.nav-submenu>button[data-tab].active'),'Nested active state must remain visible');
assert.ok(navCss.includes(':focus-visible'),'Keyboard focus must be visible');
assert.ok(navCss.includes('var(--accent-soft)'),'Highlight must follow theme tokens');
assert.equal(quickArea.match(/data-tab="crm"/g)?.length,1,'CRM must appear in quick menu');
assert.equal(quickArea.match(/data-tab="estimator"/g)?.length||0,0,'Estimator moves into Tools');
assert.ok(!groups.some(g=>g[2].includes('data-tab="crm"')),'CRM must not be duplicated');
assert.equal((linksArea.match(/class="nav-chevron" aria-hidden="true">▼/g)||[]).length,4,
 'Each group needs an explicit chevron in Android HTML');
assert.match(navCss,/color:var\(--ink\);font-size:19px;font-weight:650;line-height:1\.35;/,
 'Group headings calibrated to 19px from Android visual feedback');
assert.match(navCss,/font-size:19px;line-height:1\.35;min-height:48px;/,
 'Quick links calibrated to 19px with touch size preserved');
assert.match(navCss,/background:transparent;color:var\(--body\);font-size:18px;line-height:1\.4;/,
 'Nested links calibrated to 18px and remain in one column');
assert.match(navCss,/color:var\(--mute\);font-size:14px;font-weight:700;/,
 'Section title calibrated to 14px');
assert.ok(navCss.includes('font-size:20px') && navCss.includes('[open]>summary .nav-chevron'),
 'Chevrons must be clearly visible and change direction');
console.log('NAVIGATION_UX_COMPACT_ORDERS_AND_THEME_HEADER_PASS');

console.log('MOBILE_MENU_LEFT_BRAND_RIGHT_AND_FIXED_LOGOUT_PASS');

function createHarness(initial=null,systemDark=false) {
 const store=new Map(initial?[['vbos_theme',initial]]:[]);
 const control={
  textContent:'',attrs:{},click:null,
  addEventListener(name,cb){if(name==='click')this.click=cb;},
  setAttribute(k,v){this.attrs[k]=v;}
 };
 const meta={attrs:{},setAttribute(k,v){this.attrs[k]=v;}};
 const root={dataset:{},style:{}};
 let mediaHandler=null;
 const document={
  documentElement:root,readyState:'complete',
  querySelector(s){return s==='meta[name="theme-color"]'?meta:null;},
  getElementById(s){return s==='themeToggle'?control:null;}
 };
 const window={
  matchMedia(){return {matches:systemDark,addEventListener(n,cb){if(n==='change')mediaHandler=cb;}};},
  localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)}
 };
 vm.runInNewContext(src,{window,document});
 return {store,control,meta,root,mediaHandler};
}
const state=createHarness();
assert.equal(state.root.dataset.theme,'light');
assert.equal(state.control.attrs['aria-pressed'],'false');
assert.match(state.control.textContent,/Тёмная тема/);
state.control.click();
assert.equal(state.root.dataset.theme,'dark');
assert.equal(state.control.attrs['aria-pressed'],'true');
assert.equal(state.store.get('vbos_theme'),'dark');
assert.equal(state.meta.attrs.content,'#0B0D0F');
assert.match(state.control.textContent,/Светлая тема/);
const reload=createHarness(state.store.get('vbos_theme'));
assert.equal(reload.root.dataset.theme,'dark');
reload.control.click();
assert.equal(reload.root.dataset.theme,'light');
assert.equal(reload.store.get('vbos_theme'),'light');
const system=createHarness(null,true);
assert.equal(system.root.dataset.theme,'dark');
assert.equal(system.store.size,0);
console.log('THEME_PERSISTENCE_RELOAD_TOGGLE_SYSTEM_DEFAULT_AND_ARIA_PASS');


// UI v2 design contract — source tokens and anchored mobile navigation.
const expectedDark=['#0B0D0F','#111418','#171B20','#1D2228','#242A31','#F4F1E8','#C4BFB5','#D2B06A','#2B323A'];
for(const token of expectedDark)assert.ok(css.includes(token),'Missing graphite/brass token: '+token);
for(const token of ['--canvas:','--hairline:','--accent-soft:','--on-accent:','--success:','--danger:','--info:'])assert.ok(css.includes(token),'Token missing '+token);
assert.match(css,/html\[data-theme="dark"\]/);
assert.match(css,/@media\(max-width:768px\)/);
assert.match(css,/@media\(max-width:550px\)/);
assert.match(css,/@media\(max-width:380px\)/);
assert.match(css,/prefers-reduced-motion:reduce/);
assert.match(css,/overflow-x:clip/);
assert.match(css,/overflow-wrap:anywhere/);
assert.match(css,/focus-visible/);
assert.match(css,/\.compact\{min-height:44px\}/);
assert.match(css,/\.drawer-footer\{background:var\(--s1\)/);
assert.match(html,/Business Operating System/);
assert.match(html,/VBOS · UI v2/);
assert.doesNotMatch(css,/linear-gradient\(|radial-gradient\(/);
const contrast=(a,b)=>{const lum=h=>{const v=h.replace('#','').match(/../g).map(c=>parseInt(c,16)/255).map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4));return .2126*v[0]+.7152*v[1]+.0722*v[2];};const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
assert.ok(contrast('#F4F1E8','#0B0D0F')>=7);
assert.ok(contrast('#C4BFB5','#111418')>=7);
assert.ok(contrast('#24282B','#F6F4EF')>=7);
assert.ok(contrast('#D2B06A','#151719')>=7);
console.log('VBOS_GRAPHITE_PEARL_BRASS_UI_V2_TOKENS_RESPONSIVE_CONTRAST_PASS');
