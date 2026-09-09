import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './src/index.js';
test('Plan A extension validation and persistence', async () => {
  const realFetch = globalThis.fetch;
  const now = Date.now();
  const row = { id:'abc',plate:'ABC123',email:'test@example.com',confirmation_code:'TEST1234',status:'active',stall_number:1,start_at:new Date(now-2*36e5).toISOString(),end_at:new Date(now+2*36e5).toISOString() };
  let limit=8, allowance=7, conflict=false, patch;
  globalThis.fetch = async (url, options={}) => {
    if (options.method === 'PATCH') { patch=JSON.parse(options.body); return Response.json([{...row,...patch}]); }
    if (url.includes('parking_settings?')) return Response.json([{duration_options:[2,4,8],max_stay_hours:limit,rolling_days:30,max_days_in_period:allowance}]);
    if (url.includes('id=neq')) return Response.json(conflict ? [{id:'other'}] : []);
    return Response.json([row]);
  };
  const call = (extra={}) => worker.fetch(new Request('https://test/api/extend',{method:'POST',body:JSON.stringify({email:row.email,plate:row.plate,confirmation_code:row.confirmation_code,hours:4,...extra})}),{SUPABASE_URL:'https://db',SUPABASE_SERVICE_ROLE_KEY:'test'});
  try {
    let res=await call(); assert.equal(res.status,200); assert.equal(Date.parse(patch.end_at),Date.parse(row.end_at)+4*36e5); assert.equal(patch.reminder_sent_at,null);
    limit=7; assert.equal((await call()).status,400); limit=8;
    conflict=true; assert.equal((await call()).status,400); conflict=false;
    allowance=0.25; assert.equal((await call()).status,400); allowance=7;
    assert.equal((await call({email:'wrong@example.com'})).status,400);
    assert.equal((await call({hours:-2})).status,400);
    row.end_at=new Date(now-1).toISOString(); assert.equal((await call()).status,400);
  } finally { globalThis.fetch=realFetch; }
});
