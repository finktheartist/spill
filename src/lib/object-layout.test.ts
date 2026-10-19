import {describe,expect,it} from 'vitest';
import {createObjectTarget,objectLayoutIssues,objectSpec,solveObjectTarget,type ObjectSpec} from './object-layout';
import {constructionIssues} from './construction';
import {compileConnections,connectionPairs,frame} from './connections';
import kit from './fixtures/surface-stock.json';
import photo from '../../test/fixtures/photo-stock.json';
const boat:ObjectSpec={family:'boat',length:8,cabinLength:4,cabinPosition:'aft',roof:'sloped'};
const bust:ObjectSpec={family:'robot-bust',shoulderWidth:6,torsoHeight:6,neckHeight:1,face:'eyes'};
const solve=(spec:ObjectSpec,stock:Record<string,number>=kit.stock)=>{const errors:string[]=[],result=solveObjectTarget(stock,createObjectTarget(spec),errors,1);expect(result,errors.join('\n')).toHaveLength(1);return result[0];};
describe('geometry before allocation',()=>{
 for(const spec of [boat,bust])it(`compiles a stock-bound ${spec.family} with matching interfaces and real assembly instructions`,()=>{
  const c=solve(spec);expect(c.parts).toBeGreaterThanOrEqual(20);expect(c.parts).toBeLessThanOrEqual(60);
  expect(constructionIssues(c.build,kit.stock,24)).toEqual([]);expect(objectLayoutIssues(c.build,c.contract)).toEqual([]);
  expect(Object.values(c.remaining).every(n=>n>=0)).toBe(true);
  expect(compileConnections(c.program,kit.stock).steps.map(s=>s.parts)).toEqual(c.build.steps.map(s=>s.parts));
  expect(c.build.requiredContacts!.length).toBeGreaterThan(4);
 });
 it('rejects a connected cabin that was shifted sideways on the deck',()=>{
  const c=solve({...boat,cabinLength:2,roof:'flat'}),moved=structuredClone(c.build);
  moved.steps.forEach((s,i)=>{if(c.target.regions.find(r=>r.id===c.contract.assignment[i])!.role==='cabin')s.parts.forEach(p=>p.x++);});
  expect(constructionIssues(moved,kit.stock,24)).toEqual([]);
  expect(objectLayoutIssues(moved,c.contract).join(' ')).toContain('frozen space');
 });
 it('rejects a physically connected head that loses its centerline',()=>{
  const c=solve({...bust,neckHeight:3}),moved=structuredClone(c.build);
  moved.steps.forEach((s,i)=>{if(c.target.regions.find(r=>r.id===c.contract.assignment[i])!.role==='head')s.parts.forEach(p=>p.x++);});
  expect(constructionIssues(moved,kit.stock,24)).toEqual([]);
  expect(objectLayoutIssues(moved,c.contract).join(' ')).toContain('frozen space');
 });
 it('refuses to move the target to excuse an invalid assembly',()=>{
  const c=solve(bust),target=structuredClone(c.target),r=target.regions.find(r=>r.id==='head')!;
  if(r.kind==='fill')r.x++;
  expect(()=>solveObjectTarget(kit.stock,target)).toThrow('frozen');
  expect(objectLayoutIssues(c.build,{...c.contract,target})).toContain('The frozen whole-object target was altered.');
 });
 it('uses smaller bricks to fill the same frozen volume when the large bricks are absent',()=>{
  const c=solve(boat),stock={...kit.stock,'brick-2x4-white':0},alternate=solve(boat,stock);
  expect(alternate.target).toEqual(c.target);
  expect(alternate.build.steps.flatMap(s=>s.parts).some(p=>p.partId==='brick-2x4-white')).toBe(false);
  expect(alternate.parts).toBeGreaterThan(c.parts);
  expect(constructionIssues(alternate.build,stock,24)).toEqual([]);
 });
 it('does not fabricate a matching eye, a scarce shell or photo-pile brackets',()=>{
  for(const stock of [{...kit.stock,'roundtile-1x1-white':1},{...kit.stock,'tile-2x2-white':1},photo.stock]){
   const diagnostics:string[]=[];expect(solveObjectTarget(stock,createObjectTarget(bust),diagnostics)).toEqual([]);expect(diagnostics.join(' ')).toMatch(/stock|Missing/);
  }
 });
 it('allows explicit proportion changes while preserving each resulting contract',()=>{
  const a=solve(bust),b=solve({...bust,torsoHeight:9,shoulderWidth:8});
  expect(a.target).not.toEqual(b.target);expect(b.parts).toBeGreaterThan(a.parts);
  expect(objectLayoutIssues(a.build,b.contract).length).toBeGreaterThan(0);
 });
 it('staggers equivalent foundation tilings to connect a longer hull across its bow seam',()=>{
  const c=solve({...boat,length:10});expect(constructionIssues(c.build,kit.stock,24)).toEqual([]);expect(objectLayoutIssues(c.build,c.contract)).toEqual([]);
 });
 it('carries the last side panels through the bow corner without colliding perpendicular mounts',()=>{
  const c=solve(boat),parts=c.build.steps.flatMap(s=>s.parts);
  for(const [side,bowId]of [['port-6','bow-port'],['starboard-6','bow-starboard']]){
   const mount=(id:string)=>parts.find((p,i)=>c.contract.assignment[i]===id&&p.partId.startsWith('bracket-'))!;
   expect(connectionPairs(frame(mount(side)),frame(mount(bowId))).length).toBeGreaterThan(0);
  }
  expect(constructionIssues(c.build,kit.stock,24)).toEqual([]);
 });
 it('keeps symmetry and visor contrast independently of connections',()=>{
  const c=solve(bust),changed=structuredClone(c.build),i=c.contract.assignment.indexOf('eye-0');
  changed.steps[i].parts[0].partId='roundtile-1x1-yellow';
  expect(objectLayoutIssues(changed,c.contract).join(' ')).toContain('matched shapes and palette');
  const dark=structuredClone(c.build),j=c.contract.assignment.lastIndexOf('face');dark.steps[j].parts[0].partId='plate-2x2-white';
  expect(objectLayoutIssues(dark,c.contract).join(' ')).toContain('contrast');
 });
 it('rejects invalid dimensions instead of silently coercing them',()=>{
  for(const length of [9,NaN,Infinity,'8',null])expect(()=>objectSpec('boat',{...boat,length})).toThrow('length');
 });
});
