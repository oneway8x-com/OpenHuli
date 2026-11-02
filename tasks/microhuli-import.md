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

## Standalone random OLED diagnostic

- User requested a test that randomly changes OLED eyes after attaching the display. Add a separate Nano sketch with five nonrepeating random expressions every 2.5 seconds, blinking/gaze and 115200-baud diagnostics.
- Use the existing SH1106 128×64 0x3C page-buffer driver, A4/A5, and a frozen frame across pages. Probe display presence at startup. No Servo/IR/network code; D3/D5/D6/D7 are held LOW.
- User confirmed the test hardware is Nano + OLED on USB only, with batteries and servos disconnected. The USB serial port was rediscovered; do not assume the old address still applies. Diagnostic upload replaces the robot firmware; main source remains available to restore it.
- Host coverage added for the actual diagnostic with present/absent OLED, all five expressions, timing, bounded gaze, frame stability and LOW servo signals.
- All seven MicroHuli host simulations pass; the root script test passes with the additional timing assertions. `pnpm typecheck`, `pnpm test` (39 Vitest files / 380 tests plus script checks), Prisma validation, architecture check and production build pass. Targeted ESLint, Markdown formatting/local links and diff checks pass.
- Nano diagnostic cross-build passes: 14,158 bytes flash / 986 bytes static RAM. Upload with verification succeeded on isolated USB-only hardware. Serial readback reported `OLED ready` and all five expression names; actual screen appearance still requires user observation.
- User then explicitly requested the full firmware. Compiled the main standalone Nano sketch (22,474 bytes flash / 1,299 bytes static RAM), uploaded with verification, and observed `MICROHULI_NANO ready ... idle` and its full command list. No movement commands sent. Full-firmware startup reported `OLED absent at 0x3C` despite the earlier diagnostic acknowledgment; record this as an unresolved display observation, not a passing full-display test. Main firmware is restored; the diagnostic remains a separate sketch in the repository.

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

Physical Nano/OLED/IR, the connected build's 485-byte runtime memory margin and loaded gait require qualification; no hardware uploaded. Cloud motion is unsupported by the current protocol; ping-only liveness can become stale. Original import merged in [PR #54](https://github.com/oneway8x-com/OpenHuli/pull/54). The M3 enclosure follow-up below still needs physical printing and fit checks.

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

## Body length increased to 70 mm

- Increase the corrected closed-roof body length from 68 to 70 mm. Width stays 55 mm, total height 50 mm, roof shoulder 5 mm. OLED and USB opening sizes/heights stay unchanged and follow the front/rear walls. Lower nominal cavity becomes 53 × 68 × 16 mm, adding 2 mm length clearance relative to the prior version; chassis retention remains unverified.
- Regenerate a distinctly named `MicroHuli_body_70x55x50mm.stl`, update dimension notes and preview. OpenSCAD render/export, independent single-component watertight/winding/topology/dimensions/Z=0 checks and both port corner checks pass; volume is 21,100.16 mm³. Preview inspected; Markdown formatting, local links and diff checks pass. No runtime changes or physical print. Existing Draft PR #54 updated.

## Body width 60 mm and USB offset 15 mm

- User confirmed 60 mm refers to body width, with USB hole still 10 × 10 mm. Set outside dimensions to 60 mm wide × 70 mm long × 50 mm high. Move USB upper edge to 15 mm below the top (assembled Z=25–35 mm). Preserve OLED slot and roof shape. Lower collar cavity is now 58 × 68 × 16 mm; original chassis retention remains unverified with added clearance.
- Export versioned `MicroHuli_body_70x60x50mm_USB15.stl`, update guide/dimension preview. OpenSCAD render/export, one-component watertight/winding/topology/dimensions/Z=0 checks and both port corner checks pass; volume 22,296.09 mm³. Final preview inspected; Markdown formatting, local links and diff checks pass. No runtime changes or physical print. Existing Draft PR #54 updated.

## M3 body/chassis and board mounting

- Follow-up on the merged import, without a new issue. Base: current `main`;
  branch: `codex/microhuli-m3-mounts`. Preserve the 60 × 70 × 50 mm body.
- Owner confirmed the rear opening is 15 × 15 mm and the board has four mounting
  holes on a 50 × 50 mm square. Retain the rear opening's upper edge 15 mm below
  the roof. Board outline and populated component clearance are not established.
- Add two front/rear chassis axes 58 mm apart, reinforced body nut pockets and
  matching 3.4 mm holes in a chassis extracted from the original STL. Preserve
  the original chassis outline and servo brackets. Use M3 × 12 mm bolts below.
