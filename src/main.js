// Midnight Shift: map planner and play-test tool (entry point).
//
// The code is split by what it does:
//   src/core/    the map model (grid, cells, edges, light, movement) and file formats
//   src/game/    the rules engine: pure game state and actions, no graphics
//   src/render/  the 3D board: scene, tiles, buildings, terrain, effects
//   src/editor/  map-building tools: painting, placing buildings, walls, checks
//   src/play/    the play demo: board animation and the game's panels
//   src/app/     the shell: config, input, menus, files, the frame loop
// A future game build reuses core/, game/ and render/ with its own shell.

import * as configModule from './app/config.js';
import * as sceneModule from './render/scene.js';
import * as boardModule from './render/board.js';
import * as tileLookModule from './render/tileLook.js';
import * as surroundingsModule from './render/surroundings.js';
import * as paintingModule from './editor/painting.js';
import * as wallsModule from './editor/walls.js';
import * as pointerModule from './app/pointer.js';
import * as moveCheckModule from './editor/moveCheck.js';
import * as toolbarModule from './editor/toolbar.js';
import * as playViewModule from './play/playView.js';
import * as panelsModule from './play/panels.js';
import * as gameSettingsModule from './play/gameSettings.js';
import * as panelControlsModule from './app/panelControls.js';
import * as filesModule from './app/files.js';
import * as shellModule from './app/shell.js';
import * as texturesModule from './render/textures.js';
import * as loopModule from './app/loop.js';
import * as gameShellModule from './app/gameShell.js';

// Start-up, in the original order of the code (each module's init() runs
// the statements that used to sit at that point in the one big file).
configModule.init();
sceneModule.init();
boardModule.init();
tileLookModule.init();
surroundingsModule.init();
paintingModule.init();
wallsModule.init();
pointerModule.init();
moveCheckModule.init();
toolbarModule.init();
playViewModule.init();
panelsModule.init();
gameSettingsModule.init();
panelControlsModule.init();
filesModule.init();
shellModule.init();
filesModule.init2();
texturesModule.init();
loopModule.init();
gameShellModule.init(); // the title screen comes up last, over the finished board
