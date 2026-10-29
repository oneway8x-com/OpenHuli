"""Build the weather-station prototype guide. Run after final CAD and previews."""
from pathlib import Path
import json
import os
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader

ROOT = Path(__file__).resolve().parent
pdfmetrics.registerFont(TTFont('DejaVu', os.environ.get('WEATHER_FONT', 'DejaVuSans.ttf')))
pdfmetrics.registerFont(TTFont('DejaVu-Bold', os.environ.get('WEATHER_BOLD_FONT', 'DejaVuSans-Bold.ttf')))
pdfmetrics.registerFontFamily('DejaVu', normal='DejaVu', bold='DejaVu-Bold')
W,H=A4
M=42
CW=W-2*M
INK=colors.HexColor('#162A36')
MUTED=colors.HexColor('#536A77')
ACCENT=colors.HexColor('#087E86')
PALE=colors.HexColor('#EAF4F4')
LINE=colors.HexColor('#D8E2E7')
BODY=ParagraphStyle('body',fontName='DejaVu',fontSize=9.5,leading=14,textColor=INK,spaceAfter=5)
SMALL=ParagraphStyle('small',parent=BODY,fontSize=8.0,leading=11.4)
CELL=ParagraphStyle('cell',parent=BODY,fontSize=8.8,leading=12.6)
CELLWHITE=ParagraphStyle('cellwhite',parent=CELL,textColor=colors.white,fontName='DejaVu-Bold')
HEAD=ParagraphStyle('head',parent=BODY,fontName='DejaVu-Bold',fontSize=13,leading=17,textColor=ACCENT)
NUM=ParagraphStyle('num',parent=BODY,fontName='DejaVu-Bold',fontSize=9.5)

class Guide:
    def __init__(self,path):
        self.c=canvas.Canvas(str(path),pagesize=A4)
        self.c.setTitle('Weather Station V1 - Printable Enclosure and Assembly Guide')
        self.c.setAuthor('OpenHuli contributors')
        self.page=0
        self.y=0

    def new(self,title,kicker):
        if self.page: self.c.showPage()
        self.page+=1
        self.c.setFillColor(ACCENT)
        self.c.rect(0,H-11,W,11,fill=1,stroke=0)
        self.c.setFillColor(MUTED)
        self.c.setFont('DejaVu-Bold',8)
        self.c.drawString(M,H-38,'HULILAB / WEATHER STATION V1')
        self.c.setFont('DejaVu',8)
        self.c.drawRightString(W-M,H-38,'24 OCTOBER 2026')
        self.c.setFillColor(INK)
        self.c.setFont('DejaVu-Bold',22)
        self.c.drawString(M,H-75,title)
        self.y=H-99
        self.para(kicker,SMALL)
        self.y-=7
        self.c.setStrokeColor(LINE)
        self.c.line(M,35,W-M,35)
        self.c.setFillColor(MUTED)
        self.c.setFont('DejaVu',7.2)
        self.c.drawString(M,22,'Prototype V1 - verify hardware and print the fit tests first')
        self.c.drawRightString(W-M,22,f'{self.page} / 5')

    def para(self,text,style=BODY,gap=5):
        p=Paragraph(text,style)
        _,hh=p.wrap(CW,H)
        self.check(hh)
        p.drawOn(self.c,M,self.y-hh)
        self.y-=hh+gap

    def heading(self,text):
        self.y-=7
        self.para(text,HEAD,gap=7)

    def box(self,text):
        p=Paragraph(text,BODY)
        _,hh=p.wrap(CW-24,H)
        self.check(hh+24)
        self.c.setFillColor(PALE)
        self.c.roundRect(M,self.y-hh-20,CW,hh+20,5,fill=1,stroke=0)
        p.drawOn(self.c,M+12,self.y-hh-10)
        self.y-=hh+29

    def image(self,path,maxh):
        im=ImageReader(str(path)); iw,ih=im.getSize()
        ww=min(CW,maxh*iw/ih);hh=ww*ih/iw
        self.check(hh)
        self.c.drawImage(im,M+(CW-ww)/2,self.y-hh,width=ww,height=hh,mask='auto')
        self.y-=hh+7

    def table(self,rows,widths):
        data=[]
        for n,row in enumerate(rows):
            data.append([Paragraph(str(v),CELLWHITE if n==0 else CELL) for v in row])
        t=Table(data,colWidths=widths,hAlign='LEFT')
        t.setStyle(TableStyle([
            ('BACKGROUND',(0,0),(-1,0),INK),
            ('VALIGN',(0,0),(-1,-1),'TOP'),
            ('LEFTPADDING',(0,0),(-1,-1),9),
            ('RIGHTPADDING',(0,0),(-1,-1),9),
            ('TOPPADDING',(0,0),(-1,-1),7),
            ('BOTTOMPADDING',(0,0),(-1,-1),7),
            ('LINEBELOW',(0,0),(-1,0),0.5,INK),
            ('LINEBELOW',(0,1),(-1,-1),0.4,LINE),
            ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#F5F8F9')]),
        ]))
        _,hh=t.wrap(CW,H)
        self.check(hh)
        t.drawOn(self.c,M,self.y-hh)
        self.y-=hh+9

    def step(self,n,title,body):
        self.para(f'<b>{n}. {title}</b>  {body}',gap=10)

    def check(self,h):
        if self.y-h<49:
            raise ValueError(f'Page {self.page} overflows at y={self.y}, block height={h}')

    def save(self):
        if self.page!=5:raise ValueError('Expected exactly five pages')
        self.c.save()

