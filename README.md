# HDR Emergency Simulator

A WebXR training simulator for HDR brachytherapy source-retraction emergencies. It runs in the Meta Quest browser (Quest 2, 3, Pro) and on any desktop browser with mouse and keyboard. No install and no build step. It is a static site, so GitHub Pages can host it directly.

## The scenario

You are the physicist at the console during fraction 3 of a vaginal cylinder treatment (7 Gy at 5 mm, Ir-192). Partway through, the source does not come home. You work the emergency procedure from the console into the vault, retract the source or get it out of the patient, then close out.

| Fault | What works |
|---|---|
| Retracts on INTERRUPT | Console interrupt |
| Console emergency stop | Console EMERGENCY STOP (backup motor) |
| Unit emergency stop | Emergency stop on the afterloader (go in with the meter) |
| Manual hand crank | Crank on the side of the unit, about four turns |
| Stuck source | Nothing retracts it. Release the clamp, withdraw the applicator, put it in the emergency container, close the lid |
| Silent failure | The console reports a normal end, but the area monitor keeps alarming. The source has broken off in the applicator. This is modeled on the 1992 Indiana, PA event (NUREG-1480) |

Guided mode gives prompts as you go. Assessment mode gives none and scores you at the end.

## Physics

- Ir-192 point source. Air-kerma strength is 4.08 U per mCi and the dose-rate constant is 1.109 cGy h⁻¹ U⁻¹. That gives about 7.5 Gy/min at 1 cm and 41 mGy/h air kerma at 1 m for 10 Ci.
- Inverse square to your torso, lens, and each hand. Every frame, attenuation is computed along the actual path through the concrete walls, the maze wall and the mobile lead shield, using broad-beam TVLs. A two-bend maze scatter term covers the door and the control area.
- The afterloader safe and the emergency container have their own shielding. The container's open mouth leaks upward until the lid is on.
- Patient dose at the prescription depth (r = 2 cm) and at the mucosa (r = 1.5 cm) accumulates while the source sits in the applicator.
- The survey meter is a high-range energy-compensated GM meter, 0.01 mR/h to 10 R/h. It shows OL above range and has a realistic response time. Its clicks are a Poisson process at the true count rate.
- The debrief flags a likely reportable medical event under 10 CFR 35.3045 when the unplanned dose exceeds half the fraction dose.

These are training approximations. They are not a shielding calculation and not your clinic's procedure.

## Controls

**VR**: Grip grabs, cranks, opens the door and pulls the applicator. Touch a button with the yellow fingertip, or point at it and pull the trigger. Push the left stick forward to aim a teleport; the right stick snap-turns. A/X or the trigger turns the survey meter on and off while you hold it. B/Y opens the pause menu. Hand tracking works too: pinch or make a fist to grab.

**Desktop**: Use W A S D to walk and the mouse to look. Left click presses, picks up or uses; hold it to crank, pull or loosen. F turns the meter on or off. G puts down what you are holding. Tab shows the procedure card. Enter ends the drill.

## Hosting on GitHub Pages

1. Create a repository (for example `hdr-emergency-vr`) and push the contents of this folder to the default branch.
2. In the repository, go to **Settings → Pages**. Set **Source** to *Deploy from a branch*, then choose the branch and the `/ (root)` folder.
3. Open `https://<user>.github.io/hdr-emergency-vr/` in the Quest browser and press **Enter VR**.

WebXR needs HTTPS, which GitHub Pages provides. To test locally, run `python3 -m http.server` in this folder and open `http://localhost:8000`. VR on a headset needs HTTPS or `adb reverse`.

## Rebuilding the 3D scene

`tools/blender/` holds the scripts that generate everything in `assets/`. Each script runs on headless Blender 5.x (`pip install bpy`) with the MPFB add-on for the patient.

```
python3 gen_textures.py     # signage and tiling textures
python3 build_all.py        # models the suite, patient, cloth drapes -> build/scene.blend
python3 bake.py             # lightmap UVs, Cycles bake, OIDN denoise, GLB export
```

## Credits and licences

- three.js (MIT), including the GLTF and Draco loaders and the WebXR helpers.
- WebXR generic hand models from @webxr-input-profiles/assets (MIT).
- Patient: MakeHuman/MPFB base mesh, skin, hair, eyebrows and eyelashes (CC0).
- Ceiling, fabric, leather and wood textures from ambientCG (CC0).
- Everything else is original to this project: the room, equipment, signage, procedural textures, audio synthesis and simulation code.

The afterloader and the console are generic. They do not reproduce any vendor's design or procedure, and the people and phone extensions are fictional.

## Disclaimer

This is an educational simulator. It does not replace your institution's emergency procedures, vendor training, or the annual emergency drills required by your licence.
