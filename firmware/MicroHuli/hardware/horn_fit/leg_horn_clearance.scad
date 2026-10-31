// MicroHuli leg with more clearance for the existing servo horn.
// Millimetres; original outside outline, rotation centre and length retained.
// Defaults are a fit prototype, not measurements of the photographed horn.
part = "leg";            // leg, set, fit, comparison
pocket_extra = 0.4;       // Additional clearance PER SIDE, including arm tip.
pocket_extension = 5.0;   // Extra arm-pocket length toward the foot, from axis.
access_diameter = 8.0;    // Original through-hole is approximately 7 mm.
pocket_floor = 2.598;     // Original floor: retain the original recess depth.
axis = [6.005, -12.345];  // Centre of the original mesh's circular through-hole.
$fn = 96;

assert(pocket_extra >= 0 && pocket_extra <= 0.8);
assert(pocket_extension >= 0 && pocket_extension <= 8);
assert(access_diameter >= 7.1 && access_diameter <= 8.5);
assert(pocket_floor >= 2 && pocket_floor <= 2.598);

module original_leg() {
    intersection() {
        import("../../stl_files/MicroHuli.stl", convexity = 10);
        translate([-3, -50, -1]) cube([18, 47, 7]);
    }
}

// Trace of the original recess's top lip, extended past the open end.
// Stretch only the arm below the fixed servo centre, then add side clearance.
// The leg outline and circular access hole are independent of this stretch.
module original_pocket_profile() {
    lip = [
        [2.503, 1], [2.503, -4.797], [2.523, -11.107],
        [2.502, -13.161], [2.695, -15.536], [2.771, -16.220],
        [3.080, -18.775], [3.860, -25.438], [3.952, -26.253],
        [4.153, -27.186], [4.319, -27.533], [4.664, -27.936],
        [4.887, -28.108], [5.329, -28.333], [5.918, -28.451],
        [6.089, -28.451], [6.448, -28.401], [7.040, -28.159],
        [7.334, -27.945], [7.570, -27.699], [7.800, -27.323],
        [7.965, -26.818], [8.014, -26.550], [8.309, -23.888],
        [9.309, -15.625], [9.480, -13.750], [9.527, -12.739],
        [9.507, -4.797], [9.507, 1]
    ];
    original_arm_length = 28.451 + axis[1];
    arm_scale = 1 + pocket_extension / original_arm_length;
    polygon([for (p = lip)
        [p[0], p[1] < axis[1]
            ? axis[1] + (p[1] - axis[1]) * arm_scale : p[1]]]);
}

module modified_leg_raw() {
    difference() {
        union() {
            original_leg();
            // The source separates upper/lower sections by about 0.002 mm.
            // Join inside their shared outline for a single closed export.
            translate([-1.99, -29.01, 0]) cube([15.98, 0.02, 4.597]);
        }
        translate([0, 0, pocket_floor])
            linear_extrude(height = 5)
                offset(r = pocket_extra) original_pocket_profile();
        translate([axis[0], axis[1], -0.1])
            cylinder(d = access_diameter, h = 5);
    }
}

module leg() {
    translate([2, 49, 0]) modified_leg_raw();
}

// Shortened leg retains the complete horn recess and centre hole.
// Its straight cut end is for checking fit, not for walking.
module fit_sample() {
    sample_length = 30 + pocket_extension;
    translate([2, sample_length, 0]) intersection() {
        modified_leg_raw();
        translate([-3, -sample_length, -1]) cube([18, sample_length - 3, 7]);
    }
}

if (part == "leg") leg();
else if (part == "set") {
    for (x = [0, 20], y = [0, 49]) translate([x, y, 0]) leg();
}
else if (part == "fit") fit_sample();
else if (part == "comparison") {
    color([0.7, 0.7, 0.7]) translate([2, 49, 0]) original_leg();
    color([0.85, 0.15, 0.1]) translate([24, 0, 0]) leg();
}
else assert(false, "Unknown part selection");
