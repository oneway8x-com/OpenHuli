// MicroHuli: classic Arduino Nano / ATmega328P.
// FL D3, FR D5, BL D6, BR D7. External servo power; common GND.
// SH1106 128x64 OLED: SDA A4, SCL A5, address 0x3C.
// KY-022 on D2: ELEGOO keypad movement, poses, tricks, eyes and tests; NEC 0.
// Servos stay detached on boot. USB Serial: 115200 baud, newline commands.
#include <Servo.h>
#include <math.h>
#include <ctype.h>
#include <string.h>

// Local USB console by default; connected builds dedicate Serial to binary v1.
#ifndef MICROHULI_CONNECTED
#define MICROHULI_CONNECTED 0
#endif
#if MICROHULI_CONNECTED
#include <OpenHuliSerial.h>
openhuli_serial::OpenHuliSerial* huli = nullptr;
// No text may enter the binary protocol stream.
struct QuietLog {
  template<typename T> void print(T) {}
  template<typename T> void println(T) {}
} robotLog;
#else
#define robotLog Serial
#endif

#ifndef MICROHULI_IR
#define MICROHULI_IR 1
#endif
#if MICROHULI_IR
#define IR_RECEIVE_PIN 2
// NEC decoding via interrupts, without a timer or large raw-signal buffer.
#include <TinyIRReceiver.hpp>
constexpr uint8_t IR_REMOTE_ADDRESS = 0x00;
constexpr uint8_t IR_STOP_COMMAND = 0x47; // FUNC/STOP
bool irReady = false;
uint8_t nextIRTestLeg = 0;
#endif

#ifndef MICROHULI_OLED
#define MICROHULI_OLED 1
#endif
#if MICROHULI_OLED
#include <Wire.h>
#include <U8g2lib.h>
// A 128-byte page buffer leaves room for motion control on the 2 KB Nano.
U8G2_SH1106_128X64_NONAME_1_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE);
constexpr uint8_t OLED_ADDRESS = 0x3C;
bool oledReady = false;
#endif

constexpr uint8_t LEG_COUNT = 4;
constexpr uint8_t SERVO_PINS[LEG_COUNT] = {3, 5, 6, 7};
// Rear directions reversed following the owner's front/rear motion check.
constexpr int8_t SERVO_DIRECTIONS[LEG_COUNT] = {1, 1, -1, -1};
constexpr int8_t SERVO_TRIM[LEG_COUNT] = {0, 0, 0, 0};
constexpr uint8_t SERVO_MIN[LEG_COUNT] = {20, 20, 20, 20};
constexpr uint8_t SERVO_MAX[LEG_COUNT] = {160, 160, 160, 160};
constexpr float WALK_OFFSETS[LEG_COUNT] = {-10, 10, 40, -40};
constexpr float WALK_PHASES[LEG_COUNT] = {0, 0, PI / 2, PI / 2};
constexpr unsigned long GAIT_CYCLE_MS = 1260;
constexpr unsigned long GAIT_ENTRY_MS = 700;
constexpr unsigned long SERVO_TICK_MS = 20;
constexpr float SERVO_STEP = 3;
constexpr float AMPLITUDE = 30;

enum Motion { IDLE, POSE, WALK_FORWARD, WALK_BACKWARD, TURN_LEFT, TURN_RIGHT,
              SPIN_LEFT, SPIN_RIGHT, PUSHUPS, SWING, GALLOP, SERVO_TEST };
enum Mood { NORMAL, HAPPY, ANGRY, TIRED, CURIOUS };

Servo servos[LEG_COUNT];
float currentPos[LEG_COUNT] = {90, 90, 90, 90};
float targetPos[LEG_COUNT] = {90, 90, 90, 90};
Motion motion = IDLE;
Mood mood = NORMAL;
bool attached = false;
bool infoScreen = false;
bool releaseAfterPose = false;
unsigned long motionSince = 0;
unsigned long lastServoTick = 0;
unsigned long poseSettledSince = 0;
unsigned long gaitLimitMs = 0;
uint8_t trickStep = 0;
uint8_t testLeg = 0;
uint8_t testStep = 0;
uint8_t testCycle = 0;
unsigned long testSettledSince = 0;
constexpr uint8_t TEST_ANGLES[] = {90, 85, 95, 90};
constexpr uint8_t TEST_CYCLES = 8;
char commandBuffer[24];
uint8_t commandLength = 0;
bool commandOverflow = false;

