// Classic Arduino Nano, four externally powered servos with common GND.
// Pins: front-left D3, front-right D5, back-left D6, back-right D7.
// Adapted from MicroHuli's forward gait; no ESP32, display or network code.
// Idle on boot. 'f': two gait cycles; 's': immediately disable pulses.
#include <Servo.h>
#include <math.h>

constexpr uint8_t COUNT = 4;
constexpr uint8_t PINS[COUNT] = {3, 5, 6, 7};
// Front/rear mounting is mirrored on this build. Keep angles in logical gait
// coordinates and mirror only the rear servo output around the 90-degree center.
constexpr int8_t DIRECTIONS[COUNT] = {1, 1, -1, -1};
constexpr float OFFSETS[COUNT] = {-10, 10, 40, -40};
constexpr float PHASES[COUNT] = {0, 0, PI / 2, PI / 2};
constexpr float AMPLITUDE = 30;
constexpr unsigned long CYCLE_MS = 1260;
constexpr unsigned long WALK_MS = CYCLE_MS * 2;
constexpr unsigned long RAMP_MS = 700;

enum State { IDLE, SETTLING, RAMP_IN, WALKING, RAMP_OUT, FINISHING };
State state = IDLE;
Servo legs[COUNT];
float angles[COUNT] = {90, 90, 90, 90};
float rampStart[COUNT];
unsigned long stateSince = 0;
unsigned long lastUpdate = 0;

float gaitAngle(uint8_t leg, float phase) {
  return 90 + OFFSETS[leg] + AMPLITUDE * cos(phase + PHASES[leg]);
}

void writeLeg(uint8_t leg, float angle) {
  angles[leg] = constrain(angle, 20.0f, 160.0f);
  const float outputAngle = 90 + DIRECTIONS[leg] * (angles[leg] - 90);
  legs[leg].write(static_cast<int>(outputAngle + 0.5f));
}

void transition(State next) {
  state = next;
  stateSince = millis();
}

void stop(const __FlashStringHelper *message) {
  for (uint8_t i = 0; i < COUNT; ++i) legs[i].detach();
  state = IDLE;
  Serial.println(message);
}

void setup() {
  Serial.begin(115200);
  Serial.println(F("MICROHULI_NANO_FORWARD_V2 ready; rear reversed; idle; f=two cycles, s=stop"));
}

void loop() {
  while (Serial.available()) {
    const char command = Serial.read();
    if (command == '?') {
      Serial.println(F("MICROHULI_NANO_FORWARD_V2; FL3 FR5 BL6 BR7; rear reversed; f=two cycles, s=stop"));
    } else if (command == 's') {
      stop(F("STOPPED; all servo pulses off"));
    } else if (command == 'f' && state == IDLE) {
      for (uint8_t i = 0; i < COUNT; ++i) {
        legs[i].writeMicroseconds(1500);
        legs[i].attach(PINS[i], 1000, 2000);
        writeLeg(i, 90);
      }
      transition(SETTLING);
      Serial.println(F("FORWARD start; two cycles; FL3 FR5 BL6 BR7"));
    }
  }

  const unsigned long now = millis();
  if (state == IDLE || now - lastUpdate < 20) return;
  lastUpdate = now;
  const unsigned long elapsed = now - stateSince;

  switch (state) {
    case SETTLING:
      if (elapsed >= 700) transition(RAMP_IN);
      break;
    case RAMP_IN: {
      const float fraction = min(1.0f, static_cast<float>(elapsed) / RAMP_MS);
      for (uint8_t i = 0; i < COUNT; ++i)
        writeLeg(i, 90 + fraction * (gaitAngle(i, 0) - 90));
      if (elapsed >= RAMP_MS) transition(WALKING);
      break;
    }
    case WALKING: {
      const unsigned long boundedElapsed = min(elapsed, WALK_MS);
      const float phase = TWO_PI * static_cast<float>(boundedElapsed) / CYCLE_MS;
      for (uint8_t i = 0; i < COUNT; ++i) writeLeg(i, gaitAngle(i, phase));
      if (elapsed >= WALK_MS) {
        for (uint8_t i = 0; i < COUNT; ++i) rampStart[i] = angles[i];
        transition(RAMP_OUT);
      }
      break;
    }
    case RAMP_OUT: {
      const float fraction = min(1.0f, static_cast<float>(elapsed) / RAMP_MS);
      for (uint8_t i = 0; i < COUNT; ++i)
        writeLeg(i, rampStart[i] + fraction * (90 - rampStart[i]));
      if (elapsed >= RAMP_MS) transition(FINISHING);
      break;
    }
    case FINISHING:
      if (elapsed >= 500) stop(F("FORWARD complete; commanded center; all servo pulses off"));
      break;
    default:
      break;
  }
}
