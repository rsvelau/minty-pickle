// Real-world scale, shared by every module.
//
// One cell is the width of a narrow small-town two-lane street with small
// sidewalks: two 2.5 m lanes plus a 1 m sidewalk each side = 7 m (23 ft).
// Everything built in metres (trees, props, bridges, water depth, walls)
// converts through m().
export const METERS_PER_CELL = 7;
export const m = (metres) => metres / METERS_PER_CELL;

// Street cross-section (metres), used by the street surface (src/street.js).
export const LANE_W = 2.5;
export const SIDEWALK_W = 1;
