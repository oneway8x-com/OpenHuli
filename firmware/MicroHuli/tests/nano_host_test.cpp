// Exercises the real sketch with simulated time, Serial, Servo and OLED I/O.
// These checks do not establish electrical or mechanical behavior.
#include "stubs/Arduino.h"
#include "stubs/Wire.h"
#include <cmath>
#include <iostream>
unsigned long testTime = 0;
TestSerial Serial;
TestWire Wire;
#include "../MicroHuli.ino"

void tick(unsigned long duration) {
  while (duration--) { ++testTime; loop(); }
}
void send(const std::string &command) {
  Serial.input += command;
  loop();
}
void assertOff() {
  assert(!attached);
  for (const auto &servo : servos) assert(!servo.enabled);
}

void remote(uint8_t command, uint8_t flags = 0, uint8_t address = 0) {
  TinyIRReceiverData.Address = address;
  TinyIRReceiverData.Command = command;
  TinyIRReceiverData.Flags = flags;
  TinyIRReceiverData.justWritten = true;
  loop();
}

int main(int argc, char **) {
  Wire.connected = argc > 1;
  setup();
  tick(5000);
  assertOff();
  for (const auto &servo : servos) assert(servo.writes == 0);
  assert(oledReady == Wire.connected);

  // A single fresh key-2 press starts WALK; release/loss does not stop it.
  remote(0x18, IRDATA_FLAGS_IS_REPEAT);
  remote(0x18, 0, 1);
  remote(0x18, IRDATA_FLAGS_PARITY_FAILED);
  assertOff();
  remote(0x18);
  assert(attached && motion == WALK_FORWARD && gaitLimitMs == 0);
  const unsigned long irGaitStart = motionSince;
  tick(5000); // No repeats needed; gait runs beyond the former 350 ms timeout.
  assert(attached && motion == WALK_FORWARD && motionSince == irGaitStart);
  for (const auto &servo : servos) assert(servo.enabled);
  remote(0x18, IRDATA_FLAGS_IS_REPEAT);
  assert(motionSince == irGaitStart);
  remote(0x5E, IRDATA_FLAGS_IS_REPEAT); // Stale other-key repeat cannot change gait.
  remote(0x18, 0, 1);
  remote(0x47, IRDATA_FLAGS_PARITY_FAILED);
  remote(0xFF); // Unmapped commands do not change motion.
  assert(attached && motion == WALK_FORWARD && motionSince == irGaitStart);
  remote(0x19); // An eye command has the same no-motion effect as USB Serial.
  assert(mood == HAPPY && motion == WALK_FORWARD);
  remote(0x47); // FUNC/STOP detaches without snapping to a different pose.
  float stoppedIRAngles[LEG_COUNT];
  for (uint8_t i = 0; i < LEG_COUNT; ++i) stoppedIRAngles[i] = currentPos[i];
  assertOff();
  tick(2000);
  remote(0x18, IRDATA_FLAGS_IS_REPEAT); // Repeat cannot restart after STOP.
  assertOff();
  for (uint8_t i = 0; i < LEG_COUNT; ++i) assert(currentPos[i] == stoppedIRAngles[i]);

  // All six directions are commands started once and cancelled by FUNC/STOP.
  const uint8_t directionKeys[] = {0x18, 0x5E, 0x08, 0x1C, 0x5A, 0x42};
  const Motion directions[] = {WALK_FORWARD, WALK_BACKWARD, TURN_LEFT, TURN_RIGHT,
                               SPIN_LEFT, SPIN_RIGHT};
  for (uint8_t i = 0; i < 6; ++i) {
    remote(directionKeys[i], IRDATA_FLAGS_IS_REPEAT);
    assertOff();
    remote(directionKeys[i]);
    assert(attached && motion == directions[i] && gaitLimitMs == 0);
    const unsigned long started = motionSince;
    tick(3000);
    remote(directionKeys[i], IRDATA_FLAGS_IS_REPEAT);
    assert(attached && motion == directions[i] && motionSince == started);
    remote(0x47);
    assertOff();
    remote(directionKeys[i], IRDATA_FLAGS_IS_REPEAT);
    assertOff();
  }
  remote(0x18);
  remote(0x5E); // A fresh command changes direction immediately.
  assert(attached && motion == WALK_BACKWARD);
  send("STOP\n");
  remote(0x5E, IRDATA_FLAGS_IS_REPEAT);
  assertOff();
  send("FORWARD\n");
  remote(0x47, IRDATA_FLAGS_IS_REPEAT); // STOP also cancels Serial-started movement.
  assertOff();
  remote(0x18);
  send("BACK\n");
  tick(1000);
  assert(attached && motion == WALK_BACKWARD);
  remote(0x47);
  assertOff();

  // Ziffern 0=UP, 1=DOWN, 8=REST, 9=INFO share the Serial pose semantics.
  remote(0x0C); // 1=DOWN, no longer a STOP alias.
  assert(motion == POSE && !releaseAfterPose && !infoScreen);
  assert(targetPos[0] == 180 && targetPos[1] == 0 && targetPos[2] == 180 && targetPos[3] == 0);
  tick(3000);
  assert(motion == IDLE && attached);
  remote(0x0C, IRDATA_FLAGS_IS_REPEAT);
  assert(motion == IDLE);
  remote(0x52); // 8=REST
  assert(releaseAfterPose && mood == TIRED);
  tick(3000);
  assertOff();
  remote(0x52, IRDATA_FLAGS_IS_REPEAT);
  assertOff();
  remote(0x16); // 0=UP
  tick(3000);
  assert(attached && motion == IDLE);
  for (const auto &servo : servos) assert(servo.output == 90);
  for (uint8_t key : {0x4A, 0x45}) { // 9 and POWER=INFO
    remote(key);
    assert(infoScreen && motion == POSE);
  }
  const std::string beforeHelp = Serial.output;
  remote(0x09); // UP arrow=HELP
  assert(infoScreen && motion == POSE && Serial.output.size() > beforeHelp.size());
  remote(0x07); // DOWN arrow=DEFAULT
  assert(!infoScreen && mood == NORMAL);
  remote(0x47);
  assertOff();

  const Mood eyeOrder[] = {HAPPY, ANGRY, TIRED, CURIOUS, NORMAL};
  for (Mood expected : eyeOrder) {
    remote(0x19); // EQ cycles moods exactly once per press.
    assert(mood == expected && !infoScreen);
    remote(0x19, IRDATA_FLAGS_IS_REPEAT);
    assert(mood == expected);
    assertOff();
  }
  const uint8_t trickKeys[] = {0x46, 0x15, 0x40};
  const Motion trickActions[] = {PUSHUPS, SWING, GALLOP};
  for (uint8_t i = 0; i < 3; ++i) {
    remote(trickKeys[i]);
    assert(motion == trickActions[i]);
    const unsigned long started = motionSince;
    tick(200);
    remote(trickKeys[i], IRDATA_FLAGS_IS_REPEAT);
    assert(motionSince == started && motion == trickActions[i]);
    remote(0x47);
    assertOff();
  }
  for (uint8_t key : {0x43, 0x44}) {
    remote(key); // FAST FORWARD/BACK are finite two-cycle actions.
    assert(motion == (key == 0x43 ? WALK_FORWARD : WALK_BACKWARD));
    assert(gaitLimitMs == 2 * GAIT_CYCLE_MS);
    const unsigned long started = motionSince;
    tick(100);
    remote(key, IRDATA_FLAGS_IS_REPEAT);
    assert(motionSince == started);
    tick(6000);
    assertOff();
  }
  for (uint8_t selected = 0; selected < LEG_COUNT; ++selected) {
    remote(0x0D); // ST/REPT cycles isolated FL/FR/BL/BR tests.
    assert(motion == SERVO_TEST && testLeg == selected);
    for (uint8_t i = 0; i < LEG_COUNT; ++i) assert(servos[i].enabled == (i == selected));
    const uint8_t next = nextIRTestLeg;
    tick(200);
    remote(0x0D, IRDATA_FLAGS_IS_REPEAT);
    assert(testLeg == selected && nextIRTestLeg == next);
    remote(0x47);
    assertOff();
  }
  assert(nextIRTestLeg == 0);
  send("UP\n");
  tick(3000);
  send("STOP\n");

  // Individual tests must never energize another leg and must stop on their own.
  const char *testCommands[] = {"TESTFL\n", "TESTFR\n", "TESTBL\n", "TESTBR\n"};
  for (uint8_t selected = 0; selected < LEG_COUNT; ++selected) {
    unsigned long before[LEG_COUNT];
    for (uint8_t i = 0; i < LEG_COUNT; ++i) before[i] = servos[i].writes;
    send(testCommands[selected]);
    for (uint8_t i = 0; i < LEG_COUNT; ++i) assert(servos[i].enabled == (i == selected));
    tick(10000);
    assert(attached && motion == SERVO_TEST);
    for (uint8_t i = 0; i < LEG_COUNT; ++i) assert(servos[i].enabled == (i == selected));
    tick(6000);
    assertOff();
    assert(servos[selected].output == 90);
    for (uint8_t i = 0; i < LEG_COUNT; ++i)
      assert(i == selected ? servos[i].writes > before[i] : servos[i].writes == before[i]);
  }
  send("TESTBL\n");
  tick(5000);
  send("!");
  assertOff();
  const unsigned long interruptedWrites = servos[2].writes;
  tick(20000);
  assertOff();
  assert(servos[2].writes == interruptedWrites);
  // Starting a gait during a one-leg test must re-enable all four legs.
  send("TESTFR\n");
  send("WALK\n");
  for (const auto &servo : servos) assert(servo.enabled);
  send("STOP\n");

  // A bounded step completes without another host command.
  send("f\r\n");
  tick(6000);
  assertOff();
  for (float angle : currentPos) assert(std::fabs(angle - 90) < 0.1f);

  // STOP detaches immediately without rewriting the pose or snapping to center.
  send("forward\n");
  tick(1020);
  float stoppedAngles[LEG_COUNT];
  unsigned long writeCounts[LEG_COUNT];
  for (uint8_t i = 0; i < LEG_COUNT; ++i) {
    stoppedAngles[i] = currentPos[i];
    writeCounts[i] = servos[i].writes;
  }
  send("STOP\n");
  tick(2000);
  assertOff();
  for (uint8_t i = 0; i < LEG_COUNT; ++i) {
    assert(currentPos[i] == stoppedAngles[i]);
    assert(servos[i].writes == writeCounts[i]);
  }

  // Backward reverses the phase order, rather than repeating a shifted WALK.
  send("WALK\n");
  tick(GAIT_ENTRY_MS + GAIT_CYCLE_MS / 4);
  const float forwardRear = targetPos[2];
  send("BACK\n");
  tick(GAIT_ENTRY_MS + GAIT_CYCLE_MS / 4);
  assert(forwardRear < 110 && targetPos[2] > 150);
  send("!");
  assertOff();

  // An overlong command is discarded; CRLF and lowercase commands still work.
  send("F" + std::string(40, 'x') + "\n");
  assertOff();
  send("walk\r\n");
  assert(attached && motion == WALK_FORWARD);
  send("partial!");
  assertOff();
  send("\n");
  assertOff();

  // STOP remains available during every trick and INFO, including page rendering.
  for (const char *command : {"PUSHUPS\n", "SWING\n", "GALLOP\n", "INFO\n"}) {
    send(command);
    tick(400);
    assert(attached);
    send("!");
    assertOff();
  }
  send("GALLOP\n");
  tick(12000);
  assert(motion == IDLE && attached);
  for (float angle : currentPos) assert(std::fabs(angle - 90) < 0.1f);
  send("DOWN\n");
  tick(3000);
  assert(motion == IDLE && attached);
  assert(servos[0].output == 180 && servos[2].output == 0);
  assert(servos[1].output == 0 && servos[3].output == 180);
  send("REST\n");
  tick(3000);
  assertOff();
  assert(servos[0].output == 180 && servos[2].output == 0);
  assert(servos[1].output == 0 && servos[3].output == 180);
  // Reattaching at the endpoint must not jump to the normal target limits.
  send("UP\n");
  assert(servos[0].output >= 177 && servos[2].output <= 3);
  assert(servos[1].output <= 3 && servos[3].output >= 177);
  tick(20);
  assert(servos[0].output >= 174 && servos[2].output <= 6);
  tick(3000);
  assert(motion == IDLE && attached);
  for (const auto &servo : servos) assert(servo.output == 90);
  send("STOP\n");
  assert(Wire.connected ? oled.pages > 0 : oled.pages == 0);
  std::cout << "PASS: full IR command map, single-press continuous gait/STOP/filtering, isolated servo tests, idle boot, bounded gait, STOP, reverse phase, parser, tricks, rear inversion; OLED "
            << (Wire.connected ? "present" : "absent") << '\n';
}
