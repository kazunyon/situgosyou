const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, '../mobile-install.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];

async function page(overrides = {}) {
  const elements = {}, events = {}, links = []; let registrations = 0;
  const ids = ['owner','repository','name','device','settings','status','ready','move','install','confirmed','completion','install-status','copy-status','check','destination','continue','open-app','published-name','iphone-name','android','iphone','rename','copy-name','supabase-url','email','login-email'];
  for (const id of ids) elements[id] = { value:'', textContent:'', hidden:true, maxLength:id === 'name' ? 40 : 64, handlers:{}, addEventListener(type, fn){this.handlers[type] = fn;}, scrollIntoView(){}, focus(){}, select(){} };
  elements.device.value = 'android'; elements.owner.maxLength = 39;
  elements.email.value = 'hanako@example.test';
  const location = new URL(overrides.url || 'https://hanako.github.io/kotoba-memo/mobile-install.html');
  const config = {schemaVersion:2, storageMode:'supabase', supabaseUrl:'https://abcdefghijklmnopqrst.supabase.co', repository:'kotoba-memo', appName:'公開したメモ', ...overrides.config};
  const manifest = {name:'公開したメモ',start_url:'/kotoba-memo/',scope:'/kotoba-memo/',display:'standalone', ...overrides.manifest};
  const context = {
    URL, URLSearchParams, AbortSignal, location, sessionStorage:{setItem(){}},
    document: { getElementById: id => elements[id], querySelector: () => links[0] || null,
      createElement: () => ({remove(){links.splice(0,1);}}), head:{append: node => links.push(node)} },
    window: {isSecureContext:true, addEventListener: (type, fn) => events[type] = fn},
    navigator: {userAgent: overrides.iphone ? 'iPhone' : 'Android', platform:'',maxTouchPoints:1,
      serviceWorker:{register: async () => {registrations++; return {scope:new URL('./', location).href};}},
      clipboard:{writeText:async () => {if (overrides.clipboardFailure) throw Error();}} },
    fetch: async url => ({ok:true,redirected:false,json:async () => url.pathname.endsWith('installer-config.json') ? config : manifest})
  };
  vm.runInNewContext(code, context);
  await new Promise(resolve => setImmediate(resolve));
  return {elements, events, links, registrations: () => registrations,
    submit: () => elements.settings.handlers.submit({preventDefault(){}}),
    input: () => elements.settings.handlers.input()};
}

test('same-origin local app verifies and Android uses published name', async () => {
  const p = await page(); p.elements.name.value = '希望の名前'; await p.submit();
  assert.equal(p.elements.ready.hidden,false); assert.equal(p.registrations(),1);
  assert.equal(p.elements.android.hidden,false); assert.equal(p.elements.rename.hidden,false);
  assert.match(p.elements.rename.textContent,/公開したメモ/);
  assert.equal(p.links[0].href,'https://hanako.github.io/kotoba-memo/manifest.webmanifest');
});
test('iPhone has personal name and Safari instructions', async () => {
  const p = await page({iphone:true}); p.elements.name.value = '私のメモ'; await p.submit();
  assert.equal(p.elements.iphone.hidden,false); assert.equal(p.elements.android.hidden,true);
  assert.equal(p.elements['iphone-name'].textContent,'私のメモ');
});
test('author original app is refused before any service worker', async () => {
  const p = await page(); p.elements.owner.value = 'kazunyon'; p.elements.repository.value = 'situgosyou'; await p.submit();
  assert.match(p.elements.status.textContent,/作者の公開先は使いません/); assert.equal(p.registrations(),0);
});
test('unknown or cloud configuration never enables installation', async () => {
  const p = await page({config:{storageMode:'cloud'}}); await p.submit();
  assert.match(p.elements.status.textContent,/一致しません/); assert.equal(p.registrations(),0); assert.equal(p.links.length,0);
});
test('manifest for another origin or scope is refused', async () => {
  const p = await page({manifest:{start_url:'https://other.example/'}}); await p.submit();
  assert.match(p.elements.status.textContent,/開始URL/); assert.equal(p.registrations(),0);
});
test('changing target provides an encoded link to that installer', async () => {
  const p = await page(); p.elements.owner.value = 'taro'; p.elements.name.value = '<名前>&?'; await p.submit();
  assert.equal(p.elements.move.hidden,false); assert.equal(p.registrations(),0);
  const next = new URL(p.elements.continue.href);
  assert.equal(next.origin,'https://taro.github.io'); assert.equal(next.searchParams.get('name'),'<名前>&?');
  assert.equal(next.searchParams.has('email'),false); assert.equal(next.href.includes('example.test'),false);
});
test('invalid repository path is refused', async () => {
  const p = await page(); p.elements.repository.value = '../memo'; await p.submit();
  assert.match(p.elements.status.textContent,/リポジトリ名/); assert.equal(p.registrations(),0);
});
test('install prompt needs verified input and uses browser consent', async () => {
  const p = await page(); let prompted = 0;
  p.events.beforeinstallprompt({preventDefault(){},prompt:async()=>prompted++,userChoice:Promise.resolve({outcome:'accepted'})});
  assert.equal(p.elements.install.disabled,true); await p.submit(); assert.equal(p.elements.install.disabled,false);
  await p.elements.install.handlers.click(); assert.equal(prompted,1);
  assert.match(p.elements['install-status'].textContent,/受け付けました/);
  p.events.appinstalled(); assert.equal(p.elements.install.textContent,'インストール済み');
  p.input(); assert.equal(p.elements.ready.hidden,true); assert.equal(p.elements.install.disabled,true);
});
test('clipboard denial gives one-handed manual alternative', async () => {
  const p = await page({iphone:true,clipboardFailure:true}); await p.submit(); await p.elements['copy-name'].handlers.click();
  assert.match(p.elements['copy-status'].textContent,/長押し/);
});
