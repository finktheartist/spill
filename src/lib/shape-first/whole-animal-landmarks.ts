import {parsePartId} from '../bricks';
import {connectionPairs,frame} from '../connections';
import type {WholeAnimalLayout,WholeAnimalRole} from '../assembly-composer/animal-whole';
/** Early checks of actual feature geometry in the planner's declared front=-Y
 * frame. These do not accept an animal or replace final body/anatomy/physics or
 * image review. They prevent freezing a backward/off-center face as a prefix. */
export function foxFeatureLandmarks(layout:WholeAnimalLayout){
 if(!layout||!Array.isArray(layout.parts)||!layout.parts.length||layout.parts.length>80)throw Error('Bounded feature geometry required.');
 const ff=layout.parts.map(p=>frame({...p,z:p.z/.4}));let work=0;for(let i=0;i<ff.length;i++)for(let j=0;j<i;j++)work+=ff[i].ports.length*ff[j].ports.length;if(work>8_000_000)throw Error('Feature connector-work budget exceeded.');const cache=new Map(layout.parts.map((p,i)=>[p,ff[i]]));
 const roles=(role:WholeAnimalRole)=>layout.parts.filter(p=>p.role===role),box=(role:WholeAnimalRole)=>{
  const ff=roles(role).map(p=>cache.get(p)!);if(!ff.length)throw Error(`Missing actual ${role} feature.`);
  const min=[0,1,2].map(a=>Math.min(...ff.map(f=>f.bounds.min[a]))/20),max=[0,1,2].map(a=>Math.max(...ff.map(f=>f.bounds.max[a]))/20);if([...min,...max].some(n=>!Number.isFinite(n)))throw Error('Nonfinite feature frame.');return {min,max,size:max.map((n,a)=>n-min[a]),center:max.map((n,a)=>(n+min[a])/2)};
 };
 const head=box('head'),muzzle=box('muzzle'),nose=box('nose'),eyes=[box('eye-left'),box('eye-right')],sym=Math.max(.25,head.size[0]*.08),projection=Math.min(...eyes.map(e=>e.min[1]))-Math.min(muzzle.min[1],nose.min[1]),snoutHeight=Math.max(muzzle.max[2],nose.max[2])-Math.min(muzzle.min[2],nose.min[2]),centerOffset=muzzle.center[0]-head.center[0],issues:string[]=[];
 const n=(x:number)=>Number(x.toFixed(3)),joined=(a:WholeAnimalRole,b:WholeAnimalRole)=>roles(a).some(p=>roles(b).some(q=>connectionPairs(cache.get(p)!,cache.get(q)!).length));
 if(projection<.75-1e-5||projection>Math.max(4,head.size[1]*1.5))issues.push(`Actual snout projection toward FRONT(-y) is ${n(projection)}studs; needs .75–${n(Math.max(4,head.size[1]*1.5))}. Eye-front y=${n(Math.min(...eyes.map(e=>e.min[1])))}, snout-front y=${n(Math.min(muzzle.min[1],nose.min[1]))}. The muzzle must be AHEAD of the eyes, at SMALLER world y.`);
 if(Math.abs(centerOffset)>sym+1e-5)issues.push(`Actual muzzle center x=${n(muzzle.center[0])} is off the head center x=${n(head.center[0])}; maximum offset${n(sym)}. Change the real carrier/attachment to center the complete muzzle. Even-width heads generally need an even-width muzzle unless an actual offset carrier exists.`);
 if(muzzle.size[0]>.8*head.size[0]+1e-5||muzzle.size[0]<.5)issues.push(`Muzzle width${n(muzzle.size[0])} must be .5–${n(head.size[0]*.8)}studs relative to this actual head.`);
 if(snoutHeight>Math.max(1.2,head.size[2]*.85)+1e-5)issues.push(`Snout thickness${n(snoutHeight)} exceeds${n(Math.max(1.2,head.size[2]*.85))}studs; use a thinner real muzzle/nose stack.`);
 if(nose.min[1]>muzzle.min[1]+1e-5)issues.push(`The nose front y=${n(nose.min[1])} is BEHIND muzzle front y=${n(muzzle.min[1])}; put the nose at its actual forward tip(-y).`);
 if(nose.size[0]>Math.min(muzzle.size[0]+1e-5,head.size[0]*.65)||nose.size[1]>1.5+1e-5||nose.size[2]>1.2+1e-5||roles('nose').length>3||roles('nose').some(p=>!['black','dark-gray','dark-brown','dark-blue','dark-green'].includes(parsePartId(p.partId)!.color)))issues.push('Keep a small actual dark nose no wider than its muzzle, at most1.5studs long and1.2studs high.');
 if(eyes.some(e=>e.min[2]<nose.max[2]-.4-1e-5))issues.push(`Actual eyes start at z=${eyes.map(e=>n(e.min[2])).join('/')}, nose top z=${n(nose.max[2])}; eyes need to remain visible above the snout (at least nose top minus .4stud).`);
 if(eyes[1].min[0]-eyes[0].max[0]<.4-1e-5||Math.abs((eyes[0].center[0]+eyes[1].center[0])/2-head.center[0])>sym||Math.abs(eyes[0].center[1]-eyes[1].center[1])>sym||Math.abs(eyes[0].center[2]-eyes[1].center[2])>sym)issues.push('Actual eyes need separated symmetric positions at equal forward depth and height around the head centerline.');
 if(!joined('muzzle','head')||!joined('nose','muzzle')||!joined('eye-left','head')||!joined('eye-right','head'))issues.push('Actual muzzle, nose and both eyes must use their real anatomical carrier joins, not merely touch or mount on an eye/ear.');
 return {issues,measurements:{front:'-y',head,muzzle,nose,eyes,snoutProjection:n(projection),muzzleCenterOffset:n(centerOffset),snoutHeight:n(snoutHeight)}};
}
