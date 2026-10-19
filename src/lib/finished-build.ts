import { partCount, type Build } from './bricks';

/** A floor for finished models, not for internal construction modules or workbench drafts. */
export const MIN_FINISHED_PARTS = 20;
export const finishedSizeIssue = (build: Build): string | undefined => partCount(build) < MIN_FINISHED_PARTS
  ? `This draft uses ${partCount(build)} pieces. Finished builds need at least ${MIN_FINISHED_PARTS} pieces with purposeful structure and detail.`
  : undefined;

export const DESIGN_BRIEF = `FINISHED DESIGN STANDARD:
- At least ${MIN_FINISHED_PARTS} real pieces in the subject itself. Aim for 40–90 when the inventory supports it.
- Establish convincing overall proportions before decoration: distinguish the main mass, secondary forms, and small details.
- Shape at least three changes of width, depth or height; use negative space, recesses and stepped contours where the subject calls for them.
- Integrate three subject-specific features into the construction. Avoid a generic rectangular body with token decorations.
- Animal eyes must be small relative to the face; preserve a projecting muzzle, shaped shoulders/haunches and species-specific stance. Do not use a full dark brick as each eye if it makes a visor across the head.
- Use deliberate color zones and repeated patterns from real stock. Preserve silhouette when colors differ.
- No filler pedestal, unrelated scenery, hidden stacks, or needless splitting of bricks to reach the minimum. Every added part must improve structure, proportion or a visible feature.`;
