import {describe,expect,it} from 'vitest';
import {animalReplanSpecs,animalAnatomyIssues,animalShapeKey,animalSpec,createAnimalTarget,solveAnimalTarget,type AnimalSpec} from './animal-anatomy';
import {compileConnections,connectionPairs,frame} from './connections';
import {constructionIssues} from './construction';
import {connectionGeometryKey} from './connection-revision';
import kit from './fixtures/large-pile-stock.json';
import small from './fixtures/small-pile-stock.json';
const base:AnimalSpec={bodyLength:8,legHeight:4,neckHeight:0,body:'lean',muzzle:2,head:'narrow',face:'sloped',ears:'drop',legs:'slender',tail:'low',color:'reddish-brown',accent:'tan'};
const specimens:AnimalSpec[]=[base,{...base,bodyLength:6,muzzle:1,body:'full',ears:'curved',tail:'stub'},{...base,bodyLength:8,legHeight:7,muzzle:1,neckHeight:1},{...base,bodyLength:6,legHeight:1,muzzle:1,body:'full',ears:'alert',tail:'stub'},{...base,bodyLength:10,face:'stepped',legs:'solid'}];
describe('frozen animal anatomy',()=>{
 it('assembles five genuinely distinct stock-valid shapes, with replayable programs',()=>{
  const stock=structuredClone(kit.stock),shapes=new Set<string>(),geometry=new Set<string>();
  for(const spec of specimens){const target=createAnimalTarget(spec),diagnostics:string[]=[],c=solveAnimalTarget(stock,target,diagnostics)[0];expect(c,diagnostics.join('\n')).toBeDefined();
   expect(animalAnatomyIssues(c.build,c.contract)).toEqual([]);expect(constructionIssues(c.build,stock,24)).toEqual([]);
   expect(connectionGeometryKey(compileConnections(c.program,stock))).toBe(connectionGeometryKey(c.build));
   expect(c.program.operations.length).toBeGreaterThanOrEqual(20);expect(c.program.operations.length).toBeLessThanOrEqual(60);
   expect(Object.values(c.remaining).every(n=>n>=0)).toBe(true);shapes.add(animalShapeKey(spec));geometry.add(connectionGeometryKey(c.build));
  }
  expect(shapes.size).toBe(5);expect(geometry.size).toBe(5);expect(stock).toEqual(kit.stock);
 });
 it('substitutes smaller pieces inside the same frozen body without borrowing stock',()=>{
  const spec={...base,body:'full' as const},target=createAnimalTarget(spec),full=solveAnimalTarget(kit.stock,target)[0];
  expect(full).toBeDefined();const stock={...kit.stock,'brick-2x6-reddish-brown':0,'brick-1x8-reddish-brown':0};
  const candidate=solveAnimalTarget(stock,target)[0];expect(candidate).toBeDefined();expect(candidate.target).toEqual(full.target);expect(constructionIssues(candidate.build,stock,24)).toEqual([]);
  expect(candidate.program.operations.some(op=>op.partId==='brick-2x6-reddish-brown'||op.partId==='brick-1x8-reddish-brown')).toBe(false);
 });
 it('reserves scarce profiles for anatomy and rejects a third curve rather than inventing one',()=>{
  const diagnostics:string[]=[];expect(solveAnimalTarget(kit.stock,createAnimalTarget({...base,ears:'curved',tail:'low'}),diagnostics)).toEqual([]);expect(diagnostics.join(' ').toLowerCase()).toContain('stock');
  const c=solveAnimalTarget(kit.stock,createAnimalTarget(specimens[1]))[0];expect(c.program.operations.filter(p=>p.partId==='curve-1x2-black')).toHaveLength(2);
 });
 it('rejects missing eyes, unsupported dimensions and altered target receipts',()=>{
  expect(solveAnimalTarget({...kit.stock,'plate-1x1-dark-gray':0},createAnimalTarget(base))).toEqual([]);
  expect(()=>animalSpec({...base,bodyLength:100})).toThrow('bodyLength');
  const target=createAnimalTarget(base);target.regions[0].x+=1;expect(()=>solveAnimalTarget(kit.stock,target)).toThrow('altered');
 });
 it('checks actual shape, pair equality, grounded paws and interfaces after edits',()=>{
  const c=solveAnimalTarget(kit.stock,createAnimalTarget(base))[0];
  for(const id of ['paw-front-far','eye-1','jaw','forehead']){const build=structuredClone(c.build),i=c.contract.assignment.indexOf(id);build.steps[i].parts[0].z+=1;expect(animalAnatomyIssues(build,c.contract).length).toBeGreaterThan(0);}
  const bad=structuredClone(c);bad.contract.assignment[0]='invented';expect(animalAnatomyIssues(bad.build,bad.contract)).toContain('An unplanned animal region was added.');
 });
 it('palette changes do not masquerade as new anatomical shapes',()=>{expect(animalShapeKey(base)).toBe(animalShapeKey({...base,color:'dark-azure'}));expect(animalShapeKey(base)).not.toBe(animalShapeKey({...base,bodyLength:6}));});
 it('supports the broad face with real stock and faces the front camera',()=>{
  const spec={...base,head:'broad' as const,bodyLength:6 as const,body:'full' as const,muzzle:1 as const,ears:'curved' as const,tail:'stub' as const};
  const c=solveAnimalTarget(kit.stock,createAnimalTarget(spec))[0];expect(c).toBeDefined();expect(animalAnatomyIssues(c.build,c.contract)).toEqual([]);
  const parts=c.build.steps.flatMap(s=>s.parts),region=(id:string)=>parts[c.contract.assignment.indexOf(id)],nose=frame(region('nose')).bounds,jaw=frame(region('jaw')).bounds;
  expect(nose.max[1]).toBeLessThanOrEqual(jaw.min[1]+.01);expect(c.contract.heading).toBe(90);
 });
 it('bounds the local search',()=>{expect(()=>solveAnimalTarget(kit.stock,createAnimalTarget(base),[],1,-1)).toThrow('timed out');});
});

