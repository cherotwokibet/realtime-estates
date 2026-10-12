import assert from 'node:assert/strict';
import {connect} from 'node:net';
import test from 'node:test';
import {createDevelopmentServer} from '../dist/http.js';

const LISTING='00000000-0000-4000-8000-000000000400',MEDIA='00000000-0000-4000-8000-000000000500';
const PATH=`/v2/staff/listings/${LISTING}/revisions/1/media/${MEDIA}/preview`;
async function withServer(preview,run){
  let ordinary=0;const clients=new WeakMap();
  const server=createDevelopmentServer(async()=>{ordinary++;return new Response('ordinary',{status:404});},clients,undefined,request=>preview(request,clients));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try{await run(server.address().port,()=>ordinary);}finally{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
}
async function exchange(port,target=PATH,{method='GET',headers=[]}={}){
  let socket,timer;
  try{return await Promise.race([new Promise((resolve,reject)=>{
    const output=[];socket=connect({host:'127.0.0.1',port},()=>socket.write(`${method} ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n${headers.join('\r\n')}${headers.length?'\r\n':''}\r\n`));
    socket.on('data',bytes=>output.push(bytes));socket.once('error',reject);socket.once('end',()=>resolve(Buffer.concat(output).toString('latin1')));
  }),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Preview headers-only request did not settle.')),3000);})]);}
  finally{clearTimeout(timer);socket?.destroy();}
}
const status=raw=>Number(/^HTTP\/1\.1 (\d{3})/.exec(raw)?.[1]);

test('private preview hook receives exact raw path/socket/header context before any body is consumed',async()=>{
  let calls=0;
  await withServer(async(request,clients)=>{
    calls++;assert.equal(request.body,null);assert.equal(clients.get(request),'127.0.0.1');
    assert.equal(request.headers.get('content-length'),'99999999');return new Response('body framing denied',{status:400});
  },async(port,ordinary)=>{
    const raw=await exchange(port,PATH,{headers:['Content-Length: 99999999']});assert.equal(status(raw),400);assert.match(raw,/connection: close/i);
    assert.equal(calls,1);assert.equal(ordinary(),0);
  });
});
test('private preview aliases cannot reach the hook after URL normalization; exact method decisions remain with handler',async()=>{
  let calls=0;
  await withServer(async request=>{calls++;return new Response('preview',{status:request.method==='GET'?200:405});},async(port,ordinary)=>{
    assert.equal(status(await exchange(port)),200);assert.equal(status(await exchange(port,PATH,{method:'POST'})),405);
    for(const target of [PATH+'/',PATH+'?',PATH+'?version=3',PATH+'#fragment',PATH.replace('/revisions/1/','/revisions/01/'),PATH.replace('/revisions/1/','/revisions/2147483648/'),PATH.replace('/media/','/media%2f'),'/alias/..'+PATH,PATH.replace('/media/','/./media/'),PATH.replace('/media/','/x/../media/'),`http://127.0.0.1:${port}${PATH}`]){
      assert.equal(status(await exchange(port,target)),404,target);
    }
    assert.equal(calls,2);assert.equal(ordinary(),11);
  });
});
test('Expect on exact private preview is refused without 100 Continue or handler/body admission',async()=>{
  let calls=0;
  await withServer(async()=>{calls++;return new Response('unexpected');},async port=>{
    for(const expect of ['100-continue','unexpected']){
      const raw=await exchange(port,PATH,{headers:[`Expect: ${expect}`,'Content-Length: 1000000']});assert.equal(status(raw),417);assert.doesNotMatch(raw,/100 Continue/);
    }
    assert.equal(calls,0);
  });
});
test('ordinary default bridge does not enable private media preview',async()=>{
  const server=createDevelopmentServer(async()=>new Response('default only',{status:404}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{assert.equal(status(await exchange(server.address().port)),404);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
