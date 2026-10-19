# Dolphin Olympics 3D (prototype)

A browser prototype that tests whether the dive-deep, launch-high loop of Dolphin Olympics still feels good in 3D. It is built with [Three.js](https://threejs.org/) and works with keyboard, gamepad and touch.

The current milestone tests the core loop from the design notes: bounce higher and higher until you break out of the atmosphere, see the stars and the curve of the Earth, then fall back and go again.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # physics and scoring tests (Node, no browser)
npm run build    # static build in dist/
```

## How to play

Dive deep, swim straight up and launch out of the water. Flip, spin and roll in the air, then come down nose first. A ring on the water marks where you'll land. It turns green when your nose lines up with your direction of travel, so the landing will be clean. On long falls, an arrow under the dolphin shows the way to face and the HUD counts down to the water.

A clean or perfect landing whips the dolphin straight back up toward the surface for the next launch. Push the stick down to cancel this and dive instead.

- **Perfect** (within 20°): 1.5× points, and you gain 15% speed.
- **Clean** (within 45°): points, and you gain 4% speed.
- **Wipeout**: no points, the combo resets, and you lose half your speed.

About ten perfect landings in a row take you past the Kármán line into space, and a couple more reach geostationary orbit. In the last half second before impact, if you've let go of the stick, the dolphin's nose eases toward the direction of travel. That rescues small errors but not a badly wrong pose. Runs are open-ended, with no timer and no dying. Restart from the pause menu. Your best altitude is saved in the browser.

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
- **Height and scale:** Distances are squashed, No Man's Sky style. Near the water a game metre is about a real metre, but the real-world altitude grows exponentially with height, so a 500 m jump reaches about 45,000 km. Gravity also weakens a little with height, so the top of a big jump hangs. Real altitude markers pop up on the way up: the Burj Khalifa, Everest, airliners, the Kármán line, the ISS, Hubble, GPS and geostationary orbit. The speed readout uses the same scale, so it ramps up like a pulse drive.
- **Space:** The sky darkens to black with stars as you climb, and the Moon hangs overhead. Above about 100 m the flat sea hands over to a curved Earth. It is drawn scaled toward the camera, with the radius that gives the right horizon curve for your real altitude. High up, the camera chases right behind the direction of travel, so you look up at the stars on the way up and down at the Earth on the way back.
- **Trick scoring:** Rotation is counted per local axis: backflip or frontflip on pitch, spin on yaw, barrel roll on roll. Mixing trick types multiplies the score, and a rotation counts once it reaches 330°.

## Layout

```
src/
  physics.js   swim/air simulation, landing prediction (no rendering, tested)
  altitude.js  squashed real-world altitude scale and trivia markers
  scoring.js   trick detection, landing grades, score and combo
  input.js     keyboard + gamepad (+ touch) merged into one action state
  touch.js     on-screen joystick and buttons
  camera.js    chase camera
  world.js     water shader, sky, seabed, tiled scenery, stars, Moon, Earth
  dolphin.js   procedural dolphin model and tail animation
  effects.js   splash, bubbles, foam rings
  hud.js       HUD and popups
  main.js      game loop and state machine
test/          node:test suite for physics and scoring
```
