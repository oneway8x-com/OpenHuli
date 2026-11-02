# MicroHuli body with a small sloped roof edge

This is the corrected body requested after the raised-rim interpretation was
rejected. Outside dimensions are **60 × 70 × 50 mm total**, including the roof.
It has a **closed top**, a small **5 mm sloped shoulder** like the original
cover, softly rounded upper plan corners, and an open bottom for the chassis.
The current **M3 v3** revision adds a matched drilled chassis, two chassis
fasteners and four roof standoffs for the development board.

![Front and rear of the corrected body](body-cute-50mm.png)

- Front OLED cable slot: **20.005 × 3 mm**, 40–43 mm above the bottom. As on
  the original robot, the OLED board mounts outside the body. The cable slot
  is retained; the old sloping recess and a verified OLED fastening method are
  not reproduced.
- Rear USB opening: **15 × 15 mm**, centered, 20–35 mm above the bottom. Its
  upper edge is **15 mm below the top**. Check actual connector alignment.
- Upper walls and flat roof: **1.6 mm**. Lower collar: 1 mm walls with a nominal
  **58 × 68 mm cavity for the first 16 mm**, before the front/rear mounting lugs.
  A short transition joins the square collar to rounded upper corners. The cavity
  narrows beneath the roof shoulder.
- Two chassis screws: **58 mm apart**, at X=0, Y=±29 mm. Body lugs contact the
  approximately 2 mm chassis plate and include 5.8 mm across-flats nut pockets.
  The original servo brackets and chassis outline are preserved; only two
  **3.4 mm through holes** are cut into the original chassis plate.
- Four board screws: **50 × 50 mm centre-to-centre**, at X=±25, Y=±25 mm.
  Standoffs are 8 mm diameter with 3.4 mm through holes. Their PCB contact plane
  is Z=40 mm, 8.4 mm below the main roof underside. Flat screw-head lands extend
  through the sloped roof shoulder; screw heads sit outside the roof. Local
  relief below the posts clears 7 mm washers/nuts and retains 1.3 mm outer wall.
- Nominal plastic envelope remains **60 × 70 × 50 mm**; exposed fastener heads
  add height. The supplied hole spacing does not establish the board outline,
  populated component envelope, connector alignment or battery/wiring clearance.

## M3 assembly

Use the **M3 v3 body and chassis together**. Earlier body exports have no mounts;
the original chassis has no matching M3 holes. Exported parts are in millimetres.

1. Dry-fit the printed chassis inside the body's lower opening with power
   disconnected. Its bottom plate and the body rim share Z=0; the servo brackets
   extend into the lower body. Check the actual servos, plugs and moving legs.
2. With the body still separate, place **two ordinary M3 hex nuts** into the
   internal front/rear pockets from the cavity side. Tweezers may help. The
   pockets are open above the nuts; printed retention is not assumed.
3. Mount the development board under the roof using **four M3 × 16 mm bolts,
   four M3 nuts and suitable M3 washers**. Bolts enter from outside the roof,
   pass through the standoffs and board, and receive nuts below the PCB. The
   PCB top meets Z=40 mm; orient populated components toward the open bottom
   where possible. Use insulating washers and verify clearance from copper,
   solder and components. The length assumes approximately 1.6 mm PCB thickness;
   dry-fit the hardware and check protruding ends before tightening.
4. Place the body onto the revised chassis. Insert **two M3 × 12 mm bolts with
   washers from underneath the chassis** into the body nuts. The plastic grip to
   each nut floor is approximately 7 mm. Tighten gently; these are printed lugs.
5. Check USB access through the enlarged rear opening, wire routing, battery
   clearance and leg travel before powering the robot.

Reprinting the revised chassis gives the matching holes. To reuse an existing
chassis, the nominal axes are on its centreline, **4 mm inward from each short
edge** (58 mm apart). Remove all electronics and servos before drilling; check
the printed dimensions and hole positions first. No drilling template or
physical drilling test is included.

![M3 body and chassis, cut away to show the mounts](body-m3-cutaway.png)

## Export and print

Install OpenSCAD and add its directory to PATH. From the repository root:

```sh
python hardware/MicroHuli/enclosure/build_body.py --previews
```

Outputs in `exports/`:

- `MicroHuli_body_M3_v3.stl`: body, roof on the bed.
- `MicroHuli_chassis_M3_v3.stl`: original chassis with the two matching holes,
  bottom plate on the bed.
- `body_M3_v3_report.json`: mesh, dimensions, mating clearance, port and fastener
  access checks. Generated previews include assembled, cutaway and exploded views.

The body export puts the closed central roof on the bed and the open bottom upward.
The 5 mm shoulder grows outward at approximately 45° in this orientation.
Start with a 0.4 mm nozzle and 0.2 mm layers; inspect wall paths, shoulder
layers, nut-pocket bridges, lug gussets and both cable openings in the slicer.
The gussets slope toward the walls to support roof-down printing. Support needs,
physical printing, joint strength and component fit have not been verified.

Set `print_orientation=false` for an upright view. Edit parameters in
[body-cute-50mm.scad](body-cute-50mm.scad); `part` selects `body`, `chassis`,
`assembly`, `cutaway` or `exploded`. The earlier flat-top and tall-rim alternatives
are separate files. The external OLED fastening method remains unverified.
