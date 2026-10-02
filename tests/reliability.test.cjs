const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { webcrypto, randomUUID } = require('node:crypto')
const { IDBFactory } = require('fake-indexeddb')
const transpile = file => ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const queueSource = transpile('src/lib/offlineQueue.ts')
function queue(indexedDB = new IDBFactory()) {
  const context={exports:{},indexedDB,crypto:webcrypto,TextEncoder,TextDecoder,atob,btoa,structuredClone}
  vm.runInNewContext(queueSource,context)
  return context.exports
}
const item = (productId='p',id=randomUUID())=>({id,method:'post',url:'/inventory/sales',data:{idempotencyKey:id,lines:[{productId,quantity:1,lineRevenue:20}]}})

test('parallel first writes across two tabs use one durable key; every record decrypts after restart',async()=>{
  const db=new IDBFactory();const a=queue(db);const b=queue(db);a.setQueueOwner('A');b.setQueueOwner('A')
  await Promise.all(Array.from({length:40},(_,i)=>(i%2?a:b).enqueueWrite(item())))
  const restart=queue(db);restart.setQueueOwner('A')
  assert.equal((await restart.getQueuedWrites()).length,40);assert.equal(await restart.getQueueCount(),40)
})
test('same operation is immutable and retry is deduplicated; changed body cannot replace it',async()=>{
  const q=queue();q.setQueueOwner('A');const original=item()
  await q.enqueueWrite(original);await q.enqueueWrite(original)
  await assert.rejects(q.enqueueWrite({...original,data:{...original.data,changed:true}}),/ID/)
  assert.equal(await q.getQueueCount(),1)
})
test('account isolation, logout retention and acknowledgement affect only their owner',async()=>{
  const q=queue();q.setQueueOwner('A');const id=randomUUID();await q.enqueueWrite(item('p',id))
  q.setQueueOwner('B');assert.equal(await q.getQueueCount(),0);await q.enqueueWrite(item('p',id))
  await q.removeQueuedWrite(id,'A');assert.equal(await q.getQueueCount(),1)
  q.setQueueOwner(null);assert.equal(await q.getQueueCount(),0)
  q.setQueueOwner('B');assert.equal(await q.getQueueCount(),1)
})
test('a rejected product does not block unrelated operations and no rejection is deleted',async()=>{
  const q=queue();q.setQueueOwner('A');const a=item('bad');const b=item('good');const c=item('bad')
  await q.enqueueWrite(a);await q.enqueueWrite(b);await q.enqueueWrite(c)
  const sent=[]
  await q.flushOfflineQueue(async row=>{sent.push(row.id);if(row.id===a.id) throw Object.assign(Error('deleted'),{status:404})})
  assert.deepEqual(sent,[a.id,b.id]);assert.equal(await q.getQueueCount(),2)
  assert.deepEqual(Array.from(await q.getQueuedWrites(),row=>row.id),[a.id,c.id])
})
test('a ROUTE_NOT_FOUND 404 (deploy/version mismatch) is retried, never parked for review',async()=>{
  const q=queue();q.setQueueOwner('A');const a=item();const b=item()
  await q.enqueueWrite(a);await q.enqueueWrite(b)
  let attempts=0
  await q.flushOfflineQueue(async()=>{attempts++;throw Object.assign(Error('Yo’nalish topilmadi'),{status:404,code:'ROUTE_NOT_FOUND'})})
  assert.equal(attempts,1,'stops this flush like a network failure, does not mark for review')
  assert.equal(await q.getQueueCount(),2)
  assert.ok((await q.getQueuedWrites()).every(row=>!row.lastError))
  // Once the route genuinely exists again, both items go through normally —
  // nothing was ever quarantined.
  const sent=[]
  await q.flushOfflineQueue(async row=>{sent.push(row.id)})
  assert.equal(sent.length,2);assert.equal(await q.getQueueCount(),0)
})
test('timeout/unknown outcome preserves every operation for retry',async()=>{
  const q=queue();q.setQueueOwner('A');await q.enqueueWrite(item());await q.enqueueWrite(item())
  let attempts=0;await q.flushOfflineQueue(async()=>{attempts++;throw Error('response lost')})
  assert.equal(attempts,1);assert.equal(await q.getQueueCount(),2)
  await q.flushOfflineQueue(async()=>{});assert.equal(await q.getQueueCount(),0)
})
test('account switch during a flush cannot send the next record under the new account',async()=>{
  const q=queue();q.setQueueOwner('A');await q.enqueueWrite(item());await q.enqueueWrite(item())
  let sends=0
  await assert.rejects(q.flushOfflineQueue(async row=>{sends++;assert.equal(row.owner,'A');q.setQueueOwner('B')}),/Hisob/)
  assert.equal(sends,1);q.setQueueOwner('A');assert.equal(await q.getQueueCount(),1)
})

