#include <ESP32Servo.h>
#include <math.h>
#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>

#include <FluxGarage_RoboEyes.h>
#undef N
#undef E
#undef S
#undef W
#undef NE
#undef NW
#undef SE
#undef SW

// =====================================================
// DISPLAY
// =====================================================
#define I2C_SDA       8
#define I2C_SCL       9
#define i2c_Address   0x3c
#define SCREEN_WIDTH  128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1

Adafruit_SH1106G display = Adafruit_SH1106G(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
RoboEyes<Adafruit_SH1106G> roboEyes(display);

// =====================================================
// WIFI + TIME + WEATHER + YOUTUBE
// -----------------------------------------------------
// Fill in the placeholders below with your own values.
// See README.md for how to obtain the API keys.
// =====================================================
#define WIFI_SSID         "YOUR_WIFI_SSID"
#define WIFI_PASSWORD     "YOUR_WIFI_PASSWORD"
#define WEATHER_API_KEY   "YOUR_OPENWEATHERMAP_API_KEY"
#define WEATHER_CITY      "Rome,IT"
#define NTP_SERVER        "pool.ntp.org"
#define GMT_OFFSET_SEC    3600
#define DAYLIGHT_SEC      3600
#define YOUTUBE_API_KEY   "YOUR_YOUTUBE_API_KEY"
#define YOUTUBE_CHANNEL   "YOUR_YOUTUBE_CHANNEL_ID"

float  weatherTemp              = 0.0f;
String weatherDesc              = "";
String currentTime              = "";
long   ytSubscribers            = 0;
unsigned long lastWeatherUpdate = 0;
unsigned long lastYTUpdate      = 0;
const unsigned long WEATHER_INTERVAL = 600000;
const unsigned long YT_INTERVAL      = 300000;

void connectWiFi() {
  Serial.print("Connecting to WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 20) {
    delay(500); Serial.print("."); tries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected: " + WiFi.localIP().toString());
    configTime(GMT_OFFSET_SEC, DAYLIGHT_SEC, NTP_SERVER);
  } else {
    Serial.println("\nWiFi failed — continuing offline");
  }
}

void updateTime() {
  struct tm timeinfo;
  if (getLocalTime(&timeinfo)) {
    char buf[16];
    strftime(buf, sizeof(buf), "%H:%M", &timeinfo);
    currentTime = String(buf);
  }
}

void updateWeather() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String url = "http://api.openweathermap.org/data/2.5/weather?q="
               + String(WEATHER_CITY)
               + "&appid=" + String(WEATHER_API_KEY)
               + "&units=metric";
  http.begin(url);
  int code = http.GET();
  if (code == 200) {
    JsonDocument doc;
    deserializeJson(doc, http.getString());
    weatherTemp = doc["main"]["temp"].as<float>();
    weatherDesc = doc["weather"][0]["main"].as<String>();
    Serial.println("Weather: " + weatherDesc + " " + String(weatherTemp) + "C");
  } else {
    Serial.println("Weather HTTP error: " + String(code));
  }
  http.end();
}

void updateYouTube() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String url = "https://www.googleapis.com/youtube/v3/channels?part=statistics&id="
               + String(YOUTUBE_CHANNEL)
               + "&key=" + String(YOUTUBE_API_KEY);
  http.begin(url);
  int code = http.GET();
  if (code == 200) {
    JsonDocument doc;
    deserializeJson(doc, http.getString());
    ytSubscribers = doc["items"][0]["statistics"]["subscriberCount"].as<long>();
    Serial.println("Subscribers: " + String(ytSubscribers));
  } else {
    Serial.println("YT HTTP error: " + String(code));
  }
  http.end();
}

// =====================================================
// WEATHER ICONS
// =====================================================
void drawSun(int cx, int cy, int r) {
  display.drawCircle(cx, cy, r, SH110X_WHITE);
  for (int a = 0; a < 360; a += 45) {
    float rad = a * PI / 180.0f;
    int x1 = cx + (r + 3) * cos(rad);
    int y1 = cy + (r + 3) * sin(rad);
    int x2 = cx + (r + 7) * cos(rad);
    int y2 = cy + (r + 7) * sin(rad);
    display.drawLine(x1, y1, x2, y2, SH110X_WHITE);
  }
}