- Add four 8 mm diameter roof standoffs with through holes and flat outer head lands;
  PCB contact at Z=40 mm. Nominal M3 × 16 mm roof bolts, washers and loose nuts
  assume approximately 1.6 mm board thickness and require a hardware dry-fit.
- Add a standard-library/OpenSCAD exporter and independent geometry/access
  checks. Exported meshes and reports remain ignored; source and reference
  previews are committed.
- Geometry checks found 0.3514 mm³ of board washer/side-wall overlap. Add local
  7.4 mm diameter relief below each board post, retaining 1.3 mm outer wall.
- `python hardware/MicroHuli/enclosure/build_body.py --previews`: both meshes
  pass closure, winding, connectivity, positive-volume, dimensions and bed checks;
  all 17 independent mating/fastener/support/port/chassis-preservation checks pass.
  Independent trimesh checks also pass for both exported meshes.
- Python compilation, changed Markdown formatting and diff whitespace checks
  pass. No application or firmware behavior changed; runtime suites are not
  applicable. Final front/rear, inside, cutaway, assembled and exploded previews
  visually reviewed; local guide links and the 18-file ZIP integrity check pass.
  Matched STL files, editable source, guide, previews and report are packaged in
  ignored `exports/MicroHuli_M3_v3.zip`.
