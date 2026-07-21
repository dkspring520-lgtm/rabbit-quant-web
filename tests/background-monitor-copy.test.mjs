import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const pageSource=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const landingSource=readFileSync(new URL('../app/public-landing.tsx',import.meta.url),'utf8');

test('monitor copy distinguishes server scanning from foreground refresh',()=>{
  assert.match(pageSource,/服务器持续后台扫描/);
  assert.match(pageSource,/页面隐藏时仅暂停前端报价刷新；服务器继续扫描并记录/);
  assert.match(landingSource,/服务器后台持续扫描，页面隐藏时减少前端请求/);
});

test('obsolete copy no longer says monitoring stops in background',()=>{
  assert.doesNotMatch(pageSource,/切换后台即暂停轮询/);
  assert.doesNotMatch(pageSource,/页面切到后台会暂停请求/);
  assert.doesNotMatch(landingSource,/后台自动暂停，降低无效请求/);
});
