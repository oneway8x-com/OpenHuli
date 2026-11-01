# MicroHuli robot import

## Goal

Copy the supplied robot project into OpenHuli, rename it MicroHuli, and adapt it to the existing device transport. No issue supplied. Branch: `codex/microhuli-import`, based on verified `main` at `5ed2555`.

## Notes

- Keep the source checkout unchanged; copy firmware, diagnostics, host tests, photos and printable/CAD files into `firmware/MicroHuli`.
- Rename sketch, STL references, build flags, display/boot labels and BLE name. Remove local machine paths and imported upload claims. Preserve existing mechanical dimensions and local robot behavior.
- Optional `MICROHULI_CONNECTED=1` uses the existing OpenHuliSerial client at 19200 baud with ping and 32-character literal display, no sensors or motion commands. Default retains standalone USB commands. Credentials and authorization remain on the existing gateway/server.
- EEPROM bytes 0–15 belong to the library boot journal. No migration, cloud configuration or server capability changes.

## Cover follow-up

- Owner measured the populated battery holder at 60 × 50 × 16 mm and the Nano/shield assembly at 60 × 50 × 20 mm. Earlier listing/unit values were superseded.
- Add a new enclosure under `hardware/MicroHuli/enclosure` using the original cover's unscaled lower 18 mm for the chassis interface. No servo/leg geometry changes.
- Four separable parts: chassis adapter, upper tub, removable controller tray, removable lid. Battery low, controller above, front IR aperture, external OLED slots, rear future ESP-01/support-electronics bay.
- Connector locations, OLED hole spacing, receiver-board geometry, printed collar fit, loaded gait/centre of gravity and Wi-Fi performance remain physical fit checks. Use adjustable slots/ties rather than inventing fixed board mounting holes.
- CAD/print exports are generated locally; commit the editable source, generation/check script and reference previews.
- Assembled plastic envelope: 72 × 92 × 81.6 mm after the lightweight follow-up. Holder pocket 62 × 52 mm, controller tray 66 × 56 mm with 3 mm insulating pads. Approximately 6 mm below tray and 9.8 mm above populated shield for clearance; actual plugs/wiring remain to check.
- Cover verification: `python3 hardware/MicroHuli/enclosure/build.py --previews` passes for all four parts (closed, consistently wound, positive volume, one connected component and Z=0 print placement). 3MF archive integrity, millimetre units and four separate build objects pass. QIDI Studio CLI `--info` imports all four objects successfully; no slicing or printer upload. CAD previews rendered and visually inspected.
- Independent OpenSCAD/trimesh checks: ten assembled-part/component intersections have no volume above 0.01 mm³; original collar bounds/perimeters agree at Z=0.1, 5, 10, 15 and 17.5 mm within 0.001 mm. A discovered connector-passage overlap below the cut plane was corrected before final verification. A future power-board envelope was moved clear of the rear shelf gusset.
- `python3 -m py_compile hardware/MicroHuli/enclosure/build.py`, changed Markdown formatting/local links and diff whitespace checks pass. No application/firmware behavior changed in this follow-up, so runtime suites were not rerun. No physical print or firmware upload.
- Generated four STL files, a geometry 3MF plate (156 × 196 mm) and a downloadable ZIP under ignored `hardware/MicroHuli/enclosure/exports/`. Print adapter first; assembly notes specify hardware, support inspection and unmeasured connector/OLED/IR/RF checks.

## Lightweight prototype follow-up

- User requested a thinner first prototype with a honeycomb pattern to save PLA. Wall/lid thickness reduced from 2.4 to 1.6 mm; load-bearing floor/flange/tray remain 2.4 mm.
- Add 7 mm across-flats hex openings with 1.6 mm nominal webs to side/rear panels, lid, battery floor and tray; retain solid frames, fastener pillars, support attachment bands and the original lower collar. Window the redundant adapter plate inside the hollow collar.
- Default total solid model volume: 81,325.45 mm³ versus 115,108.17 mm³ before this change, down 29.35%. Actual sliced filament usage is not measured.
- All four mesh checks and ten independent assembled-part/component collision checks pass; original collar checks still pass at five heights. Preview generation uses full geometry rendering for the more complex perforated model. Final previews visually inspected; QIDI imports four manifold objects. Final 3MF/ZIP integrity, Python compilation, changed Markdown/local links and diff checks pass. No physical print or slicing, and no application/firmware behavior changes.

## Bottom fastener access fix

- User could not insert the tub's M3 bolts. Reproduced: the old bottom axes (±30, ±38 mm) lie beneath lid-pillar solids; an 8 mm insertion/tool envelope overlaps about 7,149 mm³ of printed material across the four paths. Earlier mesh/component checks did not test fastener insertion.
- Move both tub and adapter bottom axes to (±21, ±40 mm), with 3.6 mm through holes. Four M3×8 bolts/nuts still join them, but the revised tub and adapter are a matched pair. Check insertion from the open top before adding electronics.
- Add a standard-library/OpenSCAD regression check for four independent 3.2 mm shank, 8 mm top tool/insertion and 9 mm underside nut/socket envelopes. Match the production tessellation ($fn=48) when importing CAD modules. Run this check in the exporter before generating parts.
- Correct the guide: original lower shape alone does not provide a verified adapter-to-chassis attachment. Chassis retention remains unresolved and must not be described as a complete fastened assembly.

- Regression demonstrated on the previous revision (fails), then all four revised shank/tool/nut paths pass. Final four-part mesh/bed/plate checks pass, as do ten component/part collision checks and the five-height original collar checks. QIDI imports four manifold objects; Python compile, Markdown/local links, archive integrity and diff checks pass. No runtime/firmware changes and no physical print test.
- Provide a versioned `MicroHuli_cover_bolt_access_v2.zip` to prevent mixing old tub/adapter files with the revised pair. Add a top-view access diagram showing old holes under pillars and the revised 42 × 80 mm pattern. Update the exploded guide to state unresolved chassis retention explicitly.

