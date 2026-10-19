import type {Scan} from '../screens/Parts';

/** Optional until the scan owner records every progress/status callback timestamp. */
export type TimedScan=Scan&{lastProgressAt?:number};
export const SCAN_WAITING_MS=45_000;

export interface ScanActivity {
 active:boolean;
 label:string;
 stage:number;
 stages:number;
 counts:{done:number;total:number;unit:string}|null;
 sections:{done:number;failed:number;total:number};
 elapsedMs:number|null;
 lastProgressAgeMs:number|null;
 waiting:boolean;
 timedOutChecks:number;
}

const labels:Record<Scan['phase'],string>={
 survey:'Surveying the photo',zoom:'Looking closer at sections',check:'Checking pieces up close',
 detail:'Taking a closer look at uncertain pieces',count:'Recounting large pieces',cross:'Checking another angle',done:'Finishing the scan',
};
// Ordinal stages only: optional section/recount work can be skipped. Not a work/time percentage.
const stages:Record<Scan['phase'],number>={survey:0,zoom:1,check:2,detail:3,count:4,cross:0,done:4};
const count=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const time=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;

/** Derives display evidence without estimating model work from elapsed time or piece estimates. */
export function scanActivity(scan:TimedScan,now:number):ScanActivity {
 const active=scan.status==='scanning';
 const sections={done:scan.tiles.filter(t=>t.state==='done').length,failed:scan.tiles.filter(t=>t.state==='failed').length,total:scan.tiles.length};
 let counts:ScanActivity['counts']=null;
 if(scan.phase==='zoom'&&sections.total>0){
  counts={done:sections.done+sections.failed,total:sections.total,unit:'sections'};
 }else if(['check','detail','count','cross'].includes(scan.phase)&&scan.sheets){
  const {done,total}=scan.sheets;
  // A zero total can be a placeholder before work is discovered, especially for angle checks.
  if(count(done)&&count(total)&&total>0&&done<=total)counts={done,total,unit:scan.phase==='detail'?'individual checks':scan.phase==='cross'?'angle-check batches':scan.phase==='count'?'recount batches':'close-up batches'};
 }
 const validNow=time(now),validStart=time(scan.startedAt)&&validNow&&scan.startedAt<=now;
 const validLast=time(scan.lastProgressAt)&&validStart&&scan.lastProgressAt>=scan.startedAt&&scan.lastProgressAt<=now;
 const lastProgressAgeMs=validLast?now-scan.lastProgressAt!:null;
 // A terminal record without an end/event timestamp has no measured duration. Do not keep its clock running.
 const elapsedMs=validStart&&(active||validLast)?(active?now:scan.lastProgressAt!)-scan.startedAt:null;
 const waiting=active&&(lastProgressAgeMs??elapsedMs??0)>=SCAN_WAITING_MS;
 const totalStages=scan.phase==='cross'?1:5;
 return {active,label:scan.status==='done'?'Scan finished':scan.status==='error'?`Scan stopped · ${labels[scan.phase]}`:labels[scan.phase],
  stage:scan.status==='done'?totalStages:stages[scan.phase],stages:totalStages,counts,sections,elapsedMs,lastProgressAgeMs,waiting,
  timedOutChecks:count(scan.timedOutChecks)?scan.timedOutChecks:0};
}

export function scanDuration(ms:number):string {
 const seconds=Math.floor(Math.max(0,Number.isFinite(ms)?ms:0)/1000);
 if(seconds<60)return `${seconds}s`;
 const minutes=Math.floor(seconds/60),rest=seconds%60;
 if(minutes<60)return `${minutes}m ${rest}s`;
 return `${Math.floor(minutes/60)}h ${minutes%60}m`;
}