- Draft [PR #55](https://github.com/oneway8x-com/OpenHuli/pull/55), base `main`,
  head `codex/microhuli-m3-mounts`, is ready for design review and physical fit
  qualification. No issue was supplied and no issue closure is claimed.
- No slicing, printing or hardware qualification. Board outline, populated
  component/battery/wiring clearance, actual fasteners and printed joint strength
  still require a dry-fit.

## External chassis screws and corrected orientation

- User confirmed the chassis flat plate belongs on top with servo brackets down.
  V3 previews incorrectly put the brackets inside the shell. Rigidly rotate the
  original chassis 180 degrees about X in assembly; keep plate-on-bed orientation
  for the printable chassis export.
- Replace internal chassis bosses/holes with two external front/rear pairs of
  integral tabs at Y=±41 mm, 82 mm apart. Body tabs are 4 mm thick, chassis tabs
  5 mm, with bottom-access M3 nut pockets and top-access M3 × 12 mm screws.
  Side ribs support the body tabs and leave the driver axis clear.
- Shell remains 60 × 70 × 50 mm; external tabs add 13 mm at each end, giving a
  60 × 96 × 50 mm body envelope. Keep the board mounts and 15 × 15 mm rear port.
  Remove the v3 holes from the original chassis plate; preserve all original
  chassis material and servo bays. Revised chassis must be reprinted.
- Reuse branch and draft PR #55. Generate distinctly named M3 v4 artifacts to
  avoid mixing v3 and v4. Both exported meshes pass the closed/wound/connected,
  positive-volume, dimensions and bed checks. All 19 independent CAD checks pass,
  including external bolt/nut/driver access, board supports, ports, lower cavity,
  plate-up orientation and original chassis/servo-bay preservation.
- Collision checking excludes the shared contact face by 0.001 mm for CGAL;
  independent trimesh/manifold checking also confirms zero volumetric overlap at
  the exact assembled position. Its mesh and clear central lower-cavity checks
  pass. The lower-cavity CAD probe compares added material against the shell to
  avoid counting its existing rounded corners as fastener obstructions.
- Independent CAD renders use unique temporary files and at most four parallel
  processes. Python compilation, changed Markdown formatting, guide links and
  diff checks pass. All six final preview views were visually reviewed; the
  18-file `exports/MicroHuli_M3_v4.zip` passes archive integrity checks and includes
  the matched STL files, source, assembly guide, previews and geometry report.
  Draft [PR #55](https://github.com/oneway8x-com/OpenHuli/pull/55) is updated to
  describe the final external-tab design and its physical qualification limits.
- Physical printing, joint strength, fastener fit and populated component/leg
  clearance remain unqualified. No slicing or application/firmware changes.

## Raise board above OLED wiring

- User wants the OLED wire immediately below the development board. The existing
  cable slot spans Z=40–43 mm; raise the board contact plane from Z=40 to Z=45 mm.
  Roof holders become 5 mm long from the outside roof top, rather than 10 mm.
  With the assumed 1.6 mm PCB, its underside sits at Z=43.4 mm, 0.4 mm above the
  slot. This leaves 3.4 mm between the PCB top and main roof underside.
- Use M3 × 12 mm roof bolts with suitable nuts/washers and a dry-fit. Preserve
  the board's 50 × 50 mm hole pattern, external chassis tabs and all ports.
  The chassis geometry is unchanged from v4; an existing v4 print can be reused.
- Add a PCB/slot height assertion, move independent support/access probes to the
  new board height, and check a central printed-plastic wire passage below it.
  Generate v5 artifacts and update draft PR #55.
- `python hardware/MicroHuli/enclosure/build_body.py --previews` passes both mesh
  checks and all 20 geometry/access tests. Independent trimesh/manifold checks
  pass for both meshes, exact assembly overlap and the central lower cavity.
  V4/v5 chassis differences have zero volume in both directions, confirming reuse.
- Final CAD views and the PCB/wire height diagram were visually reviewed. Python
  compilation, changed Markdown formatting, local guide links, diff checks and
  the 19-file `exports/MicroHuli_M3_v5.zip` archive integrity check pass. Source,
  matched STL files, guide, report and previews are included in that package.
- PCB outline, component placement, cable/connector dimensions, solder clearance
  and actual printed fit remain unmeasured. No slicing or firmware changes.

## Side tabs and 12 mm roof holders

- User requested moving the two external body/chassis fasteners to the other
  sides; move the axes to X=±36 mm, Y=0, 72 mm apart. Tabs extend 13 mm beyond
  each side, giving an 86 × 70 × 50 mm body envelope. Revised chassis envelope
  is 86 × 66 × 15.996 mm. Both matched parts must be reprinted.
- Keep the chassis plate up and brackets down. Preserve all original chassis
  material and keep tab additions outside a 40 × 66 mm region around its measured
  printed servo brackets. Actual servo bodies, horns and moving legs are not
  modeled; side-tab clearance through their full travel needs qualification.
- User then explicitly requested roof holders 12 mm below the outside top,
  superseding the 5 mm height. Board contact is Z=38 mm; a nominal 1.6 mm PCB
  underside is Z=36.4 mm. Nominal roof hardware becomes M3 × 18 mm with suitable
  washers/nuts and a dry-fit. The original OLED cable slot is above this board;
  the current slot height is retained.
- Researched OLED mounts at the user's request. SH1106 identifies the controller,
  not the PCB's mounting geometry. Recommend a removable slotted adapter with
  small through bolts and nylon spacers; actual module hole size/pitch remains
  unidentified. No fixed OLED mounting pattern has been added to the model.
- Owner requested a dimension visualization and resolved the unit ambiguity by
  confirming **12 mm below the roof top**. No 120 mm geometry was applied. The
  retained OLED slot is 7–10 mm below the roof top, so its cable enters above
  the board, 2 mm above the PCB contact plane.
- Reuse branch and draft PR #55. The final v6 exporter passes both closed,
  consistently wound, connected positive-volume mesh checks and all 20 CAD
  access/clearance/preservation checks with the side tabs and 12 mm holders.
  Independent trimesh/manifold checks confirm both meshes, exact zero assembly
  overlap and the clear central lower cavity. All six CAD views and the corrected
  12 mm height diagram were visually reviewed.
- Python compilation, changed Markdown formatting, guide links, diff review and
  the 19-file `exports/MicroHuli_M3_v6.zip` integrity check pass. The package holds
  matched STL files, editable source, guide, diagram, previews and geometry report.
  Update draft [PR #55](https://github.com/oneway8x-com/OpenHuli/pull/55) with this
  final side-tab/12 mm design. No slicing, printing or firmware/application changes.

## Rear opening 12 mm below roof

- Owner clarified 1.2 cm: move the rear opening's upper edge from 15 mm to 12 mm
  below the outside roof top. Preserve its 15 × 15 mm size; assembled opening is
  now Z=23–38 mm, up 3 mm. Its upper edge aligns with the Z=38 mm PCB contact plane.
- Keep the 12 mm board holders, OLED cable slot and left/right chassis tabs.
  The v6 chassis geometry is unchanged and reusable. Generate v7 body/artifacts;
  adjust the independent rear-port probe to catch a stale opening position.
- `python hardware/MicroHuli/enclosure/build_body.py --previews` passes both mesh
  checks and all 20 CAD checks. Independent trimesh/manifold checks confirm the
  meshes, exact assembly clearance and matching v6/v7 chassis geometry.
- All final CAD views were visually reviewed. Python compilation, Markdown
  formatting, guide links, diff review and the 19-file `exports/MicroHuli_M3_v7.zip`
  integrity check pass. Update draft [PR #55](https://github.com/oneway8x-com/OpenHuli/pull/55).
  Physical connector alignment, printing and fit remain unverified; no slicing
  or application/firmware changes.
