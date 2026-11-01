import test from 'node:test';
import assert from 'node:assert/strict';
import '../../play/jka/jedi-re.js';
const {dimensions,presets}=globalThis.JediRE;
test('quality budgets bound Retina and ultrawide rendering and preserve aspect',()=>{
  for(const quality of Object.keys(presets)) for(const [w,h,dpr] of [[3840,2160,2],[3440,1440,2],[1440,900,2],[800,600,1],[7680,4320,3]]) {
    const [rw,rh]=dimensions(w,h,dpr,quality);
    assert.ok(rw*rh<=presets[quality].pixels,`${quality}: ${rw}x${rh}`);
    assert.ok(Math.abs(rw/rh-w/h)<.012);
    assert.equal(rw%2,0);assert.equal(rh%2,0);
  }
});
test('invalid viewport and saved quality cannot produce NaN or overflow packed dimensions',()=>{
  for(const args of [[NaN,0,Infinity,'missing'],[1e9,100,8,'ultra'],[1280,720,2,'balanced',2]]) {
    const result=dimensions(...args); assert.ok(result.every(n=>Number.isFinite(n)&&n>=2&&n<=8192));
    assert.ok(result[0]*result[1]<=8000000);
  }
});
test('same viewport yields identical creation and resize targets at the budget',()=>{
  const target=dimensions(2560,1440,2,'balanced');
  for(let i=0;i<10;i++)assert.deepEqual(dimensions(2560,1440,2,'balanced'),target);
  assert.ok(target[0]<2560*2);
});
