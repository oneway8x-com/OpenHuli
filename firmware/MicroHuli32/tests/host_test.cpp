// Run the same local-control regression suite against the real C3 sketch.
#define MICROHULI_HOST_TEST 1
#define MICROHULI_TEST_SKETCH "../../MicroHuli32/MicroHuli32.ino"
#define main runControlRegression
#include "../../MicroHuli/tests/nano_host_test.cpp"
#undef main

int failingServoPin = -1;

int main(int argc, char **argv) {
  assert(runControlRegression(argc, argv) == 0);
  assert(Serial.baud == 115200);
  assert(Serial.txTimeoutMs == 1);
  assert(Serial.output.find("MICROHULI32 ready") != std::string::npos);
  assert(Wire.sda == 0 && Wire.scl == 1 && Wire.timeoutMs == 3);
  assert(IR_RECEIVE_PIN == 10);
  const int expectedPins[] = {3, 4, 5, 6};
  for (uint8_t i = 0; i < LEG_COUNT; ++i) {
    assert(servos[i].pin == expectedPins[i]);
    assert(servos[i].frequency == 50);
    assert(servos[i].timerWidth == 14);
  }

  // A reported attach failure must release already-attached legs and cancel action.
  for (uint8_t i = 0; i < LEG_COUNT; ++i) {
    failingServoPin = SERVO_PINS[i];
    for (const char *command : {"WALK\n", "UP\n", "PUSHUPS\n"}) {
      send(command);
      tick(1000);
      assertOff();
      assert(motion == IDLE);
    }
    beginServoTest(i);
    assertOff();
    assert(motion == IDLE);
  }
  failingServoPin = -1;
  send("WALK\n");
  assert(attached && motion == WALK_FORWARD);
  send("! ");
  assertOff();
  std::cout << "PASS: C3 pin mapping, USB baud, I2C timeout, 50 Hz / 14-bit PWM and reported attach failures\n";
}
