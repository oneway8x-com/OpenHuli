// Standalone KY-022 test for classic Arduino Nano; no servo or OLED control.
// Receiver S/OUT -> D2, +/VCC -> 5V, -/GND -> GND. Follow module labels.
// Serial: 115200 baud. ? = help/status, c = clear received-frame counters.
#include <Arduino.h>
#define IR_RECEIVE_PIN 2
#define RAW_BUFFER_LENGTH 100
#include <IRremote.hpp>

unsigned long decodedFrames = 0;
unsigned long unknownFrames = 0;
unsigned long repeatFrames = 0;
unsigned long overflowFrames = 0;
unsigned long lastStatus = 0;

void printStatus() {
  Serial.print(F("STATUS decoded=")); Serial.print(decodedFrames);
  Serial.print(F(" unknown=")); Serial.print(unknownFrames);
  Serial.print(F(" repeats=")); Serial.print(repeatFrames);
  Serial.print(F(" overflow=")); Serial.print(overflowFrames);
  Serial.print(F(" D2="));
  Serial.println(digitalRead(IR_RECEIVE_PIN) == HIGH ? F("HIGH") : F("LOW"));
}

void printHelp() {
  Serial.println(F("KY022_TEST ready; receiver D2; 115200 baud; servo pulses OFF"));
  Serial.println(F("Press ELEGOO remote buttons one at a time; hold a button for repeats."));
  Serial.println(F("?=help/status, c=clear counters. No movement commands in this sketch."));
  printStatus();
}

void setup() {
  // Leave every servo signal as a high-impedance input; no Servo library.
  const uint8_t servoPins[] = {3, 5, 6, 7};
  for (uint8_t pin : servoPins) {
    pinMode(pin, INPUT);
    digitalWrite(pin, LOW); // Input mode: disable pull-up, do not drive signal.
  }
  Serial.begin(115200);
  IrReceiver.begin(IR_RECEIVE_PIN, ENABLE_LED_FEEDBACK);
  printHelp();
}

void loop() {
  if (IrReceiver.decode()) {
    if (IrReceiver.decodedIRData.flags & IRDATA_FLAGS_WAS_OVERFLOW) {
      ++overflowFrames;
      Serial.println(F("IR_OVERFLOW: frame too long or input noisy"));
    } else {
      if (IrReceiver.decodedIRData.protocol == UNKNOWN) ++unknownFrames;
      else ++decodedFrames;
      if (IrReceiver.decodedIRData.flags & IRDATA_FLAGS_IS_REPEAT) ++repeatFrames;
      IrReceiver.printIRResultShort(&Serial);
    }
    IrReceiver.resume();
  }
  while (Serial.available()) {
    const char c = Serial.read();
    if (c == '?') printHelp();
    else if (c == 'c' || c == 'C') {
      decodedFrames = unknownFrames = repeatFrames = overflowFrames = 0;
      Serial.println(F("Counters cleared"));
      printStatus();
    }
  }
  const unsigned long now = millis();
  if (now - lastStatus >= 3000) {
    lastStatus = now;
    printStatus();
  }
}
