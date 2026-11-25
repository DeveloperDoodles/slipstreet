# SLIPSTREET — Endless City Drift

A 3D open-world drift game that runs in the browser. You drive a BMW M5 Competition through a
neon city that repeats forever in every direction, chaining slides for points.

The car, the city and the textures are generated in code at start-up. The engine is a synthesised V8 voice; the other sounds are real public-domain recordings (drift tyres, a BMW M6 cold start, pops and crashes) from `public/audio`, plus synthesised layers.
There are no model or image files.

## Play online

**[Play Slipstreet in your browser](https://developerdoodles.github.io/slipstreet/)**: no download or install needed. It runs best in an up-to-date Chrome, Edge, Firefox or Safari on a computer with a keyboard or gamepad; touch controls work on phones and tablets. The site is rebuilt from `main` on every push (`.github/workflows/pages.yml`).

## Download and play

**[Download Slipstreet (ZIP, about 3.4 MB)](https://github.com/DeveloperDoodles/slipstreet/releases/latest/download/slipstreet-game.zip)**, unzip it, then:

- **Mac:** double-click `Play (Mac).command`. The first time, if macOS says it can't be opened, right-click it, choose **Open**, then **Open** again.
- **Windows:** double-click `Play (Windows).bat`. If SmartScreen appears, choose **More info**, then **Run anyway**.
- **Linux:** run `Play (Linux).sh`.

The game opens in your browser. Keep the small window that appears open while you play. The launchers need Python 3, which is built into most Macs and Linux systems; on Windows, get it from [python.org](https://www.python.org/downloads/). Browsers won't run a web game opened straight from a file, so the launcher serves it from your own computer. Nothing is sent anywhere. All releases are listed on the [releases page](https://github.com/DeveloperDoodles/slipstreet/releases).

## Run it from the source

```bash
npm install
npm run dev
```

Then open http://127.0.0.1:5173. For a production bundle: `npm run build` (output in `dist/`, plain
static files you can host anywhere) and `npm run preview` to try it.

## Publishing an update

- **Play online:** push to `main`. GitHub Pages rebuilds the site automatically (`.github/workflows/pages.yml`).
- **Download ZIP:** run `npm run package` to build `slipstreet-game.zip`. That is the game in a `game/` folder, plus the launchers and `HOW TO PLAY.txt` from `release/`. Then publish it as a new release:

  ```bash
  gh release create v1.1.0 slipstreet-game.zip --title "Slipstreet v1.1.0" --notes "What's new"
  ```

  The download link in this README always points to the newest release.

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Throttle |
| S / ↓ | Brake, then reverse |
| A D / ← → | Steer |
| Space | Handbrake |
| E / Q | Shift up / down (switches to manual) |
| X | Automatic ↔ manual gearbox |
| M | Drive mode: 2WD drift / 4WD sport |
| C | Camera (chase, far, low drift cam, bonnet) |
| B | Look back |
| T | Time of day (golden hour, midnight, midday) |
| V | Paint colour |
| N | Underglow |
| R | Reset car onto the nearest road |
| G | Start Drift Attack (90 second score run) |
| P / Esc | Pause and settings |

A gamepad works too (left stick, triggers, A for handbrake), and touch devices get on-screen buttons.

## How to drift

- **Power over**: turn in and floor it. The rear steps out and the car settles into a slide you
  hold with the steering. Let go of the steering and it straightens up.
- **Handbrake**: tap Space as you turn in for a big angle, then get back on the throttle.
- **Switchback**: steer the other way mid-slide to flick the car across. This raises your multiplier.
- **Donuts**: full lock and full throttle from a standstill.
- Brake with the throttle still down (left-foot braking) to light the tyres up on the spot.

Points build while the car is sideways (faster and more angle = more points), the multiplier grows
with time and style bonuses, and it is all banked when you straighten up. Hit a wall hard first and
the combo is lost. Street furniture is fair game and scores a little.

## What is in the box

- **Drift physics** (`src/physics.js`): combined-slip tyres with simulated wheel speeds, weight
  transfer, a turbo V8 torque curve, torque converter, 8-speed gearbox with a drift shift map,
  clutch kick off the handbrake, traction control that only works in a straight line, and optional
  assists (self-aligning countersteer, slip-angle damping). Turn the assists off in the pause menu
  for a rawer car.
- **The car** (`src/car/model.js`): a lofted body at the real car's dimensions with glass, lights,
  grilles and trim projected onto it; nine paint colours.
- **The city** (`src/world/`): 120 m blocks in seven district types (downtown, midtown, old town,
  dockyards, park, plaza, car park) with roundabouts, laid out in an 8 × 8 pattern that tiles
  forever. Tiles stream in around the car and the world origin wraps so precision never degrades.
- **Looks**: three times of day with blended sky, image-based lighting, sun shadows, wet-road
  reflections, lit windows and signs, bloom, speed blur, tyre smoke, skid marks, sparks.
- **Sound** (`src/audio.js`, `src/audio-engine.worklet.js`): a synthesised V8 engine voice in an AudioWorklet, recorded drift tyres, pops and crashes, plus synthesised wind, road roar, turbo and street echo. `tools/audio-render.js` renders a scripted drive offline to a WAV for tuning.

## Tuning

Handling lives in `M5_PARAMS` at the top of `src/physics.js`. `npm run sim` runs scripted
manoeuvres (power-over, handbrake entry, transitions, donuts, launches, braking) headlessly and
prints what the car did, which is the quickest way to see the effect of a change:

```bash
npm run sim
node tools/simtest.mjs handbrake
P='{"rear":{"mu":1.4}}' node tools/simtest.mjs powerOver
```

`node tools/layouttest.mjs` sanity-checks the generated city and collision response.

Graphics presets (Low to Ultra) are in the pause menu; resolution also scales itself down if the
frame rate drops. Add `?nosave` to the URL to play without touching saved progress.

## HYPER mode

Press **K**, use the HYPER MODE button on the menu, or set **Power** in the pause menu to turn the M5 into a 500 km/h car. It makes about 2200 PS through taller gears, with a slipperier body, aero downforce that adds grip as speed rises, stickier tyres, huge brakes, and steering that calms down at very high speed. With 4WD it does 0-100 km/h in about 1.9 s, 0-300 in 6.8 s and 0-500 in about 24 s (RWD: 3.0 s, 9.3 s, 27 s). It still drifts. The camera widens and the motion blur grows past 300 km/h. The stock car is unchanged, and the setting is saved. The parameters are `HYPER_PARAMS` in `src/physics.js`.

## Drift guide and drift school

- **Drift guide bar** (bottom centre, `F` to toggle, also in the pause menu): a live coach. The needle is your slip angle, the green band is the sweet spot, the arrows light up when you should steer, and the gas bar shows whether to floor, hold, ease or lift. Three seconds held smoothly in the green pays a SMOOTH DRIFT bonus.
- **Drift school** (`L` on the menu, or the DRIFT SCHOOL button): nine short lessons from building speed to banking a combo. `Enter` skips a lesson.

## Sound

The engine is a designed V8 voice, synthesised in an AudioWorklet (`src/audio-engine.worklet.js`) and tuned to be satisfying rather than accurate. Every cylinder firing is a smooth pressure pulse that rings two banks of tuned exhaust resonances in cross-plane firing order. That gives a burble at idle that turns into a scream at the top of the revs, and the engine gets much louder as it climbs. Pitch is continuous, so it is always smooth. Upshifts glide down to the new revs under a short ignition cut, and downshifts blip up.

The drift screech, BMW M6 cold start, exhaust pops and crashes are public-domain (CC0) recordings in `public/audio`, listed in [CREDITS.md](CREDITS.md). Wind, road roar, turbo flutter, wall scrape and the street echo are synthesised. A recorded-engine layer (a Ferrari 360 V8 played back by a granular engine) is still in the code but switched off (`RECORDED_ENGINE` in `src/audio.js`), because two engines at the same pitch interfere. `tools/audio-render.js` renders a scripted drive offline to a WAV for tuning.
