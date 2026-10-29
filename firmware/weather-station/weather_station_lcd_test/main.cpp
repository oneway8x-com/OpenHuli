#include <Arduino.h>
#include <LiquidCrystal.h>

#if !defined(CONFIG_IDF_TARGET_ESP32S2)
#error "This LCD test uses the LOLIN S2 Mini / ESP32-S2 outer-row pin map."
#endif
#if !defined(ARDUINO_USB_CDC_ON_BOOT) || ARDUINO_USB_CDC_ON_BOOT != 1
#error "Enable native USB CDC for serial diagnostics."
#endif

// LCD RS, E, D4, D5, D6, D7. RW must be permanently grounded.
LiquidCrystal lcd(3, 5, 7, 12, 33, 35);
uint32_t lastLog = 0;

void setup() {
  Serial.begin(115200);
  delay(200); // Allow the LCD's USB-powered supply to settle.
  lcd.begin(16, 2);
  lcd.setCursor(0, 0);
  lcd.print("LCD TEST        ");
  lcd.setCursor(0, 1);
  lcd.print("Hello OpenHuli!  ");
}

void loop() {
  // Keep the message visible; no Wi-Fi, DHT reads or page rotation.
  if (Serial && uint32_t(millis() - lastLog) >= 2000) {
    lastLog = millis();
    Serial.println(
        "LCD test running: [LCD TEST] [Hello OpenHuli!]. RS=3 E=5 D4=7 D5=12 D6=33 D7=35; RW=GND.");
  }
  delay(10);
}