float physicalAngle(uint8_t leg, float logical, bool fullRange = false) {
  const float output = 90 + SERVO_TRIM[leg] +
                       SERVO_DIRECTIONS[leg] * (logical - 90);
  if (fullRange) return constrain(output, 0.0f, 180.0f);
  return constrain(output, SERVO_MIN[leg], SERVO_MAX[leg]);
}

float boundedTarget(uint8_t leg, float logical, bool fullRange = false) {
  return 90 + SERVO_DIRECTIONS[leg] *
              (physicalAngle(leg, logical, fullRange) - 90 - SERVO_TRIM[leg]);
}

void attachServo(uint8_t leg) {
  if (servos[leg].attached()) return;
  const int output = static_cast<int>(physicalAngle(leg, currentPos[leg], true) + 0.5f);
  // Preload a pulse independent of Servo's default angle mapping.
  servos[leg].writeMicroseconds(1000 + output * 1000L / 180);
  servos[leg].attach(SERVO_PINS[leg], 1000, 2000);
  servos[leg].write(output);
}

void attachServos() {
  for (uint8_t i = 0; i < LEG_COUNT; ++i) {
    attachServo(i);
  }
  attached = true;
}

void stopMotion() {
  for (uint8_t i = 0; i < LEG_COUNT; ++i) {
    servos[i].detach();
    digitalWrite(SERVO_PINS[i], LOW);
    targetPos[i] = currentPos[i];
  }
  attached = false;
  motion = IDLE;
  releaseAfterPose = false;
  gaitLimitMs = 0;
  robotLog.println(F("STOPPED; servo pulses off"));
}

void beginServoTest(uint8_t leg) {
  stopMotion();
  testLeg = leg;
  testStep = 0;
  testCycle = 0;
  testSettledSince = 0;
  targetPos[leg] = boundedTarget(leg, TEST_ANGLES[0]);
  attachServo(leg);
  attached = true;
  motion = SERVO_TEST;
  infoScreen = false;
  mood = CURIOUS;
  robotLog.print(F("SERVO TEST start; D"));
  robotLog.println(SERVO_PINS[leg]);
}

void setTargets(float a, float b, float c, float d, bool fullRange = false) {
  const float requested[LEG_COUNT] = {a, b, c, d};
  for (uint8_t i = 0; i < LEG_COUNT; ++i)
    targetPos[i] = boundedTarget(i, requested[i], fullRange);
}

void beginPose(float a, float b, float c, float d, bool release, bool fullRange = false) {
  attachServos();
  setTargets(a, b, c, d, fullRange);
  motion = POSE;
  releaseAfterPose = release;
  poseSettledSince = 0;
}

bool isGait(Motion value) {
  return value >= WALK_FORWARD && value <= SPIN_RIGHT;
}

void beginAction(Motion action, unsigned long limit = 0) {
  attachServos();
  motion = action;
  motionSince = millis();
  gaitLimitMs = limit;
  trickStep = 0;
  releaseAfterPose = false;
  infoScreen = false;
  mood = action == PUSHUPS ? ANGRY : (action >= SWING ? HAPPY : NORMAL);
}

float gaitScale(uint8_t leg) {
  const bool left = (leg % 2) == 0;
  if (motion == TURN_LEFT) return left ? 0.4f : 1.2f;
  if (motion == TURN_RIGHT) return left ? 1.2f : 0.4f;
  if (motion == SPIN_LEFT) return left ? 1.2f : -1.2f;
  if (motion == SPIN_RIGHT) return left ? -1.2f : 1.2f;
  return 1;
}

#if MICROHULI_IR
void handleCommand(const char *command);

