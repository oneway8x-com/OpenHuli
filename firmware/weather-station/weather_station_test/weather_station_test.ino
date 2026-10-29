#include <Arduino.h>
#include <DHT.h>
#include <LiquidCrystal.h>

#include "display_state.h"

#if !defined(CONFIG_IDF_TARGET_ESP32S2)
#error "Select the LOLIN S2 Mini / ESP32-S2 board for this pin map."
#endif
#if !defined(ARDUINO_USB_CDC_ON_BOOT) || ARDUINO_USB_CDC_ON_BOOT != 1
#error "Enable USB CDC On Boot: UART RX on GPIO37 would conflict with the DHT11."
#endif
#if defined(ARDUINO_USB_MODE) && ARDUINO_USB_MODE != 0
#error "ESP32-S2 serial logging requires the native USB-OTG / TinyUSB mode."
#endif

// Outermost rows only. Numbers are GPIO labels, not physical row positions.
// RS, E, D4, D5, D6, D7; LCD RW must be wired permanently to GND.
LiquidCrystal lcd(3, 5, 7, 12, 33, 35);
#define DHT_PIN 37
#define DHT_TYPE DHT11
DHT dht(DHT_PIN, DHT_TYPE);

hardware_test::Screen previousScreen;
uint32_t lastSensorRead = 0;

void showScreen(const hardware_test::Screen& next) {
  for (uint8_t row = 0; row < 2; ++row) {
    if (memcmp(previousScreen.rows[row], next.rows[row], 16) != 0) {
      lcd.setCursor(0, row);
      lcd.print(next.rows[row]);
      memcpy(previousScreen.rows[row], next.rows[row], 17);
    }
  }
}

void setup() {
  Serial.begin(115200);
  // Never wait for Serial: the test also runs with USB power and no monitor.
  lcd.begin(16, 2);
  dht.begin();
  showScreen(hardware_test::startupScreen());
  lastSensorRead = millis(); // Startup display and sensor warm-up: 2 seconds.
  if (Serial)
    Serial.println("Weather Station: offline USB-only hardware test.");
}

void loop() {
  if (hardware_test::readDue(millis(), lastSensorRead)) {
    // Adafruit caches this transaction; temperature and humidity are paired.
    const float humidity = dht.readHumidity();
    const float temperature = dht.readTemperature();
    lastSensorRead = millis(); // Keep at least 2 seconds between transactions.
    const hardware_test::Screen screen = hardware_test::sampleScreen(temperature, humidity);
    showScreen(screen);

    if (Serial) {
      if (screen.valid) {
        Serial.printf("[%lu ms] Temperature: %.1f C; relative humidity: %.1f %%\n",
                      static_cast<unsigned long>(lastSensorRead), double(temperature),
                      double(humidity));
      } else {
        Serial.println("DHT11 ERROR: check printed sensor pin labels, DATA -> GPIO37, "
                       "VCC -> 3V3, GND and DATA pull-up to 3V3. Retrying in 2 s.");
      }
    }
  }
  delay(5);
}