def make():
    p=json.loads((ROOT/'design_parameters.json').read_text())
    stats=json.loads((ROOT/'geometry_report.json').read_text())
    comparison=stats['material_comparison']
    report_note=(f"The three enclosure parts contain {comparison['honeycomb_geometry_cm3']:.1f} cm3 of CAD solid volume. "
                 f"The extra honeycomb removes {comparison['geometry_reduction_percent']:.1f}% relative to the same design without those extra openings. "
                 "This comparison excludes fit tests and is not a slicer filament estimate; the sensor vents remain in both versions.")
    g=Guide(ROOT/'Weather_Station_V1_Guide.pdf')

    g.new('Room to build comfortably',
          'A roomy, ventilated desktop enclosure for a bare 16-pin LCD1602A, DHT11 sensor, ESP32-S2 Mini and one rechargeable 21700 cell.')
    g.image(ROOT/'Weather_Station_V1_Preview.png',235)
    g.box('<b>The first print is a fit test.</b> This is a dimensioned CAD prototype, not a physically assembled or fit-tested product. The actual LCD, battery holder, charger, connectors and switch still determine final fit.')
    g.table([
        ['Feature','V1 design'],
        ['Main enclosure','150 wide x 110 high x 75 deep mm'],
        ['Sensor pod','42 wide x 80 high x 42 deep mm; 8 mm air gap'],
        ['Overall assembled envelope','200 wide x 110 high x 75 deep mm, excluding screw heads and external cables'],
        ['Walls and ventilation','2.4 mm walls; real open honeycomb cutouts with solid frames'],
        ['Service access','Separate removable rear covers; generous central space for jumper wires'],
    ],[145,CW-145])
    g.para('The DHT11 sits in its own ventilated side pod. The air gap reduces direct heat conduction from the display and electronics, but it does not guarantee accurate temperature readings while the charger or ESP32 is warm.',SMALL)
    g.para('<b>Use:</b> dry indoor placement, shaded from direct sun. The open vents are not rainproof or splashproof.',SMALL)

    g.new('Inside the enclosure',
          'Illustrated electronics show size envelopes. Only the three plastic enclosure parts and two fit coupons belong in the print files.')
    g.image(ROOT/'Weather_Station_V1_Inside.png',225)
    g.table([
        ['Component','Assumed fit / mounting'],
        ['Bare LCD1602A','80 x 36 mm PCB; 75 x 31 mm hole centres; 73.2 x 27.2 mm front opening. Four M2 mounts. No I2C backpack is assumed.'],
        ['ESP32-S2 Mini','34.3 x 25.4 mm board. Rear-cover support pads and strap slots; allow space for your fitted headers and connectors.'],
        ['DHT11 module','Reserved envelope: up to 26 x 38 x 22 mm, including protrusions. Strap the breakout board; keep the sensing grille open.'],
        ['21700 holder','Commercial single-cell holder up to 84 x 28 x 25 mm; tray space 86 x 30 mm. Use the holder contacts, not printed battery contacts.'],
        ['Power modules','Two generic rear-cover zones, each 30 x 24 mm. Actual modules, connector direction and component heights need checking.'],
    ],[120,CW-120])
    g.para('<b>Access openings:</b> two 20 mm-wide USB slots open to the rear edge, extending 16.1 mm into the shell; 6.5 mm switch hole for a provisional M6 threaded toggle. The open slots let a populated rear cover slide into place. Actual hardware alignment still needs checking.',SMALL)
    g.para('<b>Wire route:</b> a 12 x 8 mm passage links the main chamber to the sensor pod. Leave a service loop so the covers can be opened without pulling on pins.',SMALL)

    g.new('Parts and print setup',
          'Print the two small tests before committing material to the main enclosure. All STL files are already oriented with the intended bed face down.')
    g.table([
        ['Printed part','Quantity / purpose'],
        ['01_LCD_Fit_Test.stl','1; check opening, mounting holes and LCD depth'],
        ['02_Fastener_Fit_Test.stl','1; check M2/M3 nuts, bolt passages and 12 x 8 mm sensor connector passage'],
        ['03_Main_Shell_With_Sensor_Pod.stl','1; front face on the bed, rear openings upward'],
        ['04_Main_Rear_Cover.stl','1; outside face on bed, inside supports upward'],
        ['05_Sensor_Pod_Rear_Cover.stl','1; outside face on bed, inside supports upward'],
    ],[268,CW-268])
    g.heading('Hardware and mounting supplies')
    g.table([
        ['Item','Quantity / selection'],
        ['Rear cover fasteners','6 x M3 x 10 mm machine screws + 6 x M3 hex nuts'],
        ['LCD fasteners','4 x M2 x 6 mm machine screws + 4 x M2 hex nuts; confirm they pass through your LCD holes'],
        ['Board / holder retention','Small cable ties or reusable straps; thin nonconductive foam pads where needed'],
        ['Electronics','LCD1602A, DHT11, ESP32-S2 Mini, 1 x 21700 holder and cell, suitable 1S charger/protection, regulated 5 V boost, power switch'],
    ],[185,CW-185])
    g.heading('Suggested starting settings')
    g.para('For an indoor prototype, start with PLA, a 0.4 mm nozzle, 0.20 mm layers, 3 walls, 4 top/bottom layers and 15% infill. The hexagons are holes in the model; changing infill does not create or close them.')
    g.para('Review bridges and overhangs in your slicer. The shell includes side openings, hexagons and a short cable-duct roof; supports may be useful in selected areas depending on your printer. Keep removable support away from nut pockets where possible.',SMALL)
    g.para(report_note,SMALL)
    g.box('<b>3MF:</b> geometry only, with all five parts arranged in a roughly 254 x 232 mm area. It contains no printer profile, filament profile, slicing settings or G-code. Use the STL tests separately first.')

    g.new('Assembly, step by step',
          'Work with the battery removed and USB cables unplugged until the mechanical fitting is complete.')
    g.step(1,'Test the LCD and fasteners.',
           'Place your actual LCD behind the test frame. Check the four mounting holes, opening and front-to-PCB distance. Test the nuts and bolts without forcing them. Pass the actual sensor connector through the 12 x 8 mm test tunnel.')
    g.step(2,'Print and clean the enclosure.',
           'Remove loose strands from honeycomb cells, bolt holes, nut slots and the cable passage. Check that each cover seats without pressure. If a fit test fails, adjust the CAD before printing the larger parts.')
    g.step(3,'Load the captured nuts.',
           'Slide four M2 nuts into the LCD mounts and six M3 nuts into the cover posts. The pockets load from the side. Keep nuts fully seated and parallel to the screw axis.')
    g.step(4,'Install the display.',
           'Seat the LCD on its four supports. Secure it with four M2 x 6 mm screws, gently and evenly. The screws hold the PCB; they must not press the glass or require bending the board.')
    g.step(5,'Secure the battery holder.',
           'Route two small ties through the underfloor tunnels in the tray and around the commercial holder. Check holder fit and wire exit before inserting the cell. Do not solder directly to the lithium cell.')
    g.step(6,'Mount the rear electronics.',
           'Fit the ESP32, charger and boost boards to the rear-cover support zones with nonconductive pads and ties. Keep board undersides insulated and components unobstructed. Adjust board height so each USB socket aligns with its access opening.')
    g.step(7,'Fit the sensor and route the jumpers.',
           'Secure the DHT11 breakout to the pod cover using its strap slots. Do not cover the blue sensing grille. Route its cable through the 12 x 8 mm bridge and allow slack for removing the cover.')
    g.step(8,'Check, test and close.',
           'Check power polarity, connector orientation and voltage before connecting the ESP32 or LCD. Route jumpers away from screw posts and the ESP32 antenna. Test with covers open, then close using the six M3 screws without trapping wires.')
    g.heading('Make assembly easier')
    g.para('Use pre-crimped Dupont leads once the required pin headers are fitted. This model deliberately leaves a deep central chamber for plug housings, wire bends and a service loop. The bare parallel LCD still needs its control/data wiring and contrast/backlight circuit; the enclosure does not replace those connections.')
    g.box('<b>Before final closure:</b> check that the LCD contrast control remains reachable, the switch moves freely, both USB plugs enter without pushing the PCB, and no wire touches an exposed battery terminal.')

    g.new('Power, limits and references',
          'The case reserves space for a power system. Charging and USB power routing must match the actual modules you install.')
    g.heading('A practical single-cell power arrangement')
    g.para('Use <b>one 21700 lithium-ion cell</b> in a commercial holder, a suitable <b>1S charger and protection circuit</b>, and a <b>regulated 5 V boost converter</b> for the station. Choose a boost output that can handle the actual display load and ESP32 Wi-Fi current peaks. Verify its voltage before attaching either board.')
    g.para('The ESP32-S2 Mini USB connector powers/programs the board; it is not a battery charger. An XL4005 is a step-down converter, so it cannot raise one lithium cell to a regulated 5 V. The power-module drawing is illustrative, not an electrical schematic.',SMALL)
    g.para('<b>Charging:</b> with a basic TP4056 setup that lacks proper load sharing, switch the station off while charging. The power switch should disconnect the boost 5 V supply from the station. Disconnect that battery-derived supply before connecting the ESP32 to a computer USB port; do not join two 5 V sources without a verified power-selection circuit.',SMALL)
    g.para('<b>Signal levels:</b> the ESP32 uses 3.3 V logic. A 5 V LCD or sensor board does not automatically guarantee compatible signal levels. Confirm the exact modules before choosing the connection circuit; the pin-by-pin wiring depends on those parts.',SMALL)
    g.para('<b>Verification boundary:</b> CAD validation is recorded in geometry_report.json. Printed fit, actual USB alignment, hardware clearances, electrical compatibility, slicing, runtime and temperature accuracy still need real-world checks.',SMALL)
    g.heading('Primary references')
    refs=[
        ('WEMOS - S2 Mini specifications and schematic links','https://www.wemos.cc/en/latest/s2/s2_mini.html'),
        ('Winstar - representative 80 x 36 mm LCD mechanical drawing','https://www.winstar.com.tw/uploads/editor/files/WH1602B-16x2-datasheet.pdf'),
        ('Aosong - DHT11 manufacturer datasheet, distributor-hosted copy','https://www.haoyuelectronics.com/Attachment/DHT11/DHT11.pdf'),
        ('Aosong - DHT11 enclosure and heat-source guidance, page 12','https://static.maritex.eu/file/display/jOwQ3b4egHyea8BUoPT1wkbTd5WP0Pb0/DHT11.pdf'),
        ('Espressif - ESP32-S2 antenna and enclosure guidance','https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32s2/pcb-layout-design.html'),
        ('WEMOS - S2 Mini schematic, USB VBUS / 5 V rail','https://www.wemos.cc/en/latest/_static/files/sch_s2_mini_v1.0.0.pdf'),
        ('TP4056 - single-cell charger datasheet','https://dlnmh9ip6v2uc.cloudfront.net/datasheets/Prototyping/TP4056.pdf'),
        ('Microchip AN1149 - lithium battery load sharing','https://ww1.microchip.com/downloads/en/AppNotes/01149a.pdf'),
        ('XLSEMI - XL4005 step-down converter datasheet','https://www.xlsemi.com/datasheet/XL4005-EN.pdf'),
    ]
    for title,url in refs:
        g.para(f'<b>{title}</b><br/><link href="{url}" color="#087E86">{url}</link>',SMALL,gap=6)
    g.para('The Winstar LCD is a dimensional reference, not identification of your exact module. Model variants differ. Sources checked 24 October 2026; all design choices and clearances remain prototype assumptions.',SMALL)
    g.save()

    readme=f'''WEATHER STATION V1 - ROOMY HONEYCOMB ENCLOSURE
24 October 2026

START HERE
Read Weather_Station_V1_Guide.pdf. Print the LCD and fastener fit tests before
the enclosure. This is a CAD-validated prototype; it has not been physically
printed, assembled, or fit-tested with your hardware.

DESIGN
Main enclosure: 150 W x 110 H x 75 D mm.
Sensor pod: 42 W x 80 H x 42 D mm, separated by an 8 mm air gap.
Overall: 200 W x 110 H x 75 D mm, excluding screw heads and external cables.
Wall thickness: 2.4 mm. Real open honeycomb cutouts reduce solid plastic volume.
Dry indoor use only. The vents are not waterproof.
Deep central chamber allows Dupont plug housings, cable bends and service loops.

ASSUMED HARDWARE
- Bare parallel 16-pin LCD: 80 x 36 mm PCB; 75 x 31 mm hole centres.
  Front opening: 73.2 x 27.2 mm. No I2C backpack assumed.
- ESP32-S2 Mini: 34.3 x 25.4 mm PCB.
- DHT11 module envelope: no larger than 26 x 38 x 22 mm including protrusions.
- One 21700 cell in a COMMERCIAL single-cell holder, maximum 84 x 28 x 25 mm.
  The tray is 86 x 30 mm; the printed tray is not an electrical battery holder.
- Generic charger/protection and 5 V boost board zones: each 30 x 24 mm.
- USB slots: 20 mm wide, open to the rear edge and 16.1 mm deep into the shell.
  The open slots allow a populated rear cover to slide into place.
- Switch opening: 6.5 mm for a provisional M6 threaded panel toggle.
  All hardware and port positions require measurement and fitting.

PRINT ORDER
1. STL/01_LCD_Fit_Test.stl - one.
2. STL/02_Fastener_Fit_Test.stl - one; also test the 12 x 8 mm connector tunnel.
3. STL/03_Main_Shell_With_Sensor_Pod.stl - one, front face on bed.
4. STL/04_Main_Rear_Cover.stl - one, outer face on bed.
5. STL/05_Sensor_Pod_Rear_Cover.stl - one, outer face on bed.
STL orientations are already set. Check bridges and support needs in your slicer.
Starting point: PLA, 0.4 mm nozzle, 0.20 mm layers, 3 walls, 4 top/bottom
layers, 15% infill. These are suggested settings, not a tested printer profile.

FASTENERS
6 x M3 x 10 mm machine screws and 6 x M3 hex nuts for both covers.
4 x M2 x 6 mm machine screws and 4 x M2 hex nuts for LCD mounting.
Small ties/straps, thin insulating foam pads and pre-crimped jumper wires.
Confirm screw/nut fit using the coupons; do not force hardware into plastic.

POWER
One 21700 cell requires a suitable 1S lithium-ion charging/protection system
plus regulated 5 V boost. Verify the actual modules and load requirements.
ESP32-S2 Mini USB is not a battery charger.
XL4005 cannot boost one lithium cell to 5 V.
A basic TP4056 lacks proper load sharing: switch the station off while charging.
The switch should disconnect boost 5 V from the station; disconnect this battery
supply before attaching ESP32 computer USB unless proper source selection exists.
Do not feed 5 V to the ESP32 3.3 V pin or GPIOs. Verify LCD/sensor logic levels.
No unverified detailed wiring map or battery-runtime promise is included.

FILES
Weather_Station_V1_Guide.pdf - illustrated design and assembly guide.
Weather_Station_V1_Preview.png / Weather_Station_V1_Inside.png - CAD illustrations.
STL/ - five individually printable parts, including two fit coupons.
Weather_Station_V1_Parts.3mf - GEOMETRY ONLY, no profiles/settings/G-code.
  All five objects occupy roughly 254 x 232 mm. Print coupons separately first.
Weather_Station_V1.step - assembled plastic parts for CAD editing.
weather_station_cad.py - parametric source; requires CadQuery 2.7.
design_parameters.json - current exported parameter values (mm).
geometry_report.json - CAD geometry checks and material comparison.
create_guide.py - report generator, requires ReportLab and final preview images.

MATERIAL COMPARISON
{report_note}

SOURCES
https://www.wemos.cc/en/latest/s2/s2_mini.html
https://www.winstar.com.tw/uploads/editor/files/WH1602B-16x2-datasheet.pdf
https://www.haoyuelectronics.com/Attachment/DHT11/DHT11.pdf
https://static.maritex.eu/file/display/jOwQ3b4egHyea8BUoPT1wkbTd5WP0Pb0/DHT11.pdf
https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32s2/pcb-layout-design.html
https://www.wemos.cc/en/latest/_static/files/sch_s2_mini_v1.0.0.pdf
https://dlnmh9ip6v2uc.cloudfront.net/datasheets/Prototyping/TP4056.pdf
https://ww1.microchip.com/downloads/en/AppNotes/01149a.pdf
https://www.xlsemi.com/datasheet/XL4005-EN.pdf
'''
    (ROOT/'README.txt').write_text(readme,encoding='utf-8')
    print(ROOT/'Weather_Station_V1_Guide.pdf')
    print(ROOT/'README.txt')

if __name__=='__main__':
    make()
