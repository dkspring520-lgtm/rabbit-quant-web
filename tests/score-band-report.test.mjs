import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {resolveBacktestStrategyExperiment} from '../lib/zijin-strategy-experiments.mjs';

test('empty data produces no trades and explicitly retrospective desk configuration',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'score-band-test-'));
  const file=path.join(dir,'empty.jsonl');
  fs.writeFileSync(file,'');
  try{
    for(const mode of ['standard','zijin-small-spread']){
      const report=JSON.parse(execFileSync(process.execPath,['scripts/backtest-score-bands.mjs',file,'',mode],{encoding:'utf8'}));
      const strategy=resolveBacktestStrategyExperiment('601899','closure-first');
      assert.equal(report.config.profile,strategy.profile);
      assert.equal(report.config.volatilityMode,strategy.volatilityMode);
      assert.equal(report.config.profileOverrides.maxSellEntryTime,'1100');
      assert.equal(report.summary.closedCycles,0);
      assert.equal(report.summary.netYuan,0);
      assert.ok(report.bands.every(band=>band.winRate===null&&band.profitFactor===null));
      assert.ok(report.bands.every(band=>band.split.startsWith('historical-')));
      assert.equal(report.config.minimumNetProfitAmount,mode==='standard'?undefined:30);
    }
    assert.throws(()=>execFileSync(process.execPath,['scripts/backtest-score-bands.mjs',file,'','unknown'],{stdio:'pipe'}));
  }finally{
    fs.unlinkSync(file);fs.rmdirSync(dir);
  }
});

test('published trade ledger reconciles to score bands and respects sell entry window',()=>{
  for(const file of ['score-bands-current.json','score-bands-small-spread.json']){
    const report=JSON.parse(fs.readFileSync(new URL(`../public/research/${file}`,import.meta.url),'utf8'));
    assert.equal(report.summary.closedCycles,report.trades.length);
    assert.equal(report.bands.reduce((sum,band)=>sum+band.n,0),report.trades.length);
    assert.ok(Math.abs(report.trades.reduce((sum,trade)=>sum+trade.net,0)-report.summary.netYuan)<0.01);
    for(const trade of report.trades){
      assert.ok(Math.abs(trade.gross-trade.fees-trade.slippage-trade.net)<0.01);
      if(trade.direction==='反T')assert.ok(trade.entryTime<='1100');
    }
  }
});
