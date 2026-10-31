// Classic Nano: front-left servo signal on shield D3/S.
// Servo power: external suitable supply; supply GND joined to Nano GND.
// Idle on boot. Send t for one 90 -> 85 -> 95 -> 90 test; s cancels.
#include <Servo.h>

constexpr uint8_t SIGNAL_PIN = 3;
constexpr uint8_t TARGETS[] = {90, 85, 95, 90};
Servo frontLeft;
bool running = false;
uint8_t stage = 0;
int angle = 90;
unsigned long nextStep = 0;

void finish(const __FlashStringHelper *message) {
  frontLeft.detach();
  running = false;
  Serial.println(message);
}

void setup() {
  Serial.begin(115200);
  Serial.println(F("MICROHULI_FRONT_LEFT ready; D3; t=test, s=stop; idle"));
}

void loop() {
  while (Serial.available()) {
    const char command = Serial.read();
    if (command == 's') {
      finish(F("STOPPED; servo pulses off"));
    } else if (command == '?' ) {
      Serial.println(F("MICROHULI_FRONT_LEFT; D3; t=test, s=stop"));
    } else if (command == 't' && !running) {
      angle = 90;
      stage = 0;
      frontLeft.writeMicroseconds(1500);
      frontLeft.attach(SIGNAL_PIN, 1000, 2000);
      running = true;
      nextStep = millis() + 700;
      Serial.println(F("TEST start; D3; commanded 90-85-95-90"));
    }
  }
  if (!running || static_cast<long>(millis() - nextStep) < 0) return;

  const int target = TARGETS[stage];
  if (angle != target) {
    angle += angle < target ? 1 : -1;
    frontLeft.write(angle);
    nextStep = millis() + 30;
  } else if (++stage == sizeof(TARGETS) / sizeof(TARGETS[0])) {
    finish(F("TEST complete; commanded 90; servo pulses off"));
  } else {
    nextStep = millis() + 500;
  }
}
