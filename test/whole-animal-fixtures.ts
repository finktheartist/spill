// TEST ONLY. Never imported by runtime modules or provider prompts.
import type {WholeAnimalLayout,WholeAnimalRole} from '../src/lib/assembly-composer/animal-whole';
export function authoredWholeAnimalTestLayouts(): WholeAnimalLayout[] {
  return [false, true].map(wide => {
    const parts: WholeAnimalLayout['parts'] = [], brown = 'reddish-brown';
    const put = (role: WholeAnimalRole, partId: string, x: number, y: number, z: number, rot: 0 | 90 | 180 | 270 = 0) => parts.push({ role, partId, x, y, z, rot });
    if (!wide) {
      for (const [y, station] of [[1, 'front'], [4, 'rear']] as const) for (const [x, side] of [[0, 'left'], [3, 'right']] as const) put(`leg-${station}-${side}`, 'roundbrick-1x1-tan', x, y, 0);
      for (const y of [1, 4]) put('frame', `plate-1x4-${brown}`, 0, y, 1.2);
      put('frame', 'plate-2x6-white', 1, 0, 1.6, 90);
      for (const x of [0, 3]) {
        put('chest', `brick-1x2-${brown}`, x, 0, 2, 90);
        put('hips', `brick-1x2-${brown}`, x, 4, 2, 90);
      }
      put('chest', `brick-1x2-${brown}`, 1, 0, 2);
      put('hips', `brick-1x2-${brown}`, 1, 5, 2);
      put('chest', 'plate-2x4-dark-tan', 0, 0, 3.2);
      put('hips', 'plate-2x4-tan', 0, 4, 3.2);
      for (const y of [1, 3]) put('torso', `brick-2x2-${brown}`, 1, y, 2);
      put('torso', 'plate-2x2-dark-tan', 1, 2, 3.2);
      put('torso', `tile-1x2-${brown}`, 1, 2, 3.6);
    } else {
      for (const [y, station] of [[1, 'front'], [6, 'rear']] as const) for (const [x, side] of [[0, 'left'], [4, 'right']] as const)
        for (const z of [0, .4]) put(`leg-${station}-${side}`, `plate-1x2-${brown}`, x, y, z);
      put('frame', `plate-1x6-${brown}`, 0, 1, .8);
      put('frame', 'plate-1x6-tan', 0, 6, .8);
      put('frame', `plate-4x8-${brown}`, 1, 0, 1.2, 90);
      for (const x of [0, 5]) {
        put('chest', `brick-1x2-${brown}`, x, 0, 1.6, 90);
        put('hips', `brick-1x2-${brown}`, x, 6, 1.6, 90);
      }
      put('chest', `brick-1x4-${brown}`, 1, 0, 1.6);
      put('hips', 'brick-1x4-tan', 1, 7, 1.6);
      put('chest', 'plate-2x6-white', 0, 0, 2.8);
      put('hips', 'plate-4x6-tan', 0, 4, 2.8);
      put('torso', `brick-2x6-${brown}`, 2, 1, 1.6, 90);
      put('torso', 'plate-2x2-tan', 2, 2, 2.8);
    }
    const middle = wide ? 2 : 1, rear = wide ? 7 : 5, top = wide ? 3.2 : 3.6;
    put('tail', `plate-2x4-${brown}`, middle, rear, top, 90);
    put('tail', `brick-2x2-${brown}`, middle, rear + 1, top + .4);
    put('tail', 'slope-2x2-white', middle, rear + 3, top + .4, 180);
    put('tail', `tile-2x2-${brown}`, middle, rear + 1, top + 1.6);
    const left = wide ? 1 : 0, base = wide ? 4.4 : 4;
    put('neck', wide ? `invslope-1x2-${brown}` : 'plate-2x2-tan', middle, wide ? 1 : 0, top, wide ? 90 : 0);
    put('head', wide ? 'plate-2x4-white' : 'plate-2x4-tan', left, 0, base);
    put('head', `brick-1x2-${brown}`, left + 1, 1, base + .4);
    for (const x of [left, left + 3]) {
      put('head', `brick-1x2-${brown}`, x, 1, base + .4, 90);
      if (wide) {
        // Real rear socket is .4 stud above the lowest curved face.
        put('head', 'curve-1x2-black', x, -1, base);
        put('head', `plate-1x2-${brown}`, x, 0, base + 1.6, 90);
      } else put('head', 'brick-1x1-medium-nougat', x, 0, base + .4);
    }
    put('head', `plate-1x4-${brown}`, left, wide ? 2 : 1, base + 1.6);
    for (const [x, side] of [[left, 'left'], [left + 3, 'right']] as const) put(`eye-${side}`, 'plate-1x1-dark-gray', x, 0, base + (wide ? 2 : 1.6));
    put('ear-left', 'slope-2x2-black', left, wide ? 2 : 1, base + 2, 90);
    put('ear-right', 'slope-2x2-black', left + 2, wide ? 2 : 1, base + 2, 270);
    const front = wide ? -3 : -2;
    put('muzzle', wide ? `plate-2x4-${brown}` : 'plate-2x3-tan', middle, front, base + .4, 90);
    put('nose', 'plate-1x2-black', middle, front, base + .8);
    put('muzzle', 'plate-1x2-tan', middle, front + 1, base + .8);
    put('muzzle', `plate-1x2-${brown}`, middle, front + 2, base + .8);
    put('muzzle', 'tile-1x2-tan', middle, front + 2, base + 1.2);
    return { id: wide ? 'test-wide-crouching' : 'test-compact-standing', description: 'Independently authored test-only whole Fox; not provider output or visual qualification.', stance: wide ? 'crouching' : 'standing', parts };
  });
}

