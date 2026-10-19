import {expect,it} from 'vitest';
import {createRobotTarget,exteriorContour,silhouetteFit} from './robot-silhouette';
import {DEFAULT_ROBOT_MODULES,zoneBox} from './robot-module-shapes';
import {robotBodyIssues,solveRobotTarget} from './robot-body-plan';
import {partContours,targetZoneContours,targetZoneSurface} from './robot-contours';
import {constructionIssues} from './construction';
import {frame} from './connections';
import {curvedPart} from './curved-parts';
import photo from '../../test/fixtures/photo-stock.json';
const target=createRobotTarget(DEFAULT_ROBOT_MODULES),solutions=solveRobotTarget(photo.stock,target);
it('gives the stock-fitted robot actual curved and diagonal exterior profiles in both views',()=>{
 const exterior=exteriorContour(target);expect(exterior.issues).toEqual([]);expect(exterior.roles).toEqual(['head','hips','shoulders','torso']);
 expect(solutions.length).toBeGreaterThan(0);
 for(const c of solutions){expect(constructionIssues(c.build,photo.stock,24)).toEqual([]);expect(robotBodyIssues(c.build,c.contract)).toEqual([]);expect(silhouetteFit(c.build,target,c.contract.roles).issues).toEqual([]);expect(c.build.steps.length).toBeGreaterThanOrEqual(20);}
});
it('rejects the previous box silhouette even though it has a central decorative slope',()=>{
 const old=createRobotTarget({...DEFAULT_ROBOT_MODULES,torsoProfile:'tapered',shoulderProfile:'stepped',headStyle:'visor'});
 expect(exteriorContour(old)).toMatchObject({frontEdge:0,sideEdge:0,roles:[]});expect(exteriorContour(old).issues.length).toBeGreaterThan(0);
});
it('does not credit contours hidden behind rectangular backing',()=>{
 const hidden=structuredClone(target);for(const zone of target.zones!){hidden.zones!.push({...zone,id:zone.id+'.backing',types:['brick'],profile:undefined,rotations:undefined});}
 expect(exteriorContour(hidden)).toMatchObject({frontEdge:0,sideEdge:0,roles:[]});
});
it('draws real curved surfaces and undercuts instead of their collision boxes',()=>{
 const crown=target.zones!.find(z=>z.id==='head.crown.left')!,belly=target.zones!.find(z=>z.id==='abdomen')!;
 const volume=(bs:ReturnType<typeof targetZoneContours>)=>bs.reduce((sum,b)=>sum+[0,1,2].reduce((n,i)=>n*(b.max[i]-b.min[i]),1),0);
 expect(volume(targetZoneContours(crown))).toBeLessThan(volume([zoneBox(crown)]));expect(volume(targetZoneContours(belly))).toBeLessThan(volume([zoneBox(belly)]));
 // Source facets and the raised rear underside matter; an arbitrary number of
 // samples on the old generic quadratic does not establish the real shape.
 const curve=curvedPart({type:'curve',w:1,d:3})!;
 expect(targetZoneSurface(crown)).toEqual(expect.arrayContaining([0,20].flatMap(x=>curve.profile.map(([y,z])=>[crown.x*20+x,crown.y*20+y,crown.z*8+z]))));
 expect(targetZoneContours(crown)).toEqual(partContours({partId:'curve-1x3-white',x:crown.x,y:crown.y,z:crown.z,rot:0}));
 const c=solutions[0],index=c.contract.features!.assignment.indexOf('head.crown.left'),p=c.build.steps.flatMap(s=>s.parts)[index];expect(volume(partContours(p))).toBeLessThan(volume([frame(p).bounds]));
});
it('requires the specified exterior shaping parts and never invents unavailable hardware',()=>{
 for(const prefix of ['curve-','invslope-','slope-2x2-']){const stock={...photo.stock} as Record<string,number>;for(const id of Object.keys(stock))if(id.startsWith(prefix))delete stock[id];const d:string[]=[];expect(solveRobotTarget(stock,target,d)).toEqual([]);expect(d.length).toBeGreaterThan(0);}
 for(const c of solutions)expect(c.build.steps.flatMap(s=>s.parts).some(p=>/^(bracket|sidebrick|jumper)-/.test(p.partId))).toBe(false);
});
it('detects loss of the curved helmet profile when it is replaced with a rectangular brick',()=>{
 const c=structuredClone(solutions[0]),i=c.contract.features!.assignment.indexOf('head.crown.left'),p=c.build.steps.flatMap(s=>s.parts)[i];p.partId='brick-1x3-white';
 expect(robotBodyIssues(c.build,c.contract).some(s=>s.includes('shaping technique'))).toBe(true);
});
