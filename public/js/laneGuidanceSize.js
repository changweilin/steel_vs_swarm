export const LANE_GUIDANCE_SIZE = Object.freeze({
  panelH: .8, narrowPanelH: .65, panelY: 2.8, panelDepth: .16,
  bandH: .12, gap: .1, ledH: .75, hoodH: .12, markerH: 1.35,
});

// Placement headroom and rendered members must use the same assembled envelope.
export function laneGuidanceHeights(panelH = LANE_GUIDANCE_SIZE.panelH) {
  const s = LANE_GUIDANCE_SIZE;
  const bandY = s.panelY + panelH / 2 + s.gap + s.bandH / 2;
  const ledY = bandY + s.bandH / 2 + s.gap + s.ledH / 2;
  const hoodY = ledY + s.ledH / 2 + s.hoodH / 2;
  return { bandY, ledY, hoodY, top: hoodY + s.hoodH / 2 };
}
