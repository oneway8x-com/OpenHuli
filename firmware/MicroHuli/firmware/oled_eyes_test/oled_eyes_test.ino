// OLED-only diagnostic for classic Nano: SH1106 128x64, I2C 0x3C.
// SDA=A4, SCL=A5. Use the OLED module's rated power supply.
// No servo library, IR receiver or networking; servo signal pins stay LOW.
#include <Arduino.h>
#include <Wire.h>
#include <U8g2lib.h>

U8G2_SH1106_128X64_NONAME_1_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE);
constexpr uint8_t OLED_ADDRESS = 0x3C;
constexpr uint8_t SERVO_SIGNALS[] = {3, 5, 6, 7};
constexpr unsigned long MOOD_INTERVAL_MS = 2500;
constexpr unsigned long FRAME_INTERVAL_MS = 40;
constexpr unsigned long BLINK_MS = 120;
enum Mood { NORMAL, HAPPY, ANGRY, TIRED, CURIOUS, MOOD_COUNT };
const char* const MOOD_NAMES[] = {"DEFAULT", "HAPPY", "ANGRY", "TIRED", "CURIOUS"};
Mood mood = NORMAL;
Mood frameMood = NORMAL;
int8_t gaze = 0;
int8_t frameGaze = 0;
uint8_t frameHeight = 24;
bool oledReady = false;
bool drawing = false;
bool blinking = false;
unsigned long lastMood = 0;
unsigned long lastFrame = 0;
unsigned long lastBlink = 0;
unsigned long blinkSince = 0;
unsigned long blinkWait = 3000;

void drawEyes() {
  for (uint8_t eye = 0; eye < 2; ++eye) {
    const uint8_t x = 27 + eye * 47 + frameGaze;
    const uint8_t height = frameMood == CURIOUS && eye == 1 && frameHeight > 2 ? 16 : frameHeight;
    const uint8_t y = 28 - height / 2;
    oled.setDrawColor(1);
    oled.drawRBox(x, y, 28, height, min(uint8_t(4), uint8_t(height / 2)));
    if (height > 4 && (frameMood == HAPPY || frameMood == ANGRY)) {
      oled.setDrawColor(0);
      if (frameMood == HAPPY) oled.drawBox(x, y + height / 2, 28, height / 2 + 1);
      else if (eye == 0) oled.drawTriangle(x, y, x + 28, y, x + 28, y + 10);
      else oled.drawTriangle(x, y, x + 28, y, x, y + 10);
    }
  }
  oled.setDrawColor(1);
  oled.setFont(u8g2_font_5x7_tr);
  oled.setCursor(4, 61);
  oled.print(MOOD_NAMES[frameMood]);
}

void updateEyes(unsigned long now) {
  if (!oledReady) return;
  if (!drawing) {
    if (now - lastFrame < FRAME_INTERVAL_MS) return;
    lastFrame = now;
    if (now - lastMood >= MOOD_INTERVAL_MS) {
      // Choose a different expression each time, using Arduino's PRNG.
      mood = static_cast<Mood>((mood + 1 + random(MOOD_COUNT - 1)) % MOOD_COUNT);
      gaze = static_cast<int8_t>(random(-5, 6));
      lastMood = now;
      Serial.print(F("EYES: "));
      Serial.println(MOOD_NAMES[mood]);
    }
    if (blinking && now - blinkSince >= BLINK_MS) {
      blinking = false;
      lastBlink = now;
      blinkWait = random(2200, 5001);
    } else if (!blinking && now - lastBlink >= blinkWait) {
      blinking = true;
      blinkSince = now;
    }
    // Freeze the frame across all eight OLED pages.
    frameMood = mood;
    frameGaze = gaze;
    frameHeight = blinking ? 2 : (mood == TIRED ? 10 : 24);
    oled.firstPage();
    drawing = true;
  }
  drawEyes();
  drawing = oled.nextPage();
}

void setup() {
  for (uint8_t pin : SERVO_SIGNALS) {
    digitalWrite(pin, LOW);
    pinMode(pin, OUTPUT);
  }
  Serial.begin(115200);
  Serial.println(F("MICROHULI_OLED_EYES_TEST starting; servo signals LOW"));
  randomSeed(static_cast<unsigned long>(analogRead(A0)) ^ micros());
  Wire.begin();
  Wire.setWireTimeout(3000, true);
  Wire.beginTransmission(OLED_ADDRESS);
  oledReady = Wire.endTransmission() == 0;
  if (!oledReady) {
    Serial.println(F("OLED absent at 0x3C; check power, SDA=A4 and SCL=A5, then restart"));
    return;
  }
  oled.setI2CAddress(OLED_ADDRESS << 1);
  oled.setBusClock(400000);
  oled.begin();
  Serial.println(F("OLED ready; random eyes every 2.5 seconds; DEFAULT HAPPY ANGRY TIRED CURIOUS"));
  lastMood = lastBlink = millis();
}

void loop() { updateEyes(millis()); }
