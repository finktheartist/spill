import {afterEach,describe,expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ScanProgressPanel} from '../components/ScanProgress';
import {SCAN_WAITING_MS,scanActivity,scanDuration,type TimedScan} from './scan-progress';
import type {Tile} from './scan';

const start=1_000_000;
function scan(p:Partial<TimedScan>={}):TimedScan {
 return {photo:1234567890,status:'scanning',startedAt:start,phase:'survey',tiles:[],estimate:0,...p};
}
function tile(state:Tile['state']):Tile {
 return {x:0,y:0,w:500,h:500,core:[0,0,500,500],state};
}
function html(scans:TimedScan[],observed=12):string {
 return renderToStaticMarkup(createElement(ScanProgressPanel,{scans,observed}));
}
afterEach(()=>vi.useRealTimers());

describe('honest scan progress evidence',()=>{
 it('keeps timeout warnings visible after completion without calling skipped checks successful',()=>{
  const s=scan({status:'done',phase:'done',timedOutChecks:2});
  expect(scanActivity(s,start).timedOutChecks).toBe(2);
  expect(html([s])).toContain('2 checks could not finish within the time limit. Finished with the available results.');
  for(const timedOutChecks of [-1,NaN,Infinity,1.5]) expect(scanActivity(scan({timedOutChecks}),start).timedOutChecks).toBe(0);
 });
 it('keeps survey work indeterminate even when a large pile estimate or stale sheets exist',()=>{
  const a=scanActivity(scan({estimate:900,sheets:{done:8,total:8}}),start+20_000);
  expect(a.counts).toBeNull();expect(a.label).toBe('Surveying the photo');expect(a.stage).toBe(0);
  expect(a.elapsedMs).toBe(20_000);expect(a.lastProgressAgeMs).toBeNull();
 });

 it('counts failed sections as processed without describing them as successful coverage',()=>{
  const a=scanActivity(scan({phase:'zoom',tiles:[tile('done'),tile('failed'),tile('looking'),tile('waiting')]}),start);
  expect(a.counts).toEqual({done:2,total:4,unit:'sections'});
  expect(a.sections).toEqual({done:1,failed:1,total:4});
 });

 it('uses real batch totals for close-ups, recounts and angle checks',()=>{
  for(const [phase,unit] of [['check','close-up batches'],['detail','individual checks'],['count','recount batches'],['cross','angle-check batches']] as const){
   expect(scanActivity(scan({phase,sheets:{done:3,total:5}}),start).counts).toEqual({done:3,total:5,unit});
  }
 });

 it('rejects placeholders and malformed batch totals without clamping them into progress',()=>{
  for(const sheets of [{done:0,total:0},{done:-1,total:2},{done:3,total:2},{done:1.5,total:3},{done:1,total:Infinity},{done:NaN,total:4}]){
   expect(scanActivity(scan({phase:'cross',sheets}),start).counts).toBeNull();
  }
 });

 it('never completes the workflow marker from a phase or a full batch counter alone',()=>{
  for(const phase of ['survey','zoom','check','detail','count','cross','done'] as const){
   for(const status of ['scanning','error'] as const){
    const a=scanActivity(scan({phase,status,sheets:{done:9,total:9}}),start);
    expect(a.stage).toBeLessThan(a.stages);
   }
   const done=scanActivity(scan({phase,status:'done'}),start);
   expect(done.stage).toBe(done.stages);
  }
 });

 it('shows waiting at 45 seconds since the last actual event, independently of elapsed time',()=>{
  const s=scan({lastProgressAt:start+60_000});
  expect(scanActivity(s,start+60_000+SCAN_WAITING_MS-1).waiting).toBe(false);
  const a=scanActivity(s,start+60_000+SCAN_WAITING_MS);
  expect(a.waiting).toBe(true);expect(a.elapsedMs).toBe(105_000);expect(a.lastProgressAgeMs).toBe(45_000);
  const refreshed=scanActivity({...s,lastProgressAt:start+104_000},start+105_000);
  expect(refreshed.waiting).toBe(false);expect(refreshed.lastProgressAgeMs).toBe(1000);
 });

 it('does not fabricate a last-event timestamp for old, future or malformed timing records',()=>{
  for(const lastProgressAt of [undefined,NaN,Infinity,start-1,start+70_000]){
   const a=scanActivity(scan({lastProgressAt}),start+60_000);
   expect(a.lastProgressAgeMs).toBeNull();expect(a.elapsedMs).toBe(60_000);expect(a.waiting).toBe(true);
  }
  expect(scanActivity(scan({startedAt:NaN}),start).elapsedMs).toBeNull();
  expect(scanActivity(scan(),start-1).elapsedMs).toBeNull();
 });

 it('freezes terminal recorded duration, retains gaps and never animates an errored scan as active',()=>{
  const s=scan({status:'done',phase:'done',lastProgressAt:start+8_000,tiles:[tile('failed')]});
  expect(scanActivity(s,start+500_000)).toMatchObject({active:false,waiting:false,elapsedMs:8000,sections:{failed:1}});
  expect(scanActivity({...s,lastProgressAt:undefined},start+500_000).elapsedMs).toBeNull();
  expect(scanActivity({...s,status:'error',phase:'check'},start+500_000)).toMatchObject({active:false,waiting:false,label:'Scan stopped · Checking pieces up close'});
 });

 it('formats elapsed time without a finish-time estimate or a fractional countdown',()=>{
  expect([0,59_999,60_000,123_999,3_661_000,-1,NaN].map(scanDuration)).toEqual(['0s','59s','1m 0s','2m 3s','1h 1m','0s','0s']);
 });

 it('renders a native indeterminate survey bar and no fake percentage, raw photo ID or ETA',()=>{
  vi.useFakeTimers();vi.setSystemTime(start+20_000);
  const rendered=html([scan()]);
  const bar=rendered.match(/<progress\b[^>]*>/)?.[0];
  expect(bar).toBeDefined();expect(bar).not.toMatch(/\bvalue=/);
  expect(rendered).toContain('Activity indicator only');expect(rendered).toContain('Elapsed 20s');
  expect(rendered).toContain('Photo 1');expect(rendered).not.toContain('1234567890');
  expect(rendered.replace(/<[^>]*>/g,'')).not.toMatch(/\d+%/);expect(html([])).toBe('');
 });

 it('renders processed counts, failures and incomplete receipts without claiming confirmed stock or success',()=>{
  vi.useFakeTimers();vi.setSystemTime(start+20_000);
  const rendered=html([
   scan({phase:'zoom',tiles:[tile('done'),tile('failed'),tile('waiting')]}),
   scan({photo:2,status:'done',phase:'check',sheets:{done:1,total:2},lastProgressAt:start+10_000}),
   scan({photo:3,status:'error',phase:'check',error:'<transport failed>'}),
  ]);
  expect(rendered).toContain('2 of 3 sections processed');expect(rendered).toContain('1 of 3 photo sections failed');
  expect(rendered).toContain('1 of 2 close-up batches processed');
  expect(rendered).toMatch(/max="2" value="1"/);
  expect(rendered).toContain('Processed batches can include failed checks');
  expect(rendered).toContain('&lt;transport failed&gt;');expect(rendered).toContain('This scan did not finish');
  expect(rendered).toContain('12 pieces observed');expect(rendered).toContain('1 of 3 photo scans finished');
 });

 it('renders silence honestly with or without recorded events and leaves input evidence untouched',()=>{
  vi.useFakeTimers();vi.setSystemTime(start+60_000);
  const s=Object.freeze(scan({lastProgressAt:start+15_000})),before=JSON.stringify(s);
  expect(html([s])).toContain('No new progress event for 45s');
  expect(html([scan()])).toContain('progress-event timing is unavailable');
  expect(html([s])).toContain('elapsed clock is not evidence of model progress');
  expect(JSON.stringify(s)).toBe(before);
 });
});
