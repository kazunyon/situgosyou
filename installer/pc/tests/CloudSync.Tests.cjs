const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../../../node_modules/typescript');
const source = fs.readFileSync(path.join(__dirname, '../../../src/cloud-sync.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const clone = value => value === undefined ? undefined : structuredClone(value);
function fixture() {
  const profiles = new Map(), server = new Map(); let sessionId = 'person-a'; let serverTime = 0; let failure = false;
  const dataFor = uid => { if (!server.has(uid)) server.set(uid, {rows:[],categories:[],revision:0}); return server.get(uid); };
  const indexedDB = {open() {
    const request = {};
    request.result = {createObjectStore(){},transaction() {
      const transaction = {objectStore() {return {
        get(key) { const r = {}; queueMicrotask(() => {r.result = clone(profiles.get(key)); r.onsuccess();}); return r; },
        put(value,key) { queueMicrotask(() => {profiles.set(key,clone(value)); transaction.oncomplete();}); }
      };}}; return transaction;
    }};
    queueMicrotask(() => request.onsuccess()); return request;
  }};
  function client(uid) {
    const reply = (data, error = null) => ({data:clone(data),error});
    return {rpc:async (name,args) => {
      if (failure) return reply(null,{code:'NETWORK',message:'test failure'});
      const data = dataFor(uid);
      if (name === 'kotoba_save_categories') {
        if (data.revision !== args.p_expected_revision) return reply(null,{code:'40001'});
        data.categories = clone(args.p_categories); return reply(++data.revision);
      }
      const current = data.rows.find(row => row.id === args.p_memo.id);
      if ((!current && args.p_expected_updated_at !== null) || (current && current.updated_at !== args.p_expected_updated_at)) return reply(null,{code:'40001'});
      const row = {...clone(args.p_memo),updated_at:new Date(++serverTime * 1000).toISOString()};
      data.rows = [row,...data.rows.filter(item => item.id !== row.id)]; return reply([row]);
    },from(table) {
      const query = {select(){return this;},order(){return this;},maybeSingle(){return this;},then(resolve,reject) {
        const data = dataFor(uid);
        return Promise.resolve(failure ? reply(null,{code:'NETWORK'}) : reply(table === 'memos' ? data.rows : table === 'memo_categories' ? data.categories : {revision:data.revision})).then(resolve,reject);
      }}; return query;
    }};
  }
  function app() {
    const exports = {}, navigator = {onLine:true};
    const context = {exports, navigator, indexedDB, Event, console, Promise,
      crypto:{randomUUID:require('node:crypto').randomUUID},window:{dispatchEvent(){}},
      require(name) {
        if (name === './supabase') return {supabaseProjectUrl:'https://abcdefghijklmnopqrst.supabase.co',supabasePublicKey:'sb_publishable_testKey123456',supabase:{auth:{getSession:async () => ({data:{session:sessionId ? {user:{id:sessionId},access_token:sessionId} : null}})}}};
        if (name === '@supabase/supabase-js') return {createClient:(url,key,options) => client(options.global.headers.Authorization.slice(7))};
        throw Error(name);
      }
    };
    vm.runInNewContext(compiled,context); return {api:exports,navigator};
  }
  return {app,profiles,dataFor,setUser:value => sessionId=value,setFailure:value=>failure=value};
}
const row = (id='memo-a',title='端末のメモ') => ({id,section:'daily',display_number:1,sort_order:1,category_number:1,title,title_color:'black',meaning:'説明',steps:[],marked:'',deleted:false,created_at:new Date(0).toISOString(),updated_at:new Date(0).toISOString()});

test('offline memo and categories survive app restart, then both reach server',async () => {
  const f=fixture(), a=f.app(); a.navigator.onLine=false;
  await a.api.queueCloudCategories([{number:1,name:'確認用'}]); await a.api.queueCloudMemos([row()]);
  assert.equal(a.api.getCloudSyncStatus().pending,2); assert.equal(f.dataFor('person-a').rows.length,0);
  const restarted=f.app(); restarted.navigator.onLine=false;
  assert.equal((await restarted.api.loadCloudData()).rows[0].title,'端末のメモ'); assert.equal(restarted.api.getCloudSyncStatus().pending,2);
  restarted.navigator.onLine=true; await restarted.api.loadCloudData();
  assert.equal(f.dataFor('person-a').categories[0].name,'確認用'); assert.equal(f.dataFor('person-a').rows[0].title,'端末のメモ'); assert.equal(restarted.api.getCloudSyncStatus().pending,0);
});
test('same account on another device reads the shared records',async () => {
  const f=fixture(), a=f.app(); await a.api.queueCloudMemos([row()]);
  const b=f.app(); assert.equal((await b.api.loadCloudData()).rows[0].title,'端末のメモ');
});
test('another account never reads or sends the first account outbox',async () => {
  const f=fixture(), a=f.app(); a.navigator.onLine=false; await a.api.queueCloudMemos([row()]);
  f.setUser('person-b'); const b=f.app(); assert.equal((await b.api.loadCloudData()).rows.length,0); assert.equal(b.api.getCloudSyncStatus().pending,0); assert.equal(f.dataFor('person-b').rows.length,0);
  f.setUser('person-a'); await a.api.loadCloudData(); assert.equal(a.api.getCloudSyncStatus().pending,1);
});
test('concurrent edits keep the durable local change without overwriting server',async () => {
  const f=fixture(), a=f.app(); await a.api.queueCloudMemos([row()]);
  a.navigator.onLine=false; await a.api.queueCloudMemos([row('memo-a','未送信の変更')]);
  f.dataFor('person-a').rows[0].title='別端末の変更'; f.dataFor('person-a').rows[0].updated_at='2030-01-01T00:00:00Z';
  a.navigator.onLine=true; const snapshot=await a.api.loadCloudData();
  assert.equal(snapshot.rows[0].title,'未送信の変更'); assert.equal(a.api.getCloudSyncStatus().conflict,true); assert.equal(f.dataFor('person-a').rows[0].title,'別端末の変更');
  await a.api.resolveCloudConflict('local'); assert.equal(f.dataFor('person-a').rows[0].title,'未送信の変更'); assert.equal(a.api.getCloudSyncStatus().pending,0);
});
test('explicit choice of remote data discards only the local outbox',async () => {
  const f=fixture(), a=f.app(); await a.api.queueCloudMemos([row()]);
  a.navigator.onLine=false; await a.api.queueCloudMemos([row('memo-a','未送信')]); f.dataFor('person-a').rows[0].title='共有先'; f.dataFor('person-a').rows[0].updated_at='2030-01-01T00:00:00Z';
  a.navigator.onLine=true; await a.api.loadCloudData(); await a.api.resolveCloudConflict('remote');
  assert.equal((await a.api.loadCloudData()).rows[0].title,'共有先'); assert.equal(a.api.getCloudSyncStatus().pending,0);
});
test('failure while resolving a conflict preserves the pending edit',async () => {
  const f=fixture(), a=f.app(); a.navigator.onLine=false; await a.api.queueCloudMemos([row()]);
  a.navigator.onLine=true; f.setFailure(true); await assert.rejects(a.api.resolveCloudConflict('local'));
  const restarted=f.app(); restarted.navigator.onLine=false; assert.equal((await restarted.api.loadCloudData()).pending.length,1);
});
test('a stale edit uses its captured version even after a newer refresh',async () => {
  const f=fixture(), a=f.app(); await a.api.queueCloudMemos([row()]); const old=f.dataFor('person-a').rows[0].updated_at;
  f.dataFor('person-a').rows[0].updated_at='2030-01-01T00:00:00Z'; await a.api.loadCloudData();
  await a.api.queueCloudMemos([row('memo-a','古い画面から保存')],{'memo-a':old}); assert.equal(a.api.getCloudSyncStatus().conflict,true);
});
test('category conflicts are detected by revision',async () => {
  const f=fixture(), a=f.app(); await a.api.queueCloudCategories([{number:1,name:'元のカテゴリ'}]);
  f.dataFor('person-a').revision++; await a.api.queueCloudCategories([{number:1,name:'古い画面の変更'}],1);
  assert.equal(a.api.getCloudSyncStatus().conflict,true); assert.equal(f.dataFor('person-a').categories[0].name,'元のカテゴリ');
});
test('a network error retains the saved outbox for retry',async () => {
  const f=fixture(), a=f.app(); f.setFailure(true); await a.api.queueCloudMemos([row()]);
  assert.equal(a.api.getCloudSyncStatus().pending,1); assert.match(a.api.getCloudSyncStatus().error,/未送信/);
  f.setFailure(false); await a.api.loadCloudData(); assert.equal(a.api.getCloudSyncStatus().pending,0);
});