void handleIRFrame(uint8_t address, uint8_t command, uint8_t flags) {
  if ((flags & IRDATA_FLAGS_PARITY_FAILED) || address != IR_REMOTE_ADDRESS) return;
  // Each fresh key dispatches the same command as USB Serial. FUNC/STOP is
  // also accepted on repeats; other repeats never restart or resume actions.
  if (command == IR_STOP_COMMAND) {
    if (!(flags & IRDATA_FLAGS_IS_REPEAT) || attached) handleCommand("STOP");
    return;
  }
  if (flags & IRDATA_FLAGS_IS_REPEAT) return;
  switch (command) {
    case 0x16: handleCommand("UP"); break;       // 0
    case 0x0C: handleCommand("DOWN"); break;     // 1
    case 0x18: handleCommand("WALK"); break;     // 2
    case 0x5E: handleCommand("BACK"); break;     // 3
    case 0x08: handleCommand("LEFT"); break;     // 4
    case 0x1C: handleCommand("RIGHT"); break;    // 5
    case 0x5A: handleCommand("SL"); break;       // 6
    case 0x42: handleCommand("SR"); break;       // 7
    case 0x52: handleCommand("REST"); break;     // 8
    case 0x4A: handleCommand("INFO"); break;     // 9
    case 0x45: handleCommand("INFO"); break;     // POWER
    case 0x46: handleCommand("PUSHUPS"); break;  // VOL+
    case 0x15: handleCommand("SWING"); break;    // VOL-
    case 0x40: handleCommand("GALLOP"); break;   // PLAY/PAUSE
    case 0x44: handleCommand("B"); break;        // FAST BACK
    case 0x43: handleCommand("F"); break;        // FAST FORWARD
    case 0x09: handleCommand("HELP"); break;     // UP arrow
    case 0x07: handleCommand("DEFAULT"); break;  // DOWN arrow
    case 0x19: // EQ: all five eyes, one change per distinct press.
      switch (mood) {
        case NORMAL: handleCommand("HAPPY"); break;
        case HAPPY: handleCommand("ANGRY"); break;
        case ANGRY: handleCommand("TIRED"); break;
        case TIRED: handleCommand("CURIOUS"); break;
        case CURIOUS: handleCommand("DEFAULT"); break;
      }
      break;
    case 0x0D: { // ST/REPT: one isolated test per press, FL -> FR -> BL -> BR.
      const char *const tests[] = {"TESTFL", "TESTFR", "TESTBL", "TESTBR"};
      handleCommand(tests[nextIRTestLeg]);
      nextIRTestLeg = (nextIRTestLeg + 1) % LEG_COUNT;
      break;
    }
    default: robotLog.println(F("IR unmapped key; see HELP")); break;
  }
}

void updateRemote() {
  if (!irReady) return;
  // Atomically snapshot the interrupt-owned command and consume it once.
  noInterrupts();
  const bool received = TinyIRReceiverData.justWritten;
  const uint8_t address = TinyIRReceiverData.Address;
  const uint8_t command = TinyIRReceiverData.Command;
  const uint8_t flags = TinyIRReceiverData.Flags;
  TinyIRReceiverData.justWritten = false;
  interrupts();
  if (received) handleIRFrame(address, command, flags);
}
#endif

void updateAction(unsigned long now) {
  if (isGait(motion)) {
    const unsigned long elapsed = now - motionSince;
    const unsigned long walkingTime = elapsed > GAIT_ENTRY_MS ? elapsed - GAIT_ENTRY_MS : 0;
    if (gaitLimitMs && walkingTime >= gaitLimitMs) {
      beginPose(90, 90, 90, 90, true);
      robotLog.println(F("STEP complete; returning to center"));
      return;
    }
    // Reverse time progression for BACK, rather than shifting every leg by PI.
    float phase = TWO_PI * static_cast<float>(walkingTime % GAIT_CYCLE_MS) / GAIT_CYCLE_MS;
    if (motion == WALK_BACKWARD) phase = -phase;
    for (uint8_t i = 0; i < LEG_COUNT; ++i) {
      const float angle = 90 + WALK_OFFSETS[i] +
                          gaitScale(i) * AMPLITUDE * cos(phase + WALK_PHASES[i]);
      targetPos[i] = boundedTarget(i, angle);
    }
  } else if (motion == SERVO_TEST) {
    if (fabs(targetPos[testLeg] - currentPos[testLeg]) > 0.1f) {
      testSettledSince = 0;
      return;
    }
    if (!testSettledSince) testSettledSince = now;
    if (now - testSettledSince >= 400) {
      if (++testStep == sizeof(TEST_ANGLES) / sizeof(TEST_ANGLES[0])) {
        testStep = 0;
        if (++testCycle == TEST_CYCLES) {
          stopMotion();
          robotLog.println(F("SERVO TEST complete; centered; pulses off"));
          return;
        }
      }
      targetPos[testLeg] = boundedTarget(testLeg, TEST_ANGLES[testStep]);
      testSettledSince = 0;
    }
  } else if (motion >= PUSHUPS && motion <= GALLOP) {
    const uint8_t steps = motion == PUSHUPS ? 12 : (motion == SWING ? 8 : 16);
    if (now - motionSince >= 650) {
      motionSince = now;
      if (++trickStep >= steps) {
        beginPose(90, 90, 90, 90, false);
        mood = NORMAL;
        robotLog.println(F("TRICK complete"));
        return;
      }
    }
    const bool alternate = trickStep & 1;
    if (motion == PUSHUPS) {
      if (alternate) setTargets(90, 90, 90, 90);
      else setTargets(120, 60, 60, 120);
    } else if (motion == SWING) {
      if (alternate) setTargets(90, 55, 125, 90);
      else setTargets(125, 90, 90, 55);
    } else {
      if (alternate) setTargets(50, 130, 130, 50);
      else setTargets(130, 50, 50, 130);
    }
  }
}