void drawCloud(int cx, int cy) {
  display.fillCircle(cx,      cy,     9, SH110X_WHITE);
  display.fillCircle(cx + 10, cy - 3, 7, SH110X_WHITE);
  display.fillCircle(cx - 9,  cy + 2, 6, SH110X_WHITE);
  display.fillRect(cx - 15, cy, 32, 10, SH110X_WHITE);
}

void drawRain(int cx, int cy) {
  drawCloud(cx, cy);
  for (int i = 0; i < 5; i++)
    display.drawLine(cx - 10 + i*6, cy+12, cx - 13 + i*6, cy+19, SH110X_WHITE);
}

void drawSnow(int cx, int cy) {
  drawCloud(cx, cy);
  for (int i = 0; i < 4; i++) {
    int sx = cx - 9 + i * 7, sy = cy + 14;
    display.drawPixel(sx,     sy,     SH110X_WHITE);
    display.drawPixel(sx - 2, sy,     SH110X_WHITE);
    display.drawPixel(sx + 2, sy,     SH110X_WHITE);
    display.drawPixel(sx,     sy - 2, SH110X_WHITE);
    display.drawPixel(sx,     sy + 2, SH110X_WHITE);
  }
}

void drawThunder(int cx, int cy) {
  drawCloud(cx, cy);
  display.drawLine(cx + 2, cy+11, cx - 4, cy+18, SH110X_WHITE);
  display.drawLine(cx - 4, cy+18, cx + 2, cy+18, SH110X_WHITE);
  display.drawLine(cx + 2, cy+18, cx - 5, cy+26, SH110X_WHITE);
}

void drawWeatherIcon(int cx, int cy) {
  String d = weatherDesc; d.toLowerCase();
  if      (d == "clear")        drawSun(cx, cy, 10);
  else if (d == "clouds")       drawCloud(cx, cy);
  else if (d == "rain" || d == "drizzle") drawRain(cx, cy);
  else if (d == "snow")         drawSnow(cx, cy);
  else if (d == "thunderstorm") drawThunder(cx, cy);
  else                          drawCloud(cx, cy);
}

// =====================================================
// INFO SCREEN
// =====================================================
void showInfoScreen() {
  updateTime();
  display.clearDisplay();
  display.setTextColor(SH110X_WHITE);

  // time — top left, large
  display.setTextSize(2);
  display.setCursor(0, 0);
  display.print(currentTime.length() > 0 ? currentTime : "--:--");

  // weather icon — top right
  drawWeatherIcon(100, 14);

  // temperature
  display.setTextSize(1);
  display.setCursor(0, 20);
  display.print(String((int)weatherTemp) + "C  " + weatherDesc);

  // divider
  display.drawLine(0, 32, 128, 32, SH110X_WHITE);

  // play triangle icon
  display.fillTriangle(2, 37, 2, 49, 11, 43, SH110X_WHITE);

  // subscriber count
  display.setTextSize(3);   // size 2 taglia i numeri a 5+ cifre, size 1 li mostra tutti
  display.setCursor(16, 42);
  display.print(String(ytSubscribers));

  display.display();
}

// =====================================================
// BLE UART
// =====================================================
#define BLE_DEVICE_NAME        "MicroHuli"
#define SERVICE_UUID           "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_RX "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_TX "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

BLECharacteristic* pTxCharacteristic;
bool   bleConnected = false;
String bleBuffer    = "";

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    bleConnected = true;
    Serial.println("BLE connected");
    roboEyes.setMood(HAPPY);
  }
  void onDisconnect(BLEServer* pServer) {
    bleConnected = false;
    Serial.println("BLE disconnected");
    pServer->startAdvertising();
  }
};

class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    String val = pCharacteristic->getValue().c_str();
    val.trim();
    if (val.length() > 0) bleBuffer = val;
  }
};

void bleSend(const char* msg) {
  if (bleConnected) {
    pTxCharacteristic->setValue(msg);
    pTxCharacteristic->notify();
  }
}