const proxySource=transpile('src/app/api/[...path]/route.ts')
function proxy(responses) {
  const calls=[];const context={exports:{},require:name=>{if(name==='next/server') return require('next/server');throw Error(name)},
    process:{env:{BACKEND_PRIMARY_URL:'https://primary.test/api',BACKEND_BACKUP_URL:'https://backup.test/api'}},
    Headers,Response,AbortSignal,TextDecoder,fetch:async(url,options)=>{calls.push({url,method:options.method});const next=responses.shift();if(next instanceof Error)throw next;return next},
  }
  vm.runInNewContext(proxySource,context)
  return {handlers:context.exports,calls}
}
async function request(proxy,method,path=['products']) {
  return proxy.handlers[method]({method,headers:new Headers(),nextUrl:{search:'?a=1'},arrayBuffer:async()=>new TextEncoder().encode('{}').buffer},{params:Promise.resolve({path})})
}
test('proxy GET fails over once; POST unknown outcome never replays on backup',async()=>{
  const read=proxy([new Response('down',{status:503}),new Response('ok')]);assert.equal((await request(read,'GET')).status,200);assert.equal(read.calls.length,2)
  const write=proxy([Error('response lost'),new Response('would duplicate')]);const result=await request(write,'POST');assert.equal(result.status,503);assert.equal(write.calls.length,1)
  assert.equal((await result.json()).error.code,'WRITE_OUTCOME_UNKNOWN')
})
test('proxy passes application conflicts without retry and supports all null-body statuses',async()=>{
  const conflict=proxy([new Response('conflict',{status:409})]);assert.equal((await request(conflict,'POST')).status,409);assert.equal(conflict.calls.length,1)
  for(const status of [204,205,304]) {const p=proxy([new Response(null,{status})]);const result=await request(p,'GET');assert.equal(result.status,status);assert.equal(await result.text(),'')}
  const head=proxy([new Response('ignored')]);assert.equal(await (await request(head,'HEAD')).text(),'')
})
test('an ordinary business 404 is returned as-is and never retried on backup',async()=>{
  const p=proxy([new Response(JSON.stringify({success:false,error:{message:'Mahsulot topilmadi'}}),{status:404})])
  const result=await request(p,'GET');assert.equal(result.status,404);assert.equal(p.calls.length,1)
  assert.equal((await result.json()).error.message,'Mahsulot topilmadi')
})
test('a Railway platform 404 (router header) fails over to backup exactly once',async()=>{
  const p=proxy([new Response('not found',{status:404,headers:{'x-railway-router':'edge'}}),new Response('ok')])
  const result=await request(p,'GET');assert.equal(result.status,200);assert.equal(p.calls.length,2)
})
test('a Railway platform 404 (Application not found body) fails over to backup exactly once',async()=>{
  const p=proxy([new Response('Application not found',{status:404}),new Response('ok')])
  const result=await request(p,'GET');assert.equal(result.status,200);assert.equal(p.calls.length,2)
})
test('a 404 on a write request is never inspected for platform-failover and never replayed',async()=>{
  const p=proxy([new Response('Application not found',{status:404})])
  const result=await request(p,'POST');assert.equal(result.status,404);assert.equal(p.calls.length,1)
})


