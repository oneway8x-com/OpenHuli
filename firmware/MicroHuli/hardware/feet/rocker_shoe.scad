// MicroHuli passive rocker shoe, dimensions in mm.
// Fits the original STL at 100% scale; fit and walking performance unverified.
// Print in TPU, or add thin rubber to a rigid printed shoe's sole.
// CLI examples: -D 'part="shoe"', 'part="set"', 'part="fit"', 'part="assembly"'.
part = "shoe";
clearance = 0.2;       // Total extra cavity width AND thickness, not per side.
leg_width = 16.01;
leg_thickness = 4.6;
shoe_length = 21;
shoe_width = 9;
shoe_height = 11;
sole_skin = 2;
flat_contact_length = 12;
edge_round = 0.6;
$fn = 64;

assert(clearance >= 0 && clearance <= 1);
assert(shoe_length > leg_width + clearance + 2);
assert(shoe_width > leg_thickness + clearance + 2);

// Profile coordinates are fore/aft X and height Z. The central flat lands on
// the print bed; 45-degree toe/heel bevels let the shoe rock during the stride.
module outer_profile() {
    end_rise = (shoe_length - flat_contact_length) / 2;
    offset(r = edge_round)
        offset(delta = -edge_round)
            polygon([
                [-shoe_length/2, shoe_height],
                [ shoe_length/2, shoe_height],
                [ shoe_length/2, end_rise],
                [ flat_contact_length/2, 0],
                [-flat_contact_length/2, 0],
                [-shoe_length/2, end_rise]
            ]);
}

module tip_socket_profile(fit) {
    r = (leg_width + fit)/2;
    union() {
        translate([0, sole_skin + r]) circle(r = r);
        translate([-r, sole_skin + r]) square([2*r, shoe_height + 20]);
    }
}

module shoe(fit = clearance) {
    difference() {
        rotate([90, 0, 0])
            linear_extrude(height = shoe_width, center = true) outer_profile();
        rotate([90, 0, 0])
            linear_extrude(height = leg_thickness + fit, center = true)
                tip_socket_profile(fit);
    }
}

module shoe_set() {
    for (x = [-13, 13], y = [-7, 7]) translate([x, y, 0]) shoe();
}

// Three disconnected, low-material sizing rings: left = 0.0 mm extra,
// middle = 0.2 mm, right = 0.4 mm. Slide over a leg tip before printing shoes.
module fit_gauges() {
    for (i = [0:2]) {
        fit = i * 0.2;
        translate([(i-1)*25, 0, 0])
            linear_extrude(height = 3)
                difference() {
                    offset(r = 1) offset(delta = -1)
                        square([shoe_length, shoe_width], center = true);
                    square([leg_width + fit, leg_thickness + fit], center = true);
                }
    }
}

module original_leg_for_preview() {
    // Reorient just the first leg from the provided print layout. This import
    // is for the assembly preview only and is not part of any shoe STL export.
    multmatrix([
        [1, 0, 0, -6.005],
        [0, 0, 1, -2.3],
        [0, 1, 0, 49 + sole_skin],
        [0, 0, 0, 1]
    ]) intersection() {
        import("../../stl_files/MicroHuli.stl");
        translate([-3, -50, -1]) cube([18, 47, 7]);
    }
}

if (part == "shoe") shoe();
else if (part == "set") shoe_set();
else if (part == "fit") fit_gauges();
else if (part == "assembly") {
    color([0.95, 0.71, 0.12]) original_leg_for_preview();
    color([0.08, 0.5, 0.8]) shoe();
}
else assert(false, "Unknown part selection");
