# Dolphin Olympics 3D (prototype)

A browser prototype that tests whether the dive-deep, launch-high loop of Dolphin Olympics still feels good in 3D. It is built with [Three.js](https://threejs.org/) and works with keyboard, gamepad and touch.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # physics and scoring tests (Node, no browser)
npm run build    # static build in dist/
```

## Publish it

A GitHub Actions workflow (`.github/workflows/pages.yml`) tests, builds and deploys to GitHub Pages on every push to the default branch. One-time setup: in the repo, go to Settings → Pages and set Source to **GitHub Actions**. Pages on a private repo needs a paid GitHub plan; otherwise make the repo public. The game then lives at `https://<user>.github.io/game/`.

## How to play

Dive deep, swim straight up and launch out of the water. Flip, spin and roll in the air, then come down nose first. A ring on the water marks where you'll land. It turns green when your nose lines up with your direction of travel, so the landing will be clean.

- **Perfect** (within 20°): 1.5× points, and you keep 105% of your speed.
- **Clean** (within 45°): points, and you keep 85% of your speed.
- **Wipeout**: no points, the combo resets, and you lose most of your speed.

Chaining clean landings carries speed from jump to jump, so you go higher each time. Rounds last two minutes. A jump still in the air at the buzzer gets to land.

| | Keyboard | Controller (standard mapping) | Touch |
|---|---|---|---|
| Steer underwater / flip and spin in the air | WASD or arrows | Left stick or D-pad | Left-side joystick |
| Swim | Space | RT (analog) or A | SWIM |
| Barrel roll | Q / E | LB / RB | ⟲ ⟳ |
| Camera orbit | I J K L | Right stick | – |
| Pause | Esc / P | Start | II |
| Restart | R | Back / View | Pause menu |
| Invert Y (in menus) | Y | Y | Pause menu |

Controllers use the browser Gamepad API. Xbox, PlayStation and Switch Pro pads work in Chrome, Edge and Firefox. Browsers only expose a pad after a button press, so press any button if it isn't detected. Landings rumble on browsers that support it.

## How the 3D problems are handled

- **Camera:** The camera follows the direction of travel, not the nose, so flips don't spin it around. It pulls back and up as you climb, keeping the water in view, and it looks toward your predicted landing point.
- **Steering:** Underwater, steering is limited to pitch and yaw, with pitch capped at ±80°, so it stays as easy as the 2D original. In the air, the same stick switches to flip and spin, and the bumpers add barrel rolls.
- **Depth:** Fog thickens and darkens with depth. A gauge on the right shows your height above or depth below the surface. Kelp, rocks and buoys give a sense of scale and speed.
- **Landing:** Landings are graded by the angle between the nose and the velocity, so roll doesn't matter. The HUD shows the live entry angle as you come down.
- **Trick scoring:** Rotation is counted per local axis: backflip or frontflip on pitch, spin on yaw, barrel roll on roll. Mixing trick types multiplies the score, and a rotation counts once it reaches 330°.

## Layout

```
src/
  physics.js   swim/air simulation, landing prediction (no rendering, tested)
  scoring.js   trick detection, landing grades, score and combo
  input.js     keyboard + gamepad (+ touch) merged into one action state
  touch.js     on-screen joystick and buttons
  camera.js    chase camera
  world.js     water shader, sky, seabed, tiled scenery
  dolphin.js   procedural dolphin model and tail animation
  effects.js   splash, bubbles, foam rings
  hud.js       HUD and popups
  main.js      game loop and state machine
test/          node:test suite for physics and scoring
```
