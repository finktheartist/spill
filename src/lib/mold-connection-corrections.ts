import type {PopularMold,MoldPrism,MoldXY} from './popular-mold-types';

// Source top-surface samples from 93606s01.dat's 48/1-12 cylinder. The
// underside is flat for the first two rows, then steps up by 8 LDU per row.
// Section convexification had pulled the lower face across each step, filling
// real clearance above ordinary studs. Keep the three actual seating levels.
const roof:readonly MoldXY[]=[[0,4.000098],[18.768,12.6418467],[28.68,15.7761597],[38.592,18.9104727],[59.12,22.7164242],[69.56,23.3582121],[80,24]];
function roofAt(y:number):number {
 const b=roof.findIndex(p=>p[0]>=y);
 if(b===0)return roof[0][1];
 const a=roof[b-1],c=roof[b];
 return a[1]+(c[1]-a[1])*(y-a[0])/(c[0]-a[0]);
}
const steppedBody:readonly MoldPrism[]=Object.freeze(([0,20,40,60] as const).map(lo=>{
 const hi=lo+20,bottom=lo<40?0:lo===40?8:16;
 const upper:readonly MoldXY[]=[[lo,roofAt(lo)],...roof.filter(p=>p[0]>lo&&p[0]<hi),[hi,roofAt(hi)]];
 const polygon=Object.freeze(([[lo,bottom],[hi,bottom],...upper.slice().reverse()] as MoldXY[]).map(p=>Object.freeze(p)));
 return Object.freeze({axis:'x' as const,min:0,max:40,polygon});
}));

/** Corrections to qualified connection frames, retaining raw source geometry.
 * 93606s01.dat has a normal 2x2 clutch cavity at source Y=24,
 * X/Z bounds +/-20 and Z=-40..0, around its central stud4a tube.
 * Its four ordinary stud seats transform to x/y=10,30 at local z=0.
 * The automated three-wall detector retained the center tube seat but missed
 * those four corner seats. Raised seats and source rendering stay unchanged.
 */
export function correctMoldConnections(m:PopularMold):PopularMold {
 if(m.num!=='93606')return m;
 const ports=[...m.ports];
 for(const x of [10,30])for(const y of [10,30]){
  if(ports.some(p=>p.kind==='grip'&&p.point[0]===x&&p.point[1]===y&&p.point[2]===0))continue;
  ports.push(Object.freeze({id:`grip:front:${x}:${y}`,kind:'grip' as const,point:Object.freeze([x,y,0] as const),normal:Object.freeze([0,0,-1] as const)}));
 }
 return Object.freeze({...m,solids:steppedBody,hulls:Object.freeze([]),ports:Object.freeze(ports),limitations:Object.freeze([...m.limitations,'Four front 2x2 ordinary underside seats restored; collision preserves the source underside steps at 0, 8 and 16 LDU instead of convexifying across their boundaries.'])});
}