## Verification

- `firmware/MicroHuli/tests/run_host_tests.sh`: five simulations pass, including local controls with/without OLED, connected handshake/ping/display with/without OLED, duplicate and motion isolation, unknown I2C timeout without background retries, and corrupt EEPROM fail-closed behavior.
- `pnpm exec tsx --test scripts/microhuli.test.ts`: passes; included in the root script-test glob.
- Arduino CLI Nano local build: passes, 22,474 bytes flash / 1,299 bytes static RAM.
- Arduino CLI connected Nano build with the real local OpenHuliSerial library: passes, 25,306 bytes flash / 1,563 bytes static RAM (485 bytes remain; compiler low-memory warning).
- Connected Nano build with OLED and IR disabled: passes, 10,982 bytes flash / 608 bytes static RAM.
- `pnpm typecheck`, `pnpm --filter @corely/data exec prisma validate`, `pnpm arch:check`, `pnpm build`: pass.
- `pnpm test`: passes, 39 test files / 380 Vitest tests, plus script tests. Initial overlapping package builds caused transient package-resolution/Arduino cache failures; isolated build paths and a sequential test rerun passed.
- Node 24.2.0 satisfies the declared >=22.19.0 engine; pnpm 10.26.0 matches the declared package manager.
- Changed Markdown/TypeScript formatted; targeted ESLint passes. Local Markdown links resolve; 3MF archive integrity and renamed metadata pass. No old project labels or machine-specific paths remain in copied text. Source checkout unchanged.
- Self-review: copied assets retain geometry; existing motion/IR behavior preserved; no network movement, new authority, fake sensor values or secret config introduced.

## Remaining work / risks

Physical Nano/OLED/IR, the connected build's 485-byte runtime memory margin and loaded gait require qualification; no hardware uploaded. Cloud motion is unsupported by the current protocol; ping-only liveness can become stale. Draft PR: https://github.com/oneway8x-com/OpenHuli/pull/54 (base `main`, head `codex/microhuli-import`).

## Rectangular 50 mm body alternative

- User requested a separate body-only design, confirmed a flat closed top, and specified 50 mm height with a rear 10 × 10 mm USB opening. Keep the original 55 × 68 mm outside footprint and open bottom; opening upper edge is 10 mm below the top, centered across the back.
- Add `body-50mm.scad`, illustrated dimensions/print notes and a preview. Walls are 1 mm (53 × 66 mm cavity) and the closed top is 1.6 mm. Export is top-down for printing; existing larger enclosure and original cover are unchanged. No fasteners or electronics mounts are added.
- OpenSCAD export/render pass. Independent mesh inspection passes: one connected watertight consistently wound part, 55 × 68 × 50 mm, Z=0, expected volume 17,596.80 mm³ and correct rear opening corners. Preview visually checked; Markdown formatting/local links and diff checks pass. No application behavior changes, slicing or physical print.
- Physical chassis retention, fit and cable alignment remain unverified. This smaller alternative does not inherit the larger enclosure's validated component envelopes; plugs/wires require a layout check. Source is included in existing Draft PR #54: https://github.com/oneway8x-com/OpenHuli/pull/54.

## Rounded open-top body and 50 mm rim

- User requested the original OLED opening and a cuter body, explicitly confirming a 50 mm raised rim. Add a separate `body-cute-rim.scad` alternative: 55 × 68 mm footprint, previous 50 mm body plus 50 mm rim = 100 mm overall. Top and bottom are open; rounded plan and upper silhouette corners soften the shape. Existing flat-top source/export remain available.
- Inspect original STL and assembled robot photo: OLED is external; restore its approximately 20 × 3 mm cable slot on the new front, not a fictional screen window. Rear USB opening remains 10 × 10 mm with its upper edge 10 mm below the new highest edge. Collar keeps a nominal 53 × 66 × 16 mm opening, with upper walls thickened to 1.6 mm and no internal mounts.
- OpenSCAD export and both rendered views pass. Independent mesh checks pass: one connected watertight consistently wound 55 × 68 × 100 mm object at Z=0, volume 34,076.69 mm³, Euler characteristic -4 (through cavity plus two ports), both port corner coordinates verified. Fix corner-transition pinholes found during initial geometry inspection before final export. Final preview visually inspected; Markdown formatting/local links and diff checks pass. No runtime code changes.
- Physical fit, OLED attachment, cable alignment, printing and loaded stability remain untested. Draft PR #54 updated; earlier OLED diagnostic edits remain unstaged.

## Corrected small roof edge

- User clarified that the top should resemble the old design with a little edge, rejecting the 100 mm open-rim version. Add `body-cute-50mm.scad`: 55 × 68 × 50 mm overall, closed roof, 5 mm sloped shoulder and rounded upper plan corners, open bottom. Mark the tall-rim version superseded and point the enclosure guide to the corrected design.
- Retain the external OLED cable slot (20.005 × 3 mm at Z=40–43) and rear USB opening (10 × 10 mm at Z=30–40, upper edge 10 mm below the top). Preserve nominal lower collar cavity 53 × 66 × 16 mm. Top-down STL orientation avoids a supported internal roof.
- OpenSCAD export/render pass. Final mesh passes: one watertight consistently wound component, 55 × 68 × 50 mm, Z=0, correct two port bounds, Euler -2 and volume 20,669.78 mm³. Front/rear preview inspected; Markdown formatting, local links and diff checks pass. No runtime code changes or physical print/fit verification. Chassis retention and OLED attachment remain unverified. Existing Draft PR #54 updated.
