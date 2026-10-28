import assert from 'node:assert/strict';import test from 'node:test';
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {DataStateStrip,formatDataTime} from '../app/data-state-strip.mjs';
import {persistLocalLedger} from '../lib/local-ledger-persistence.mjs';
test('actual rendered status separates missing quote time and known fetch time',()=>{
 const html=renderToStaticMarkup(React.createElement(DataStateStrip,{source:'示例',sourceTime:null,fetchedAt:'2026-10-23T01:31:02Z',status:'时间戳缺失',researchBlocked:true}));
 assert.match(html,/行情 未知/);assert.match(html,/获取 10\/23 09:31:02/);assert.match(html,/研究未就绪/);assert.match(html,/不代表没有信号/);assert.match(html,/普通行情继续显示/);
 assert.equal(formatDataTime('bad'),'未知');assert.match(formatDataTime('20261023-093110123'),/09:31:10/);
});
test('storage failure throws and actual error state renders accessibly',()=>{
 assert.throws(()=>persistLocalLedger({setItem(){throw new Error('quota');}},'synthetic',[]),/quota/);
 const html=renderToStaticMarkup(React.createElement(DataStateStrip,{storageError:'保存失败，未记账'}));assert.match(html,/role="alert"/);assert.match(html,/保存失败，未记账/);
});
import {readLocalLedger} from '../lib/local-ledger-persistence.mjs';
test('invalid local ledger cannot masquerade as an empty account',()=>{
 assert.deepEqual(readLocalLedger({getItem:()=>null},'test'),[]);
 assert.throws(()=>readLocalLedger({getItem:()=>'{bad'},'test'));
 assert.throws(()=>readLocalLedger({getItem:()=>'{}'},'test'));
});
