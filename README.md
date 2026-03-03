# Tank Maze (2D)

Prototype 2D top-down tank game on HTML5 Canvas.

## Run
1. Open `index.html` in browser.
2. For best results, run via local server:
   - `python3 -m http.server 8080`
   - Open `http://localhost:8080`

## Controls (Desktop)
- Move: `W A S D` or arrow keys
- Main shot: `Space` or left mouse button
- AP shell (if unlocked): `E`
- Airstrike (if unlocked): `Q`
- Upgrade selection: `1` / `2` / `3` / `4`
- Restart after defeat: `R`

## Controls (iPhone / Safari)
- Left thumb on left side of screen: movement (floating joystick appears under finger).
- Right thumb on right side of screen: turret aiming (floating joystick appears under finger).
- `ОГОНЬ`: main shot (hold for continuous fire).
- `AP`: AP shell shot.
- `АВИА`: call airstrike.
- Upgrade cards and restart can be selected by touch.
- Recommended: play in landscape orientation for better view and control.

## Gameplay rules
- Stone wall: destroyed in **2 shots**.
- Brick wall: destroyed in **3 shots**.
- Bushes are cover: player is hidden in bushes.
- If player and enemy are in the same bush cluster, enemy can detect and shoot.
- Player destroys enemy tanks in **2 shots** with base gun.
- Enemies destroy player in **3 shots** (base health).
- Fuel barrels restore **health + fuel**.
- Ammo crates restore ammo.
- Armor crates restore blue armor shields (after armor upgrade is unlocked).
- Ammo and fuel are limited.
- Every **10 kills** gives an upgrade choice.
- Upgrades include fire rate, armor, AP shell, and airstrike.
- AP and airstrike charges refill by kills after unlock.
- Edge haze is used as a light visual battlefield effect.
- Every next level has a bigger maze; enemies become faster and more dangerous.
