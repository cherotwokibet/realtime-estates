import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDevelopmentServer} from '../dist/http.js';
test('HTTP bridge derives client address from socket and preserves ambiguous authorization for rejection',async()=>{
  const clients=new WeakMap();
  const server=createDevelopmentServer(async request=>new Response(JSON.stringify({authorization:request.headers.get('authorization'),client:clients.get(request),body:await request.json()})),clients);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/enquiries`,{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':'attacker-selected',Authorization:'Bearer one, Bearer two'},body:JSON.stringify({message:'synthetic'})});
    const result=await response.json(); assert.equal(result.authorization,'Bearer one, Bearer two');
    assert.equal(result.client,'127.0.0.1'); assert.deepEqual(result.body,{message:'synthetic'});
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('HTTP bridge caps received bodies before application handler',async()=>{
  let calls=0; const server=createDevelopmentServer(async()=>{calls++;return new Response('unexpected');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/enquiries`,{method:'POST',body:'x'.repeat(65537)});
    assert.equal(response.status,413);assert.equal(calls,0);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