void updateServos(unsigned long now) {
  if (!attached || now - lastServoTick < SERVO_TICK_MS) return;
  lastServoTick = now;
  bool reached = true;
  for (uint8_t i = 0; i < LEG_COUNT; ++i) {
    if (!servos[i].attached()) continue;
    const float remaining = targetPos[i] - currentPos[i];
    currentPos[i] += constrain(remaining, -SERVO_STEP, SERVO_STEP);
    // Targets enforce their own bounds; allow a gradual return from DOWN's
    // full-range endpoints instead of snapping back to the normal 20/160 limits.
    servos[i].write(static_cast<int>(physicalAngle(i, currentPos[i], true) + 0.5f));
    if (fabs(targetPos[i] - currentPos[i]) > 0.1f) reached = false;
  }
  if (motion == POSE && reached) {
    if (!poseSettledSince) poseSettledSince = now;
    if (now - poseSettledSince >= 300) {
      if (releaseAfterPose) stopMotion();
      else motion = IDLE;
    }
  } else {
    poseSettledSince = 0;
  }
}

void printHelp() {
  robotLog.println(F("TESTFL TESTFR TESTBL TESTBR | one servo, 8 small sweeps (~15s)"));
  robotLog.println(F("FORWARD/WALK BACK LEFT RIGHT SL SR | F/B=two cycles | STOP or !"));
  robotLog.println(F("UP DOWN REST INFO PUSHUPS SWING GALLOP | DOWN=creator 180/0/180/0"));
  robotLog.println(F("HAPPY ANGRY TIRED CURIOUS DEFAULT | HELP or ?"));
#if MICROHULI_IR
  robotLog.println(F("IR press once: 0=UP 1=DOWN 2=WALK 3=BACK 4=LEFT 5=RIGHT"));
  robotLog.println(F("IR 6=SL 7=SR 8=REST 9/POWER=INFO FUNC=STOP; walks continue until stopped"));
  robotLog.println(F("IR VOL+=PUSHUPS VOL-=SWING PLAY=GALLOP << =B >> =F"));
  robotLog.println(F("IR EQ=next eyes ST/REPT=next servo test UP-arrow=HELP DOWN-arrow=DEFAULT"));
#endif
}