describe('mixed small-pile anatomy',()=>{
 const base:AnimalSpec={back:'sloped',bodyLength:6,head:'narrow',body:'full',accent:'tan',ears:'curved',legHeight:3,neckHeight:0,muzzle:1,face:'sloped',legs:'slender',tail:'stub',color:'dark-azure',feet:'round',frame:'deep',palette:'family'};
 it('builds distinct proportions from the fresh 96-piece scan with no added stock',()=>{
  const original=structuredClone(small.stock),shapes=new Set<string>();
  for(const spec of [base,{...base,bodyLength:8 as const},{...base,bodyLength:8 as const,body:'lean' as const}]){
   const diagnostics:string[]=[],c=solveAnimalTarget(small.stock,createAnimalTarget(spec),diagnostics)[0];expect(c,diagnostics.join('\n')).toBeDefined();
   expect(animalAnatomyIssues(c.build,c.contract)).toEqual([]);expect(constructionIssues(c.build,small.stock,24)).toEqual([]);expect(connectionGeometryKey(compileConnections(c.program,small.stock))).toBe(connectionGeometryKey(c.build));
   expect(c.program.operations.length).toBeGreaterThanOrEqual(20);expect(Object.values(c.remaining).every(n=>n>=0)).toBe(true);shapes.add(connectionGeometryKey(c.build));
   const used=c.program.operations.map(p=>p.partId);expect(used.filter(id=>id==='roundbrick-1x1-tan')).toHaveLength(4);expect(used).toContain('roundendplate-1x2-reddish-brown');
  }
  expect(shapes.size).toBe(3);expect(small.stock).toEqual(original);
 });
 it('rejects incompatible feet, altered profiles and unavailable rounded plates',()=>{
  expect(()=>animalSpec({...base,legHeight:4})).toThrow('Round feet');expect(()=>animalSpec({...base,frame:'invented'})).toThrow('frame');
  const c=solveAnimalTarget(small.stock,createAnimalTarget(base))[0],bad=structuredClone(c.build),i=c.contract.assignment.indexOf('rump');bad.steps[i].parts[0].partId='brick-1x2-dark-azure';expect(animalAnatomyIssues(bad,c.contract).length).toBeGreaterThan(0);
  expect(constructionIssues(c.build,{...small.stock,'roundendplate-1x2-reddish-brown':0},24).some(i=>i.kind==='inventory')).toBe(true);
 });
});