test('an aborted IndexedDB transaction never reports a durable acknowledgement',async()=>{
  const {IDBDatabase}=require('fake-indexeddb')
  const q=queue();q.setQueueOwner('A');await q.enqueueWrite(item())
  const original=IDBDatabase.prototype.transaction
  IDBDatabase.prototype.transaction=function(names,mode,...rest) {
    const tx=original.call(this,names,mode,...rest)
    if(mode==='readwrite' && Array.isArray(names) && names.includes('ownerWriteQueue')) queueMicrotask(()=>tx.abort())
    return tx
  }
  try {await assert.rejects(q.enqueueWrite(item()))}
  finally {IDBDatabase.prototype.transaction=original}
  assert.equal(await q.getQueueCount(),1)
  assert.equal((await q.getQueuedWrites()).length,1)
})

const apiSource=transpile('src/lib/api.ts')
function apiHarness() {
  const axios=require('axios');let owner=null;const saved=[];const removed=[];let now=0
  class TestDate extends Date {static now(){return now}}
  const queue={setQueueOwner:value=>owner=value,getQueueOwner:()=>owner,enqueueWrite:async item=>saved.push(structuredClone(item)),removeQueuedWrite:async(id,account)=>removed.push({id,account}),markQueuedWriteForReview:async(id,message,account)=>saved.push({review:id,message,account}),flushOfflineQueue:async()=>{}}
  const context={exports:{},require:name=>{if(name==='axios')return axios;if(name==='./offlineQueue')return queue;if(name==='./businessDay')return {getBusinessDate:()=> '2026-09-30'};throw Error(name)},
    crypto:webcrypto,FormData,Date:TestDate,atob,console,localStorage:{setItem(){},removeItem(){}},window:{location:{href:''}},setTimeout,clearTimeout,
  }
  vm.runInNewContext(apiSource,context)
  const setOwner=id=>context.exports.setApiToken(`header.${Buffer.from(JSON.stringify({userId:id})).toString('base64url')}.signature`)
  setOwner('A')
  return {api:context.exports.default,exports:context.exports,saved,removed,setOwner,getOwner:()=>owner,setTime:value=>now=value,axios}
}
const response=(config,data={value:1})=>({config,data,status:200,statusText:'OK',headers:{}})
test('Axios zero timeout receives a finite default; multipart stays FormData',async()=>{
  const h=apiHarness();let request
  await h.api.get('/products',{adapter:async config=>{request=config;return response(config)}})
  assert.equal(request.timeout,22000)
  const form=new FormData();form.append('image',new Blob(['fake'],{type:'image/png'}),'test.png')
  await h.api.post('/products/p/image',form,{adapter:async config=>{request=config;return response(config)}})
  assert.equal(request.data,form);assert.notEqual(request.headers.getContentType(),'application/json');assert.equal(request.timeout,125000)
})
test('reading a cached response never renews its original expiry',async()=>{
  const h=apiHarness();let calls=0
  const config={adapter:async config=>{calls++;return response(config)}}
  await h.api.get('/products',config)
  h.setTime(20000);await h.api.get('/products',config)
  h.setTime(31000);await h.api.get('/products',config)
  assert.equal(calls,2)
})
test('unknown write outcome remains durable with the original ID across Axios serialized retries',async()=>{
  const h=apiHarness();let request
  const original={method:'post',url:'/inventory/sales',data:{deviceId:'test',date:'2026-09-30',lines:[{productId:'p',quantity:1}]},adapter:async config=>{request=config;throw new h.axios.AxiosError('lost','ERR_NETWORK',config)}}
  const queued=await h.api.request(original);assert.equal(queued.status,202);assert.equal(h.saved.length,1)
  const id=h.saved[0].id;assert.equal(JSON.parse(request.data).idempotencyKey,id)
  const retried=await h.api.request({...request,adapter:async config=>response(config)})
  assert.equal(retried.status,200);assert.equal(h.saved[1].id,id);assert.equal(h.removed[0].id,id)
})
test('an old account 401 response cannot sign out a new account',async()=>{
  const h=apiHarness();let expire;let start
  const started=new Promise(resolve=>start=resolve)
  let logouts=0;h.exports.setUnauthorizedHandler(()=>logouts++)
  const pending=h.api.get('/products',{adapter:config=>new Promise((resolve,reject)=>{expire=()=>reject(new h.axios.AxiosError('expired','ERR_BAD_REQUEST',config,{}, {...response(config),status:401}));start()})})
  await started;h.setOwner('B');expire()
  await assert.rejects(pending,/Hisob/);assert.equal(logouts,0);assert.equal(h.getOwner(),'B')
})

