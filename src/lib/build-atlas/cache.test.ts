import {afterEach,expect,it,vi} from 'vitest';
import type {Build} from '../bricks';
import {constructionIssues} from '../construction';
import {libraryVerdictQualifies,safeSavedBuild} from '../library-discoveries';
import type {ShapeSlot} from '../shape-first/run';
import type {WholeModelReview} from '../shape-first/whole-model-review';
import {BUILD_ATLAS} from './catalog';
import {saveAtlasDesign} from './cache';

const stock={'plate-1x1-tan':20},brief=BUILD_ATLAS[0];
// Physically legal storage fixture only; mocked scores are not craft evidence.
const build:Build={name:'Cache boundary fixture',description:'Synthetic persistence regression',engine:'connections-v2',steps:Array.from({length:20},(_,z)=>({caption:'Attach',parts:[{partId:'plate-1x1-tan',x:0,y:0,z,rot:0}]}))};
function slot():ShapeSlot {
 return {key:'cache-test',phase:'ready',startedAt:0,log:[],build:structuredClone(build),
  idea:{name:brief.name,pitch:'Storage boundary fixture',why:'Test only',length:1,width:1,height:8,palette:[],worst:1,cells:20,shortfall:0,atlas:{briefId:brief.id,approachId:brief.approaches[0].id}},
  verdict:{looksLike:brief.name,recognizable:4,complete:4,colors:4,impressive:4,named:true,pass:true,fixes:[]}};
}
function critical(pass:boolean):WholeModelReview {
 return {features:[{role:'main form',observation:'Visible main form',blocking:false,fix:'No correction'},{role:'roof',observation:'Visible roof',blocking:false,fix:'No correction'}],
  massing:{observation:'Visible massing',blocking:false,fix:'No correction'},
  support:{observation:pass?'Resolved foundation':'Lonely exposed rear support',blocking:!pass,fix:pass?'No correction':'Rebuild the foundation'},pass,fixes:pass?[]:['Rebuild the foundation']};
}
function storageBoundary(){
 const digest=vi.fn(async()=>new ArrayBuffer(32)),open=vi.fn(()=>{throw Error('Deliberately unavailable test storage');});
 vi.stubGlobal('crypto',{subtle:{digest}});vi.stubGlobal('indexedDB',{open});return {digest,open};
}
afterEach(()=>vi.unstubAllGlobals());

it('rejects an explicitly failed shape verdict despite all-four blind scores, before hashing/storage',async()=>{
 const s=slot(),{digest,open}=storageBoundary();
 expect(safeSavedBuild(s.build)).toBe(true);expect(constructionIssues(build,stock,24)).toEqual([]);
 expect(libraryVerdictQualifies({...s.verdict!,review:'blind-v1',subjectMatched:true})).toBe(true);
 s.verdict!.pass=false;s.craftReview=critical(false);
 expect(await saveAtlasDesign(s,stock)).toEqual({status:'rejected'});
 expect(digest).not.toHaveBeenCalled();expect(open).not.toHaveBeenCalled();
});

it('requires the shape pass even when no separate craft review was attached',async()=>{
 const s=slot(),{digest,open}=storageBoundary();s.verdict!.pass=false;
 expect(await saveAtlasDesign(s,stock)).toEqual({status:'rejected'});
 expect(digest).not.toHaveBeenCalled();expect(open).not.toHaveBeenCalled();
});

it('rejects a failed critical review independently of an inconsistent true shape pass',async()=>{
 const s=slot(),{digest,open}=storageBoundary();s.craftReview=critical(false);
 expect(await saveAtlasDesign(s,stock)).toEqual({status:'rejected'});
 expect(digest).not.toHaveBeenCalled();expect(open).not.toHaveBeenCalled();
});

it.each([false,true])('preserves storage eligibility for a passing slot with craft review present=%s',async present=>{
 const s=slot(),{digest,open}=storageBoundary();if(present)s.craftReview=critical(true);
 // Deliberately unavailable storage distinguishes reaching persistence from a
 // quality rejection; no fake successful IndexedDB write is asserted.
 expect(await saveAtlasDesign(s,stock)).toEqual({status:'unavailable'});
 expect(digest).toHaveBeenCalledOnce();expect(open).toHaveBeenCalledOnce();
});