void handleCommand(const char *command) {
  if (!strcmp(command, "STOP") || !strcmp(command, "S")) {
    stopMotion();
    infoScreen = false;
    mood = NORMAL;
    return;
  }
  if (!strcmp(command, "?") || !strcmp(command, "HELP")) {
    printHelp();
    return;
  }
  robotLog.print(F("CMD "));
  robotLog.println(command);
  if (!strcmp(command, "TESTFL")) beginServoTest(0);
  else if (!strcmp(command, "TESTFR")) beginServoTest(1);
  else if (!strcmp(command, "TESTBL")) beginServoTest(2);
  else if (!strcmp(command, "TESTBR")) beginServoTest(3);
  else if (!strcmp(command, "FORWARD") || !strcmp(command, "WALK")) beginAction(WALK_FORWARD);
  else if (!strcmp(command, "BACK")) beginAction(WALK_BACKWARD);
  else if (!strcmp(command, "F")) beginAction(WALK_FORWARD, 2 * GAIT_CYCLE_MS);
  else if (!strcmp(command, "B")) beginAction(WALK_BACKWARD, 2 * GAIT_CYCLE_MS);
  else if (!strcmp(command, "LEFT")) beginAction(TURN_LEFT);
  else if (!strcmp(command, "RIGHT")) beginAction(TURN_RIGHT);
  else if (!strcmp(command, "SL")) beginAction(SPIN_LEFT);
  else if (!strcmp(command, "SR")) beginAction(SPIN_RIGHT);
  else if (!strcmp(command, "PUSHUPS")) beginAction(PUSHUPS);
  else if (!strcmp(command, "SWING")) beginAction(SWING);
  else if (!strcmp(command, "GALLOP")) beginAction(GALLOP);
  else if (!strcmp(command, "UP") || !strcmp(command, "DOWN") ||
           !strcmp(command, "REST") || !strcmp(command, "INFO")) {
    infoScreen = !strcmp(command, "INFO");
    mood = !strcmp(command, "REST") ? TIRED : NORMAL;
    if (!strcmp(command, "UP")) beginPose(90, 90, 90, 90, false);
    else if (infoScreen) beginPose(90, 90, 50, 130, false);
    // Owner requested the creator's DOWN pose. Only DOWN/REST targets use
    // full travel; walking, tricks and individual tests keep their usual limits.
    else beginPose(180, 0, 180, 0, !strcmp(command, "REST"), true);
  } else if (!strcmp(command, "HAPPY")) { mood = HAPPY; infoScreen = false; }
  else if (!strcmp(command, "ANGRY")) { mood = ANGRY; infoScreen = false; }
  else if (!strcmp(command, "TIRED")) { mood = TIRED; infoScreen = false; }
  else if (!strcmp(command, "CURIOUS")) { mood = CURIOUS; infoScreen = false; }
  else if (!strcmp(command, "DEFAULT")) { mood = NORMAL; infoScreen = false; }
  else robotLog.println(F("Unknown command; HELP lists commands"));
}

void readCommands() {
#if !MICROHULI_CONNECTED
  while (Serial.available()) {
    const char c = Serial.read();
    if (c == '!') {
      stopMotion();
      commandLength = 0;
      commandOverflow = false;
    } else if (c == '\r' || c == '\n') {
      if (commandOverflow) robotLog.println(F("Command too long; discarded"));
      else if (commandLength) {
        commandBuffer[commandLength] = '\0';
        handleCommand(commandBuffer);
      }
      commandLength = 0;
      commandOverflow = false;
    } else if (!isspace(static_cast<unsigned char>(c))) {
      if (commandLength < sizeof(commandBuffer) - 1)
        commandBuffer[commandLength++] = toupper(static_cast<unsigned char>(c));
      else commandOverflow = true;
    }
  }
#endif
}

#if MICROHULI_OLED
char cloudText[33] = {};

struct FaceFrame {
  bool info;
  bool powered;
  Mood mood;
  uint8_t eyeHeight;
  int8_t gaze;
  unsigned long uptime;
  uint8_t positions[LEG_COUNT];
};
FaceFrame frame;
bool drawingFrame = false;
unsigned long lastFrame = 0;

void drawFrame() {
#if MICROHULI_CONNECTED
  if (cloudText[0]) {
    oled.setFont(u8g2_font_5x7_tr);
    oled.setDrawColor(1);
    oled.setCursor(5, 25);
    for (uint8_t i = 0; cloudText[i]; ++i) {
      if (i == 16) oled.setCursor(5, 42);
      oled.print(cloudText[i]);
    }
    return;
  }
#endif
  if (frame.info) {
    oled.setFont(u8g2_font_5x7_tr);
    oled.setCursor(5, 10); oled.print(F("MICROHULI / NANO"));
    oled.setCursor(5, 23); oled.print(F("Uptime: ")); oled.print(frame.uptime); oled.print(F("s"));
    oled.setCursor(5, 36); oled.print(F("Servos: ")); oled.print(frame.powered ? F("ON") : F("OFF"));
    oled.setCursor(5, 49); oled.print(F("FL FR BL BR"));
    for (uint8_t i = 0; i < LEG_COUNT; ++i) {
      oled.setCursor(5 + 30 * i, 61); oled.print(frame.positions[i]);
    }
    return;
  }
  for (uint8_t i = 0; i < 2; ++i) {
    const uint8_t x = 27 + i * 47 + frame.gaze;
    const uint8_t h = frame.mood == CURIOUS && i == 1 && frame.eyeHeight > 2 ? 18 : frame.eyeHeight;
    const uint8_t y = 32 - h / 2;
    oled.setDrawColor(1);
    oled.drawRBox(x, y, 28, h, min(static_cast<uint8_t>(4), static_cast<uint8_t>(h / 2)));
    if (h > 4 && (frame.mood == HAPPY || frame.mood == ANGRY)) {
      oled.setDrawColor(0);
      if (frame.mood == HAPPY) oled.drawBox(x, y + h / 2, 28, h / 2 + 1);
      else if (i == 0) oled.drawTriangle(x, y, x + 28, y, x + 28, y + 11);
      else oled.drawTriangle(x, y, x + 28, y, x, y + 11);
    }
  }
  oled.setDrawColor(1);
}

