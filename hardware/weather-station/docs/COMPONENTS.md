# Components and verification status

Status reflects the user's 2026-10-25 hardware description. It is not a
physical inspection or proof that any particular module has passed testing.

## Current USB test assembly

| Component                       | Reported configuration                                | Still to confirm                                                                                                |
| ------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| ESP32-S2 Mini V1.0.0            | ESP32-S2FN4R2, USB-C, female headers; outer rows only | Match the actual board labels to the WEMOS schematic; reliable USB data cable                                   |
| LCD1602A                        | Bare 16-pin parallel 16×2 LCD; no I²C backpack        | Controller input thresholds, backlight resistor, physical pin-1 orientation, readable contrast with VO grounded |
| DHT11                           | Temperature/relative-humidity sensor or breakout      | **Printed pin order**, 3.3V operation and presence/value of DATA pull-up                                        |
| Dupont jumpers                  | Male-ended at the ESP32 female sockets                | Correct opposite ends and secure module contacts                                                                |
| Lightweight honeycomb enclosure | Existing printed box                                  | Module clearances, cable slack and mounting fit with the actual parts                                           |
| USB-C source                    | The only active power source                          | Stable VBUS/3V3 under LCD load and common ground                                                                |

The user reports that the actual LCD mounting holes accept **M3 screws**.
The older V1 mechanical brief assumes M2 and a generic hole pattern. Treat
that earlier statement as a CAD reference for a different assumed module;
test actual fit gently and do not drill or force a screw. This task changes
no mechanical parts, fastener holes, CAD or print files.

No module outline, hole spacing, pin order or current rating is newly
measured here. Do not transfer a generic vendor drawing onto the user's
hardware without checking it.

## Available or listed for later, not in the active test

| Item                        | Status                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| One INR21700 Li-ion cell    | Available per the task; **keep disconnected**                                                         |
| TC4056/TP4056 USB-C charger | Listed for later addition; exact board, protection and availability need confirmation                 |
| Two-terminal rocker switch  | Listed for later connection; leave both terminals outside the test circuit; verify its actual ratings |
| Potentiometer               | Not available; VO is grounded for this test                                                           |

## Required before a future battery upgrade

Plan the complete power path using the actual modules before connecting the
cell. It needs one suitable cell, a proper insulated holder with metal
contacts, appropriate single-cell protection, the specified compatible
TC4056/TP4056 charger, regulated conversion for the ESP32/LCD, a suitable
power switch, and reliable insulated connections.

A TP4056 charger alone does not generate regulated 5V. A single Li-ion cell
needs an appropriate **boost** stage if the chosen system requires regulated
5V; an **XL4005 buck** module cannot step that cell up to 5V. Protection and
system load sharing are separate functions: do not infer either from USB-C
or the existence of OUT terminals. Check whether the exact charger supports
a load during charging and whether USB/external power can backfeed one
another. No charging, protection, conversion or runtime claim is verified
by this test firmware, and no battery circuit is implemented here.

Power reference documents: [TP4056 manufacturer datasheet](https://dlnmh9ip6v2uc.cloudfront.net/datasheets/Prototyping/TP4056.pdf),
[Microchip AN1149 on load sharing](https://ww1.microchip.com/downloads/en/AppNotes/01149a.pdf),
and [XL4005 manufacturer datasheet](https://www.xlsemi.com/datasheet/XL4005-EN.pdf).
Exact TC4056-labelled variants must be checked against their own documentation.

## Optional improvements

- A 10kΩ contrast potentiometer if VO-to-GND is too dark.
- A verified six-channel LCD logic buffer if the controller needs higher input levels.
- Breadboard/distribution connectors and fitted headers for removable wiring.
- A multimeter for continuity and voltage checks.
- A later network clock or external RTC, after the basic hardware test passes.

The preserved clock firmware has a different proposed pin map. Do not upload
it onto this wiring without deliberately reconciling that map first.
