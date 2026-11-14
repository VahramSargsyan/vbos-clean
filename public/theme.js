// Client-only appearance choice. No database request and no credentials stored.
(function () {
 'use strict';
 const KEY='vbos_theme';
 const root=document.documentElement;
 const media=typeof window.matchMedia==='function'
   ?window.matchMedia('(prefers-color-scheme: dark)'):null;
 function stored(){
  try {
   const value=window.localStorage.getItem(KEY);
   return value==='dark'||value==='light'?value:null;
  }catch{return null;}
 }
 function preferred(){return stored()||(media&&media.matches?'dark':'light');}
 function apply(theme){
  const dark=theme==='dark';
  root.dataset.theme=dark?'dark':'light';
  root.style.colorScheme=dark?'dark':'light';
  const themeMeta=document.querySelector('meta[name="theme-color"]');
  if(themeMeta)themeMeta.setAttribute('content',dark?'#0B0D0F':'#F6F4EF');
  const control=document.getElementById('themeToggle');
  if(control){
   control.textContent=dark?'☀ Светлая тема':'☾ Тёмная тема';
   control.setAttribute('aria-pressed',String(dark));
   control.setAttribute('aria-label',dark?'Включить светлую тему':'Включить тёмную тему');
  }
 }
 function set(theme){
  try{window.localStorage.setItem(KEY,theme);}catch{}
  apply(theme);
 }
 function attach(){
  const toggle=document.getElementById('themeToggle');
  if(toggle)toggle.addEventListener('click',()=>set(root.dataset.theme==='dark'?'light':'dark'));
  apply(preferred());
 }
 apply(preferred());
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',attach,{once:true});
 else attach();
 if(media){
  const changed=()=>{if(!stored())apply(preferred());};
  if(typeof media.addEventListener==='function')media.addEventListener('change',changed);
  else if(typeof media.addListener==='function')media.addListener(changed);
 }
})();