void initBLE() {
  BLEDevice::init(BLE_DEVICE_NAME);
  BLEServer* pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());
  BLEService* pService = pServer->createService(SERVICE_UUID);
  pTxCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID_TX, BLECharacteristic::PROPERTY_NOTIFY);
  pTxCharacteristic->addDescriptor(new BLE2902());
  BLECharacteristic* pRx = pService->createCharacteristic(
    CHARACTERISTIC_UUID_RX,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  pRx->setCallbacks(new RxCallbacks());
  pService->start();
  BLEAdvertising* pAdv = BLEDevice::getAdvertising();
  pAdv->addServiceUUID(SERVICE_UUID);
  pAdv->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.println("BLE advertising as: " BLE_DEVICE_NAME);
}

// =====================================================
// SERVO CONFIGURATION
// =====================================================
#define CENTER       90
#define SERVOMIN     0
#define SERVOMAX     180
#define NUM_SERVOS   4
#define DELAY_TIME   5
#define SPEED_FACTOR 0.5f
#define MAX_STEP     3
#define MOVE_STEPS   35

const int SERVO_PINS[NUM_SERVOS] = {0, 1, 2, 3};

const float FREQUENCY            = 0.005f;
const float AMPLITUDE            = 30.0f;
const float gPhase[NUM_SERVOS]       = { 0, 0, PI - PI/2, PI - PI/2 };
const float off_set_walk[NUM_SERVOS] = { -10, 10, 40, -40 };

unsigned long currentMillis = 0, oldMillis = 0, innerTime = 0;
float currentPos[NUM_SERVOS], targetPos[NUM_SERVOS];
int   lastPulse[NUM_SERVOS];

enum Mode {
  MODE_REST,
  MODE_INFO,
  MODE_IDLE,
  MODE_WALK_FORWARD,
  MODE_WALK_BACKWARD,
  MODE_WALK_LEFT,
  MODE_WALK_RIGHT,
  MODE_SPIN_LEFT,
  MODE_SPIN_RIGHT
};
Mode currentMode = MODE_REST;

Servo servos[NUM_SERVOS];

void writeServo(int i, float deg) {
  servos[i].write(constrain((int)deg, SERVOMIN, SERVOMAX));
}

void moveUntilReachedAll() {
  float startPos[NUM_SERVOS];
  for (int i = 0; i < NUM_SERVOS; i++) startPos[i] = currentPos[i];
  for (int step = 1; step <= MOVE_STEPS; step++) {
    float t = (float)step / (float)MOVE_STEPS;
    for (int i = 0; i < NUM_SERVOS; i++) {
      currentPos[i] = startPos[i] + t * (targetPos[i] - startPos[i]);
      lastPulse[i]  = (int)currentPos[i];
      writeServo(i, currentPos[i]);
    }
    roboEyes.update();
    delay(DELAY_TIME);
  }
}

void updateAllServos() {
  for (int i = 0; i < NUM_SERVOS; i++) {
    float diff = targetPos[i] - currentPos[i];
    if (fabsf(diff) > 0.5f)
      currentPos[i] += constrain(diff * SPEED_FACTOR, -(float)MAX_STEP, (float)MAX_STEP);
    writeServo(i, currentPos[i]);
  }
  delay(DELAY_TIME);
}

void syncCurrentPos() {
  for (int i = 0; i < NUM_SERVOS; i++) {
    currentPos[i] = (float)lastPulse[i];
    targetPos[i]  = (float)lastPulse[i];
  }
}

// =====================================================
// POSES
// =====================================================
void runUpSequence() {
  for (int i = 0; i < NUM_SERVOS; i++) targetPos[i] = CENTER;
  moveUntilReachedAll();
}

void runDownSequence() {
  targetPos[0] = CENTER + 90;
  targetPos[1] = CENTER - 90;
  targetPos[2] = CENTER + 90;
  targetPos[3] = CENTER - 90;
  moveUntilReachedAll();
}

void runSitSequence() {
  targetPos[0] = CENTER;
  targetPos[1] = CENTER;
  targetPos[2] = CENTER - 40;
  targetPos[3] = CENTER + 40;
  moveUntilReachedAll();
}

