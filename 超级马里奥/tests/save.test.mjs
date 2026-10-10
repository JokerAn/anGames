import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSave} from '../save.js';

test('malformed root and nested data always produce usable records',()=>{
  for(const input of [null,false,10,'broken',[],{}, {records:{easy:'bad',hard:[]}}, {records:{easy:{levels:7}}}]){
    const result=normalizeSave(input,8);
    assert.equal(result.sound,true);
    for(const mode of ['easy','hard'])assert.deepEqual(result.records[mode],{bestCoins:0,bestStars:0,levels:{}});
  }
});
test('valid progress and sound preferences survive unchanged',()=>{
  const source={sound:false,records:{easy:{bestCoins:123,bestStars:4,levels:{0:{stars:3},1:{stars:0},2:{stars:1}}},hard:{bestCoins:80,bestStars:2,levels:{1:{stars:2}}}}};
  assert.deepEqual(normalizeSave(source,8),source);
});
test('star values are finite integers bounded to zero through three',()=>{
  const source={records:{easy:{levels:{0:{stars:4},1:{stars:-1},2:{stars:1.9},3:{stars:Infinity},4:{stars:'2'},5:null,6:{stars:NaN},7:{stars:1e9},8:{stars:3}}}}};
  assert.deepEqual(normalizeSave(source,8).records.easy.levels,{0:{stars:3},1:{stars:0},2:{stars:1},7:{stars:3}});
});
test('nonfinite or negative scores are sanitized',()=>{
  const result=normalizeSave({records:{easy:{bestCoins:Infinity,bestStars:-3},hard:{bestCoins:-12,bestStars:999}}},8);
  assert.equal(result.records.easy.bestCoins,0);assert.equal(result.records.easy.bestStars,0);
  assert.equal(result.records.hard.bestCoins,0);assert.equal(result.records.hard.bestStars,24);
});
test('legacy records migrate to easy mode only',()=>{
  const result=normalizeSave({bestCoins:60,bestStars:5},8);
  assert.equal(result.records.easy.bestCoins,60);assert.equal(result.records.easy.bestStars,5);
  assert.equal(result.records.hard.bestCoins,0);assert.deepEqual(result.records.easy.levels,{});
});
test('normalization never mutates or aliases stored input',()=>{
  const source={records:{easy:{levels:{0:{stars:2}}}}},result=normalizeSave(source,8);
  result.records.easy.levels[0].stars=3;
  assert.equal(source.records.easy.levels[0].stars,2);
});