void updateDisplay(unsigned long now) {
#if MICROHULI_CONNECTED
  // Cloud text is drawn once in the command callback, never retried by animation.
  if (cloudText[0]) return;
#endif
  if (!oledReady) return;
  if (!drawingFrame) {
    if (now - lastFrame < 100) return;
    lastFrame = now;
    frame.info = infoScreen;
    frame.powered = attached;
    frame.mood = mood;
    frame.eyeHeight = now % 4000 < 120 ? 2 : (mood == TIRED ? 12 : 28);
    frame.gaze = (static_cast<int>((now / 2000) % 3) - 1) * 3;
    frame.uptime = now / 1000;
    for (uint8_t i = 0; i < LEG_COUNT; ++i)
      frame.positions[i] = static_cast<uint8_t>(physicalAngle(i, currentPos[i], true) + 0.5f);
    oled.firstPage();
    drawingFrame = true;
  }
  // Send one page per loop so motion and STOP are serviced between pages.
  drawFrame();
  drawingFrame = oled.nextPage();
}
#endif

#if MICROHULI_CONNECTED && MICROHULI_OLED
openhuli_serial::Status showCloudText(void*, const char* text) {
  if (!oledReady) return openhuli_serial::failed;
  // This callback only draws text. It never interprets text as robot commands.
  Wire.clearWireTimeoutFlag();
  Wire.beginTransmission(OLED_ADDRESS);
  if (Wire.endTransmission() != 0) return openhuli_serial::failed;
  strncpy(cloudText, text, sizeof(cloudText) - 1);
  cloudText[sizeof(cloudText) - 1] = '\0';
  // Finish all pages before acknowledging the physical I2C write.
  oled.firstPage();
  do { drawFrame(); } while (oled.nextPage());
  drawingFrame = false;
  return Wire.getWireTimeoutFlag() ? openhuli_serial::unknown : openhuli_serial::succeeded;
}
#endif

void setup() {
  Serial.begin(MICROHULI_CONNECTED ? 19200 : 115200);
#if MICROHULI_IR
  irReady = initPCIInterruptForTinyIRReceiver();
  if (!irReady) robotLog.println(F("IR unavailable; Serial control remains active"));
#endif
#if MICROHULI_OLED
  Wire.begin();
  Wire.setWireTimeout(3000, true);
  Wire.beginTransmission(OLED_ADDRESS);
  oledReady = Wire.endTransmission() == 0;
  if (oledReady) {
    oled.setI2CAddress(OLED_ADDRESS << 1);
    oled.setBusClock(400000);
    oled.begin();
  } else robotLog.println(F("OLED absent at 0x3C; continuing without display"));
#endif
#if MICROHULI_CONNECTED
  const uint32_t boot = openhuli_serial::allocateBoot();
#if MICROHULI_OLED
  static openhuli_serial::OpenHuliSerial client(Serial, boot, 0, 32, showCloudText);
#else
  static openhuli_serial::OpenHuliSerial client(Serial, boot);
#endif
  huli = &client;
#endif
  robotLog.println(F("MICROHULI_NANO ready; FL3 FR5 BL6 BR7; rear reversed; idle"));
  printHelp();
}

void loop() {
#if MICROHULI_CONNECTED
  huli->poll();
#else
  readCommands();
#endif
  const unsigned long now = millis();
#if MICROHULI_IR
  updateRemote();
#endif
  updateAction(now);
  updateServos(now);
#if MICROHULI_OLED
  updateDisplay(now);
#endif
}