test('permanent rejection is parked across reloads and never auto-executes later',async()=>{
  const db=new IDBFactory(),q=queue(db);q.setQueueOwner('A');const sale=item();await q.enqueueWrite(sale)
  await q.flushOfflineQueue(async()=>{throw Object.assign(Error('stale stock'),{status:409})})
  const restarted=queue(db);restarted.setQueueOwner('A');let attempts=0
  await restarted.flushOfflineQueue(async()=>{attempts++});assert.equal(attempts,0)
  assert.equal(await restarted.getQueueCount(),1);assert.equal((await restarted.getQueuedWrites())[0].lastError,'stale stock')
})
test('initial business rejection returns pending-review acknowledgement so the cart is not submitted as a second sale',async()=>{
  const h=apiHarness();const result=await h.api.post('/inventory/operations',{id:'stable-id',kind:'sale',lines:[]},{adapter:async config=>{throw new h.axios.AxiosError('conflict','ERR_BAD_REQUEST',config,{}, {...response(config,{error:{message:'stock changed'}}),status:409})}})
  assert.equal(result.status,202);assert.equal(result.data.needsReview,true)
  assert.equal(h.saved[1].review,'stable-id');assert.equal(h.removed.length,0)
})
test('refresh 503 preserves the session and an old refresh cannot replace a newly signed-in account',async()=>{
  const h=apiHarness();h.exports.setRefreshToken('old-refresh');let logouts=0;h.exports.setUnauthorizedHandler(()=>logouts++)
  const oldPost=h.axios.post
  const unauthorized=async config=>{throw new h.axios.AxiosError('expired','ERR_BAD_REQUEST',config,{}, {...response(config),status:401})}
  try {
    h.axios.post=async()=>{throw {response:{status:503}}}
    await assert.rejects(h.api.get('/refresh-test',{adapter:unauthorized}),error=>error.code==='REFRESH_NETWORK_ERROR')
    assert.equal(logouts,0);assert.equal(h.getOwner(),'A')
    let complete,started;const beginning=new Promise(resolve=>started=resolve)
    h.axios.post=()=>new Promise(resolve=>{complete=resolve;started()})
    const pending=h.api.get('/refresh-test-2',{adapter:unauthorized});await beginning;h.setOwner('B')
    complete({data:{token:`h.${Buffer.from(JSON.stringify({userId:'A'})).toString('base64url')}.s`,refreshToken:'old-rotated'}})
    await assert.rejects(pending,/Hisob|Sessiya/);assert.equal(h.getOwner(),'B');assert.equal(logouts,0)
  } finally {h.axios.post=oldPost}
})
test('patched ExcelJS produces a readable workbook and patched Sharp loads',async()=>{
  const ExcelJS=require('exceljs');const workbook=new ExcelJS.Workbook();workbook.addWorksheet('Report').addRow(['Product',1,25000])
  const bytes=await workbook.xlsx.writeBuffer();const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(bytes)
  assert.equal(loaded.worksheets[0].getCell('C1').value,25000)
  const sharp=require('sharp');const image=await sharp({create:{width:1,height:1,channels:4,background:'#ffffff'}}).png().toBuffer();assert.ok(image.length>0)
})