void runPushupsSequence() {
  roboEyes.setMood(ANGRY);
  for (int r = 0; r < 6; r++) {
    targetPos[0]=CENTER+30; targetPos[1]=CENTER-30;
    targetPos[2]=CENTER-30; targetPos[3]=CENTER+30;
    moveUntilReachedAll(); delay(150);
    targetPos[0]=CENTER; targetPos[1]=CENTER;
    targetPos[2]=CENTER; targetPos[3]=CENTER;
    moveUntilReachedAll(); delay(150);
  }
  runUpSequence();
  roboEyes.setMood(DEFAULT);
}

void runSwingSequence() {
  roboEyes.setMood(HAPPY);
  for (int i = 0; i < 4; i++) {
    targetPos[0]=CENTER+35; targetPos[1]=CENTER-0; targetPos[2]=CENTER+0; targetPos[3]=CENTER-35;
    moveUntilReachedAll(); delay(150);
    targetPos[0]=CENTER-0; targetPos[1]=CENTER-35; targetPos[2]=CENTER+35; targetPos[3]=CENTER+0;
    moveUntilReachedAll(); delay(150);
  }
  runUpSequence(); roboEyes.setMood(DEFAULT);
}

void runGallopSequence() {
  roboEyes.setMood(HAPPY);
  for (int i = 0; i < 8; i++) {
    targetPos[0]=CENTER+40; targetPos[1]=CENTER-40; targetPos[2]=CENTER-40; targetPos[3]=CENTER+40;
    moveUntilReachedAll(); delay(80);
    targetPos[0]=CENTER-40; targetPos[1]=CENTER+40; targetPos[2]=CENTER+40; targetPos[3]=CENTER-40;
    moveUntilReachedAll(); delay(80);
  }
  runUpSequence(); roboEyes.setMood(DEFAULT);
}

// =====================================================
// GAIT ENGINE
// ampScale[4]: per-servo amplitude multiplier
// forward:  { 1.0,  1.0,  1.0,  1.0}
// backward: {-1.0, -1.0, -1.0, -1.0}  ← inverted
// left:     { 0.3,  0.3,  1.5,  1.5}  ← right side drives harder
// right:    { 1.5,  1.5,  0.3,  0.3}  ← left side drives harder
// spin L:   { 1.2, -1.2,  1.2, -1.2}
// spin R:   {-1.2,  1.2, -1.2,  1.2}
// =====================================================
void runGait(const float ampScale[NUM_SERVOS]) {
  oldMillis = currentMillis; currentMillis = millis();
  innerTime += currentMillis - oldMillis;
  float t = FREQUENCY * (float)innerTime;
  for (int s = 0; s < NUM_SERVOS; s++) {
    float deg = CENTER + off_set_walk[s] + ampScale[s] * AMPLITUDE * cosf(t + gPhase[s]);
    deg = constrain(deg, SERVOMIN, SERVOMAX);
    writeServo(s, deg); lastPulse[s] = (int)deg;
  }
  delay(DELAY_TIME);
}

// =====================================================
// REST & INFO
// =====================================================
void enterRest() {
  syncCurrentPos();
  runDownSequence();
  display.clearDisplay();
  display.display();
  roboEyes.setIdleMode(OFF, 0, 0);
  roboEyes.setAutoblinker(ON, 4, 1);
  roboEyes.setMood(TIRED);
}

unsigned long infoRefreshTimer = 0;

void enterInfo() {
  syncCurrentPos();
  runSitSequence();
  display.clearDisplay();
  display.display();
  showInfoScreen();
  infoRefreshTimer = millis();
}

void updateInfo() {
  if (millis() - infoRefreshTimer > 30000) {
    updateTime();
    showInfoScreen();
    infoRefreshTimer = millis();
  }
}

// helper: restore eyes for motion modes
void wakeEyes() {
  roboEyes.setIdleMode(ON, 2, 2);
  roboEyes.setAutoblinker(ON, 3, 2);
  roboEyes.setMood(DEFAULT);
}

