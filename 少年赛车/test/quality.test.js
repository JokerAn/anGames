import test from 'node:test';
import assert from 'node:assert/strict';
import {AdaptiveQuality,deviceBudget,renderRatio,QUALITY_LEVELS} from '../src/quality.js';
function frames(quality,seconds,interval,cost){let changed=0;for(let i=0;i<Math.ceil(seconds/interval);i++)if(quality.observe(interval,cost))changed++;return changed;}
test('弱设备保守启动；缺失硬件数据的 Safari 可以实测晋升',()=>{
  assert.equal(deviceBudget({hardwareConcurrency:2,deviceMemory:8}).level,0);assert.equal(deviceBudget({deviceMemory:2}).ceiling,1);
  assert.deepEqual(deviceBudget({}),{level:1,ceiling:3});assert.equal(deviceBudget({hardwareConcurrency:8,deviceMemory:8}).level,2);
});
test('像素预算覆盖高 DPR 和大屏，所有降档分辨率单调下降',()=>{
  for(const [w,h] of [[390,844],[844,390],[1920,1080],[3840,2160]]){let previous=0;for(let i=0;i<4;i++){const ratio=renderRatio(i,w,h,3);assert.ok(ratio>=previous);assert.ok(w*h*ratio*ratio<=QUALITY_LEVELS[i].maxPixels+1);previous=ratio;}}
  assert.equal(renderRatio(3,390,844,1),1);
});
test('持续掉帧降档，短暂卡顿与后台时间不触发降档',()=>{
  const q=new AdaptiveQuality({hardwareConcurrency:8,deviceMemory:8});frames(q,3.5,1/60,5);q.observe(.9,700);q.observe(.1,60);assert.equal(q.level,2);
  frames(q,6,.03,24);assert.equal(q.level,1);frames(q,9,.04,29);assert.equal(q.level,0);
});
test('性能恢复后稳定升档，热降频可再次降低质量，不超过设备上限',()=>{
  const q=new AdaptiveQuality({hardwareConcurrency:2});frames(q,19,1/30,5);assert.equal(q.level,1);frames(q,20,1/60,5);assert.equal(q.level,1);
  frames(q,8,.04,25);assert.equal(q.level,0);
  const safari=new AdaptiveQuality({});frames(safari,36,1/60,4);assert.equal(safari.level,3);
});
test('重置采样可丢弃页面切换和场景初始化的卡顿',()=>{
  const q=new AdaptiveQuality({});frames(q,6,.03,25);q.reset();frames(q,3,1/60,5);assert.equal(q.level,1);
});
