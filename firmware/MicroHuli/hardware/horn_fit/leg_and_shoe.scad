// Print layout: revised horn-clearance leg plus a separate slip-on shoe.
// Uses the checked STL exports; regenerate those first after design edits.
// Millimetres, 100% scale, both parts already oriented on the print bed.
part = "pair"; // pair, set3, set, assembly

module revised_leg() {
    import("exports/leg_larger_horn_mount.stl", convexity = 10);
}

module separate_shoe() {
    import("../feet/exports/rocker_shoe_single.stl", convexity = 10);
}

module printable_pair() {
    color([0.85, 0.15, 0.1]) revised_leg();
    // At least 3.49 mm clear of the leg; shoe's sole is on Z=0.
    color([0.08, 0.5, 0.8]) translate([30, 8, 0]) separate_shoe();
}

if (part == "pair") printable_pair();
else if (part == "set3") {
    for (x = [0, 45, 90]) translate([x, 0, 0]) printable_pair();
}
else if (part == "set") {
    for (x = [0, 45], y = [0, 49])
        translate([x, y, 0]) printable_pair();
}
else if (part == "assembly") {
    // Display only: do not export an assembled pair for printing.
    color([0.85, 0.15, 0.1]) multmatrix([
        [1, 0, 0, -8.005],
        [0, 0, 1, -2.3],
        [0, 1, 0, 2],
        [0, 0, 0, 1]
    ]) revised_leg();
    color([0.08, 0.5, 0.8]) separate_shoe();
}
else assert(false, "Unknown part selection");