// =====================================================
// COMMAND HANDLER
// =====================================================
void handleCommand(String input) {
  input.trim(); input.toUpperCase();
  Serial.println(input); bleSend(input.c_str());

  if      (input == "REST")     { currentMode = MODE_REST;          enterRest();                           }
  else if (input == "INFO")     { currentMode = MODE_INFO;          enterInfo();                           }
  else if (input == "WALK")     { currentMode = MODE_WALK_FORWARD;  wakeEyes(); syncCurrentPos(); runUpSequence(); }
  else if (input == "BACK")     { currentMode = MODE_WALK_BACKWARD; wakeEyes(); syncCurrentPos(); runUpSequence(); }
  else if (input == "LEFT")     { currentMode = MODE_WALK_LEFT;     wakeEyes();                            }
  else if (input == "RIGHT")    { currentMode = MODE_WALK_RIGHT;    wakeEyes();                            }
  else if (input == "SL")       { currentMode = MODE_SPIN_LEFT;     wakeEyes();                            }
  else if (input == "SR")       { currentMode = MODE_SPIN_RIGHT;    wakeEyes();                            }
  else if (input == "STOP")     { currentMode = MODE_IDLE;          roboEyes.setMood(DEFAULT);             }
  else if (input == "PUSHUPS")  { currentMode = MODE_IDLE; syncCurrentPos(); runPushupsSequence();         }
  else if (input == "SWING")    { currentMode = MODE_IDLE; syncCurrentPos(); runSwingSequence();           }
  else if (input == "GALLOP")   { currentMode = MODE_IDLE; syncCurrentPos(); runGallopSequence();          }
  else if (input == "UP")       { currentMode = MODE_IDLE; syncCurrentPos(); runUpSequence();               }
  else if (input == "DOWN")     { currentMode = MODE_IDLE; syncCurrentPos(); runDownSequence();             }
  else { Serial.print("Unknown: "); Serial.println(input); }
}

// =====================================================
// SETUP
// =====================================================
void setup() {
  Serial.begin(115200);
  Serial.setTxTimeoutMs(0);

  Wire.begin(I2C_SDA, I2C_SCL);
  delay(250);
  display.begin(i2c_Address, true);
  roboEyes.begin(SCREEN_WIDTH, SCREEN_HEIGHT, 100);
  roboEyes.setAutoblinker(ON, 3, 2);
  roboEyes.setIdleMode(ON, 2, 2);
  roboEyes.setCuriosity(ON);

  initBLE();

  for (int i = 0; i < NUM_SERVOS; i++) {
    servos[i].attach(SERVO_PINS[i]);
    currentPos[i] = targetPos[i] = lastPulse[i] = CENTER;
    writeServo(i, CENTER);
    delay(100);
  }

  enterRest();

  connectWiFi();
  updateWeather();
  updateTime();
  updateYouTube();
  lastWeatherUpdate = millis();
  lastYTUpdate      = millis();



  Serial.println("Ready!");
}

// =====================================================
// LOOP
// =====================================================
void loop() {
  if (Serial.available() > 0) handleCommand(Serial.readStringUntil('\n'));
  if (bleBuffer.length() > 0) { handleCommand(bleBuffer); bleBuffer = ""; }

  if (millis() - lastWeatherUpdate > WEATHER_INTERVAL) { updateWeather(); lastWeatherUpdate = millis(); }
  if (millis() - lastYTUpdate      > YT_INTERVAL)      { updateYouTube(); lastYTUpdate      = millis(); }

  switch (currentMode) {
    case MODE_REST:          roboEyes.update(); break;
    case MODE_INFO:          updateInfo();      break;
    case MODE_WALK_FORWARD:  { static const float a[] = { 1.0f,  1.0f,  1.0f,  1.0f }; runGait(a); roboEyes.update(); break; }
    case MODE_WALK_BACKWARD: { static const float a[] = {-1.0f, -1.0f, -1.0f, -1.0f }; runGait(a); roboEyes.update(); break; }
    case MODE_WALK_LEFT:     { static const float a[] = { 0.3f,  0.3f,  1.5f,  1.5f }; runGait(a); roboEyes.update(); break; }
    case MODE_WALK_RIGHT:    { static const float a[] = { 1.5f,  1.5f,  0.3f,  0.3f }; runGait(a); roboEyes.update(); break; }
    case MODE_SPIN_LEFT:     { static const float a[] = { 1.2f, -1.2f,  1.2f, -1.2f }; runGait(a); roboEyes.update(); break; }
    case MODE_SPIN_RIGHT:    { static const float a[] = {-1.2f,  1.2f, -1.2f,  1.2f }; runGait(a); roboEyes.update(); break; }
    default: updateAllServos(); roboEyes.update(); break;
  }
}
