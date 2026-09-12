import test from 'node:test';
import assert from 'node:assert/strict';
import {groupChartEvents} from '../lib/chart-event-groups.mjs';
const base={time:'0936',price:32};
test('same point has one marker, independent scores retained',()=>{
 const result=groupChartEvents([{...base,id:'p',state:'修复走强',reasons:['结构确认']}],[{...base,id:'o',label:'修复走强',score:90}],[{...base,id:'b',side:'buy',score:70}]);
 assert.equal(result.length,1);assert.equal(result[0].layers.length,3);
 assert.equal(result[0].label,'修复走强 · 买方70分');
 assert.equal(result[0].layers[1].score,90);
});
test('different minutes or prices remain separate',()=>{
 assert.equal(groupChartEvents([],[],[{...base,side:'buy',score:70},{...base,time:'0937',side:'buy',score:80},{...base,price:32.02,side:'sell',score:70}]).length,3);
});
test('opposing scores are not promoted or averaged',()=>{
 const result=groupChartEvents([],[],[{...base,side:'buy',score:80},{...base,side:'sell',score:90}]);
 assert.equal(result[0].label,'买卖分歧');assert.equal(result[0].side,'neutral');
 assert.deepEqual(result[0].layers.map(x=>x.score),[80,90]);
});