it('offers explicit bounded anatomy replans after a failed broad face',()=>{
 const spec:AnimalSpec={back:'sloped',bodyLength:6,head:'broad',body:'full',accent:'tan',ears:'curved',legHeight:3,neckHeight:0,muzzle:1,face:'sloped',legs:'slender',tail:'stub',color:'dark-azure',feet:'round',frame:'deep',palette:'family'},original=structuredClone(spec);
 const target=createAnimalTarget(spec);expect(solveAnimalTarget(small.stock,target)).toEqual([]);
 const neighbors=animalReplanSpecs(spec,'Shared stock exhausted at cheek-3');expect(neighbors.length).toBeLessThanOrEqual(3);expect(neighbors[0].head).toBe('narrow');expect(solveAnimalTarget(small.stock,createAnimalTarget(neighbors[0])).length).toBe(1);expect(spec).toEqual(original);expect(target).toEqual(createAnimalTarget(original));
});

it('mounts narrow and broad curved ears through lower sockets instead of imaginary flat rear sockets',()=>{
 for(const spec of [specimens[1],{...specimens[1],head:'broad' as const}]){
  const diagnostics:string[]=[],c=solveAnimalTarget(kit.stock,createAnimalTarget(spec),diagnostics)[0];expect(c,diagnostics.join('\n')).toBeDefined();
  const parts=c.build.steps.flatMap(s=>s.parts),tie=c.contract.assignment.indexOf('ear-tie');
  for(const id of ['ear-0','ear-3']){
   expect(c.target.regions.find(r=>r.id===id)!.rotations).toEqual([270]);
   const ear=c.contract.assignment.indexOf(id),f=frame(parts[ear]),low=f.ports.find(p=>p.id==='grip:0:0')!,high=f.ports.find(p=>p.id==='grip:0:1')!;
   expect(high.point[2]-low.point[2]).toBe(8);
   const mounts=connectionPairs(frame(parts[tie]),f).map(([,grip])=>grip);
   expect(mounts).toContain('grip:0:0');expect(mounts).not.toContain('grip:0:1');
  }
  expect(animalAnatomyIssues(c.build,c.contract)).toEqual([]);expect(constructionIssues(c.build,kit.stock,24)).toEqual([]);
 }
});

it('packs real curved tails by their nominal regions while preserving their underside cutouts',()=>{
 for(const tail of ['low','raised'] as const){
  const diagnostics:string[]=[],c=solveAnimalTarget(kit.stock,createAnimalTarget({...base,tail}),diagnostics)[0];expect(c,diagnostics.join('\n')).toBeDefined();
  const parts=c.build.steps.flatMap(s=>s.parts),f=frame(parts[c.contract.assignment.indexOf('tail')]);
  const volume=(b:typeof f.bounds)=>[0,1,2].reduce((v,a)=>v*(b.max[a]-b.min[a]),1);
  expect(f.solids.reduce((n,s)=>n+volume(s.bounds),0)).toBeLessThan(volume(f.bounds));
  expect(animalAnatomyIssues(c.build,c.contract)).toEqual([]);expect(constructionIssues(c.build,kit.stock,24)).toEqual([]);
  expect(Object.values(c.remaining).every(n=>n>=0)).toBe(true);
 }
});

it('rejects duplicate nominal envelopes even when their volume hides an equal-sized anatomical gap',()=>{
 const c=structuredClone(solveAnimalTarget(kit.stock,createAnimalTarget(base))[0]),assignment=c.contract.assignment;
 const parts=c.build.steps.flatMap(s=>s.parts),boxes=parts.flatMap((p,i)=>assignment[i]==='skull-back'?[frame(p).bounds]:[]);
 const min=[0,1,2].map(a=>Math.min(...boxes.map(b=>b.min[a])));
 const retained=c.build.steps.flatMap((step,i)=>assignment[i]==='skull-back'?[]:[{step,region:assignment[i]}]);
 const replacement=Array.from({length:2},()=>({step:{caption:'Invalid duplicate concealing a gap.',parts:[{partId:'brick-1x1-reddish-brown',x:min[0]/20,y:min[1]/20,z:min[2]/8,rot:90}]},region:'skull-back'}));
 const entries=[...retained,...replacement];c.build.steps=entries.map(e=>e.step);c.contract.assignment=entries.map(e=>e.region);
 const issues=animalAnatomyIssues(c.build,c.contract);
 expect(issues).toContain('skull-back: nominal part envelopes overlap instead of tiling the anatomy.');
 expect(issues).not.toContain('skull-back: a gap or excess in the planned anatomy.');
 expect(issues).toContain('Invalid physical animal assembly.');
});
