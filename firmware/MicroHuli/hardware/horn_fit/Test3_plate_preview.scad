// Preview only: the 3MF preserves separate meshes and the Test3 assembly.
color([0.85, 0.65, 0.15])
    translate([-132.500384, 36.217012, 0]) import("inputs/Test3.3mf", convexity = 10);
color([0.8, 0.15, 0.1])
    translate([5, 5, 0]) import("exports/new_legs_and_shoes_x3.stl", convexity = 10);
