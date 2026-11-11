// No-network tests for the independent appearance setting. No billing/auth/AI access.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const script=readFileSync('public/themes.js','utf8');
const html=readFileSync('public/index.html','utf8');
const css=readFileSync('public/themes.css','utf8');

assert.match(html, /id="theme-picker"/);
assert.match(html, /id="theme-current"/);
assert.match(html, /id="theme-save-status"/);
assert.ok(html.indexOf('/themes.js')<html.indexOf('/styles.css'),'Theme preference must load before CSS');
assert.ok(html.indexOf('/themes.css')>html.indexOf('/styles.css'),'Theme overrides must load after base styles');

class Node {
  constructor(tag='div'){
    this.tag=tag;this.children=[];this.attrs={};this.textContent='';this.style={properties:{}};
    this.style.setProperty=(key,val)=>{this.style.properties[key]=val;};
    this.events={};
  }
  setAttribute(name,value){this.attrs[name]=String(value);}
  getAttribute(name){return this.attrs[name]??null;}
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=items.flatMap(x=>x.tag==='fragment'?x.children:[x]);}
  addEventListener(name,callback){this.events[name]=callback;}
  querySelector(selector){
    if(selector==='.theme-check') return this.children.flatMap(x=>x.children).find(x=>x.className==='theme-check')||null;
    return null;
  }
  querySelectorAll(selector){
    return selector==='[data-theme-choice]'?this.children.filter(c=>c.getAttribute('data-theme-choice')):[];
  }
  click(){this.events.click?.();}
}
function setup(initial,storageAvailable=true){
  const state=new Map(initial?[['studybuddy-theme-v1',initial]]:[]);
  const picker=new Node(),current=new Node(),status=new Node(),root=new Node(),meta=new Node();
  const listeners={};
  const document={
    readyState:'loading',documentElement:root,
    querySelector:selector=>selector==='meta[name="theme-color"]'?meta:null,
    getElementById:id=>({'theme-picker':picker,'theme-current':current,'theme-save-status':status})[id]||null,
    createElement:tag=>new Node(tag),
    createDocumentFragment:()=>new Node('fragment'),
    addEventListener:(event,callback)=>{listeners[event]=callback;}
  };
  const window={localStorage:storageAvailable?{
    getItem:key=>state.get(key)||null,
    setItem:(key,value)=>state.set(key,value)
  }:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}};
  runInNewContext(script,{document,window});
  const firstPaint=root.getAttribute('data-theme');
  listeners.DOMContentLoaded();
  return {picker,current,status,root,meta,state,firstPaint};
}
const s=setup('sakura-dream');
assert.equal(s.firstPaint,'sakura-dream','Saved preference must load before first paint');
assert.equal(s.picker.children.length,10,'Exactly ten theme choices');
assert.equal(s.current.textContent,'Sakura Dream');
assert.equal(s.meta.getAttribute('content'),'#fff0f5');
const labels=s.picker.children.map(x=>x.children[1].children[0].textContent);
assert.equal(new Set(labels).size,10);
assert.ok(labels.includes('Midnight Ocean'),'Existing theme named Midnight Ocean');
assert.ok(labels.includes('Arctic Frost'),'Light theme present');
for(const choice of s.picker.children){
  assert.equal(choice.tag,'button');
  assert.equal(choice.type,'button');
  assert.match(choice.getAttribute('aria-label'),/^Use .+ theme$/);
}
const aurora=s.picker.children.find(x=>x.getAttribute('data-theme-choice')==='aurora-borealis');
aurora.click();
assert.equal(s.root.getAttribute('data-theme'),'aurora-borealis');
assert.equal(s.state.get('studybuddy-theme-v1'),'aurora-borealis','Click must persist selection');
assert.equal(s.current.textContent,'Aurora Borealis');
assert.equal(aurora.getAttribute('aria-pressed'),'true');
assert.equal(s.picker.children.filter(x=>x.getAttribute('aria-pressed')==='true').length,1);
assert.equal(setup('corrupted-id').firstPaint,'midnight-ocean','Unknown saved choices must default safely');
const blocked=setup('aurora-borealis',false);
assert.equal(blocked.firstPaint,'midnight-ocean','Blocked local storage must not crash the page');
blocked.picker.children.find(x=>x.getAttribute('data-theme-choice')==='crimson-dusk').click();
assert.equal(blocked.root.getAttribute('data-theme'),'crimson-dusk');
assert.match(blocked.status.textContent,/could not save/);
for(const id of ['aurora-borealis','velvet-nebula','ember-horizon','evergreen-grove','crimson-dusk','eclipse-gold','arctic-frost','coastal-sand','sakura-dream']){
  assert.ok(css.includes('html[data-theme="'+id+'"]'),id+' has a palette');
}
assert.match(css,/prefers-reduced-motion:reduce/);
assert.match(css,/aria-pressed="true"/);
console.log('PASS: 10 palettes, persisted selection, early paint, keyboard buttons, privacy fallback.');
