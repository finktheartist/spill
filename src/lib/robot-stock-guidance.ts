import { footprint, parsePartId } from './bricks';

/** Module planner summary; counts only, with no target or candidate construction. */
export function robotModuleStockGuidance(stock:Record<string,number>):string {
 const paired=Object.entries(stock).flatMap(([id,n])=>{const k=parsePartId(id);return k&&n>=2&&['brick','plate','tile'].includes(k.type)&&k.w<=2&&k.d<=4?[`${id}: ${Math.floor(n/2)} matching pairs`]:[];});
 const slopes=Object.entries(stock).filter(([id,n])=>n>0&&id.startsWith('slope-2x2-')).map(([id,n])=>`${id}: ${n}`);
 return `Stock capacity bounds for modular construction (counts only; no allocation yet):
${paired.join('; ')}.
Central sloped breastplate stock: ${slopes.join('; ')||'none; choose layered torso'}.
For exposed-contour designs inspect all 1x2 slopes (hip pair), 2x2 slopes (shoulder pair), 2x2 inverted slopes (belly), 1x3 curves (two crown strips), and cheese slopes (chest pair) in the exact table. Hip/shoulder shells may use different colors; chest chamfers still require a matching pair. Count-only shaping stock: ${Object.entries(stock).filter(([id,n])=>n>0&&/^(slope|invslope|curve|cheese)-/.test(id)).map(([id,n])=>`${id}: ${n}`).join('; ')}.
Use different coherent colors for different modules; all arms and legs need not share one color. Mirrored limb regions use matching copies. Thin joints, palm hands and shoulder pads compete for small plates. Grippers need four 1x2 finger bricks and two 1x3 bridges; palm hands need two 2x2 plates. Flat head casing reserves a matching pair of plates (2x3 for visor or 2x4 for sensor); curved heads use a 2x3 base and two actual curved crown pieces. Reaching forearms can use two 1x4 bricks OR six stacked 1x4 plates. Full parts can also be replaced with connected smaller constructions, but these counts do not guarantee a complete solution. Start with seven-plate legs unless the inventory supports a taller frame.`;
}

/** Necessary material bounds only: no tiling, allocation, candidate or Build creation.
 * Counts only complete pairs because the current compiler mirrors every limb layer.
 * These are optimistic capacities, not proof that a target can be assembled. */
export function robotStockGuidance(stock:Record<string,number>):string {
 const rows=[2,3].map(depth=>{
  const area:Record<string,{limbs:number;arms:number}>={};
  for(const [id,count]of Object.entries(stock)){
   const k=parsePartId(id);if(!k||k.type!=='brick'||!Number.isSafeInteger(count)||count<2)continue;
   const fits=(width:number)=>[0,90].some(rot=>{const f=footprint(k,rot);return f.fw<=width&&f.fd<=depth;});
   if(!fits(2))continue;
   const n=2*Math.floor(count/2)*k.w*k.d,a=area[k.color]??={limbs:0,arms:0};a.limbs+=n;if(fits(1))a.arms+=n;
  }
  return `depth ${depth}: ${Object.entries(area).sort((a,b)=>b[1].limbs-a[1].limbs).map(([c,a])=>`${c}: total limb area ${a.limbs}, of which arm-compatible ${a.arms}`).join('; ')||'no paired brick stock'}`;
 });
 return `Stock capacity bounds for the current robot compiler (counts only; no pieces have been allocated):
Arms and legs currently share ONE color. For chosen depth d, the paired legs need 4*d*(legHeight/3) brick-layer stud area and paired arms need 2*d*(armHeight/3). Their SUM must fit within one color's total limb area below. The arm requirement must also fit within that same color's arm-compatible area; that area is included in, not additional to, the total. Other body parts also need stock. These optimistic bounds cannot guarantee a valid tiling or complete build.
${rows.join('\n')}
Design within these material limits. Do not make the robot deeper or longer merely to address a visual criticism if the corresponding limb material is absent.`;
}