import type {AssemblyComposition} from '../src/lib/assembly-composer/types';
import type {AnimalBlueprint,AnimalBlueprintRole} from '../src/lib/shape-first/animal-blueprint';
import {frame} from '../src/lib/connections';
/** Derive test-only plan envelopes from independently authored physical fixtures.
 * Production planning must instead occur before all provider placement. */
export function testBlueprint(c:AssemblyComposition):AnimalBlueprint {
 const all=c.build.steps.flatMap(s=>s.parts),byRole=(role:string)=>c.receipts.filter(r=>r.role===role).flatMap(r=>r.indices.map(i=>all[i]));
 const box=(parts:typeof all)=>{const ff=parts.map(frame);return {min:[0,1,2].map(a=>Math.min(...ff.map(f=>f.bounds.min[a]))/20) as [number,number,number],max:[0,1,2].map(a=>Math.max(...ff.map(f=>f.bounds.max[a]))/20) as [number,number,number]};};
 const roles=[...new Set(c.receipts.map(r=>r.role))] as AnimalBlueprintRole[],b=(r:string)=>box(byRole(r)),whole=box(all),body=box(['chest','torso','hips'].flatMap(byRole));
 const near=(n:number):[number,number]=>[Math.max(0,n-.01),n+.01],extent=(p:ReturnType<typeof box>,a:number)=>p.max[a]-p.min[a];
 const compact=c.plan.id.includes('compact'),front=b('leg-front-left'),rear=b('leg-rear-left'),right=b('leg-front-right');
 return {version:1,id:compact?'test-compact-standing':'test-wide-crouching',subject:'Fox',description:'Test-only design intent; never supplied to a provider.',stance:compact?'standing':'crouching',parts:{min:20,max:80},
  size:{min:[0,1,2].map(a=>extent(whole,a)-.01) as [number,number,number],max:[0,1,2].map(a=>extent(whole,a)+.01) as [number,number,number]},
  palette:{coat:['reddish-brown','medium-nougat'],accent:['tan','white','dark-tan'],dark:['black','dark-gray']},
  proportions:{bodyLengthToWidth:near(extent(body,1)/extent(body,0)),headWidthToBody:near(extent(b('head'),0)/extent(body,0)),muzzleProjection:near(b('eye-left').min[1]-b('nose').min[1]),tailProjection:near(b('tail').max[1]-body.max[1]),earRise:near(b('ear-left').max[2]-b('head').max[2])},
  regions:roles.map(role=>({role,...b(role),tolerance:.2,intent:'mass',exterior:true})),
  emptyRegions:[{id:'belly',min:[front.max[0]+.1,front.max[1]+.1,0],max:[right.min[0]-.1,rear.min[1]-.1,Math.min(body.min[2],1)-.1]}],
  features:[{id:'ear-peaks',description:'Two genuine matched sloping ears with their common studded crown.',intent:'pointed-ears',pairing:'identical-id',pieces:[{partId:'slope-2x2-black',count:1,role:'ear-left'},{partId:'slope-2x2-black',count:1,role:'ear-right'}],carriers:[{partId:'plate-1x4-reddish-brown',count:1,role:'head'}]},
   {id:'eyes',description:'Paired actual eye plates on studded head carriers.',intent:'separated-eyes-nose',pairing:'identical-id',pieces:[{partId:'plate-1x1-dark-gray',count:1,role:'eye-left'},{partId:'plate-1x1-dark-gray',count:1,role:'eye-right'}],carriers:[{partId:compact?'brick-1x1-medium-nougat':'plate-1x2-reddish-brown',count:2,role:'head'}]}]};
}
