import test from 'node:test';
import assert from 'node:assert/strict';
import {selectChartSession,chartSessionNotice,mergeDatedMinuteMap,currentMinuteMap} from '../lib/chart-session.mjs';
const today='2026-10-28', yesterday='2026-10-27';
const row=(time,date=today)=>({date,time,price:28,volume:1});
const options=(time,code='601899')=>({mode:'current',code,now:new Date(`${today}T${time}:00+08:00`)});
const data=(minutes,code='601899')=>({quote:{code},sourceTimestamp:`${today}T11:30:00+08:00`,minutes});
test('lunch retains 11:30, never shows afternoon points',()=>{
 for(const time of ['11:30','11:31','12:59']) assert.deepEqual(selectChartSession([data(['0930','1130','1300','1500'].map(t=>row(t)))],options(time)).minutes.map(x=>x.time),['0930','1130']);
});
test('preopen is empty, afternoon advances only to clock, close keeps full day',()=>{
 const source=data(['0930','1130','1300','1500'].map(t=>row(t)));
 assert.equal(selectChartSession([source],options('09:29')).minutes.length,0);
 assert.equal(selectChartSession([source],options('13:00')).minutes.length,3);
 assert.equal(selectChartSession([source],options('15:30')).minutes.length,4);
});
test('current quote cannot date old or undated rows; no silent historical fallback',()=>{
 const source={...data([row('1500',yesterday),{time:'1500',price:28}]),intradaySessions:[{date:yesterday,minutes:[row('1500',yesterday)]}]};
 assert.equal(selectChartSession([source],options('12:00')).minutes.length,0);
});
test('failed refresh can retain same-day rows, but midnight and stock switch cannot',()=>{
 const saved=data([row('0930')]);
 assert.equal(selectChartSession([data([]),saved],options('12:00')).minutes.length,1);
 assert.equal(selectChartSession([saved],{...options('12:00'),now:new Date('2026-10-29T12:00:00+08:00')}).minutes.length,0);
 assert.equal(selectChartSession([saved],options('12:00','600000')).minutes.length,0);
});
test('explicit historical selection keeps its own dated full session',()=>{
 const source={...data([]),intradaySessions:[{date:yesterday,minutes:[row('0930',yesterday),row('1500',yesterday)]}]};
 const result=selectChartSession([source],{...options('12:00'),mode:'history',date:yesterday});
 assert.equal(result.date,yesterday);assert.equal(result.minutes.length,2);
});
test('L2 date-qualified cache drops yesterday and rejects late yesterday packets',()=>{
 let cache=mergeDatedMinuteMap({}, {'1500':{price:27}},yesterday);
 assert.deepEqual(currentMinuteMap(cache,options('12:00').now),{});
 cache=mergeDatedMinuteMap(cache,{'0930':{price:28},'1300':{price:29}},today);
 cache=mergeDatedMinuteMap(cache,{'1500':{price:99}},yesterday);
 assert.deepEqual(currentMinuteMap(cache,options('12:00').now),{'0930':{price:28}});
 assert.equal(Object.keys(cache).length,2);
 assert.equal(mergeDatedMinuteMap(cache,{'1500':{}},null),cache);
 assert.equal(mergeDatedMinuteMap(cache,{'1500':{}},'2026-10-29',options('12:00').now),cache);
});
test('history mode cannot be used to expose future or unfinished current sessions',()=>{
 const source=data([row('1130'),row('1500'),row('1500','2026-10-29')]);
 assert.equal(selectChartSession([source],{...options('12:00'),mode:'history',date:today}).minutes.length,1);
 assert.equal(selectChartSession([source],{...options('12:00'),mode:'history',date:'2026-10-29'}).minutes.length,0);
});
test('labels distinguish lunch, missing data, stale retained chart and quote mismatch',()=>{
 const base={now:options('12:00').now,minutes:[row('1130')],quoteDate:today,phase:'lunch'};
 assert.equal(chartSessionNotice(base).label,'午间休市');
 assert.match(chartSessionNotice(base).detail,/截至11:30/);
 assert.match(chartSessionNotice({...base,error:true}).detail,/更新失败，保留同日旧图/);
 assert.match(chartSessionNotice({...base,quoteDate:yesterday}).detail,/报价日期2026-10-27/);
 assert.match(chartSessionNotice({...base,minutes:[]}).detail,/今日分时待数据/);
 assert.doesNotMatch(chartSessionNotice(base).label,/复盘/);
});
