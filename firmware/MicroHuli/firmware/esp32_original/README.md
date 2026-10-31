# MicroHuli — legacy ESP32 reference

This preserved standalone sketch is not connected to OpenHuli. Use the main
[Nano project](../../README.md) for the OpenHuliSerial integration.

## Original features

A tiny ESP32-S3 powered quadruped robot with a personality. It walks on four
servo legs, shows expressive **RoboEyes** on an OLED display, and can flip into
an **info screen** that shows the time, live weather, and your YouTube
subscriber count. You drive it over **Bluetooth LE** (or the Serial Monitor)
with simple text commands.

| Assembled robot                                         | 3D-printed parts                                    |
| ------------------------------------------------------- | --------------------------------------------------- |
| ![Assembled MicroHuli robot](../../robot-assembled.png) | ![3D printable body parts](../../printed-parts.png) |

---

## Features

- 🦿 **4-servo walking gait** — forward, backward, strafe left/right, spin in place
- 😀 **Animated eyes** (FluxGarage RoboEyes) with moods: happy, angry, tired, curious
- 🤸 **Trick poses** — push-ups, swing, gallop, sit, stand, lie down
- 🕒 **Info screen** — clock (NTP), live weather icon + temperature (OpenWeatherMap), YouTube subscriber count
- 📡 **Bluetooth LE UART** control (Nordic UART Service) + USB Serial control

---

## Hardware

| Part                            | Notes                                                                       |
| ------------------------------- | --------------------------------------------------------------------------- |
| **ESP32-S3** dev board          | Any ESP32-S3 with BLE + WiFi                                                |
| **4× micro servos** (e.g. SG90) | One per leg, on GPIO `0, 1, 2, 3`                                           |
| **SH1106 128×64 OLED** (I²C)    | Address `0x3C`, SDA = GPIO `8`, SCL = GPIO `9`                              |
| Battery / 5 V supply            | Servos draw current — power them separately from the ESP32 logic if you can |
| 3D-printed body, legs & feet    | See the parts photo above                                                   |

### Wiring summary

```
OLED  SDA  -> GPIO 8
OLED  SCL  -> GPIO 9
OLED  VCC  -> 3V3
OLED  GND  -> GND

Servo 0 -> GPIO 0    (front-left)
Servo 1 -> GPIO 1    (front-right)
Servo 2 -> GPIO 2    (back-left)
Servo 3 -> GPIO 3    (back-right)
Servo VCC -> 5V (external supply recommended)
Servo GND -> common GND with ESP32
```

> The exact leg-to-servo mapping depends on how you assemble the body. If a
> command makes it walk backwards or crab sideways, swap the servo connectors
> or tweak the `ampScale[]` arrays in the `loop()` switch statement.

---

## Software setup

### 1. Install the Arduino IDE + ESP32 board support

- Install the **Arduino IDE** (2.x recommended).
- In _File → Preferences → Additional Boards Manager URLs_, add:
  `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
- In _Boards Manager_, install **esp32 by Espressif Systems**.
- Select your ESP32-S3 board under _Tools → Board_.

### 2. Install the required libraries

Use _Library Manager_ (Sketch → Include Library → Manage Libraries) to install:

- **ESP32Servo**
- **ArduinoJson** (v7+)
- **Adafruit GFX Library**
- **Adafruit SH110X**
- **FluxGarage RoboEyes**

(WiFi, HTTPClient, Wire, time, and the BLE libraries ship with the ESP32 core.)

### 3. Configure your secrets

Open [`MicroHuli.ino`](esp32_original.ino) and fill in the placeholders near the
top of the file:

```cpp
#define WIFI_SSID         "YOUR_WIFI_SSID"
#define WIFI_PASSWORD     "YOUR_WIFI_PASSWORD"
#define WEATHER_API_KEY   "YOUR_OPENWEATHERMAP_API_KEY"
#define WEATHER_CITY      "Rome,IT"            // City,CountryCode
#define YOUTUBE_API_KEY   "YOUR_YOUTUBE_API_KEY"
#define YOUTUBE_CHANNEL   "YOUR_YOUTUBE_CHANNEL_ID"
```

> ⚠️ **Do not commit your real keys.** Keep them out of any public repo. If you
> push this project to GitHub, consider adding a `secrets.h` to `.gitignore`.

You can also adjust the timezone here:

```cpp
#define GMT_OFFSET_SEC    3600   // base UTC offset in seconds (3600 = UTC+1)
#define DAYLIGHT_SEC      3600   // daylight-saving offset in seconds
```

### 4. Upload

Connect the board over USB, pick the correct port under _Tools → Port_, and
click **Upload**. Open the Serial Monitor at **115200 baud** to watch the logs.

---

## Getting the API keys

### 🌤️ OpenWeatherMap (weather)

1. Go to <https://openweathermap.org/> and **create a free account**.
2. After signing in, open **My profile → API keys** (or visit
   <https://home.openweathermap.org/api_keys>).
3. Copy the **default key** (or click _Generate_ to make a new one).
4. Paste it into `WEATHER_API_KEY` in the sketch.
5. Set `WEATHER_CITY` to your location in the form `City,CountryCode`
   (e.g. `London,GB`, `Rome,IT`, `Austin,US`).

> 🔑 A brand-new OpenWeatherMap key can take **a few hours to activate**. If you
> get an HTTP `401` in the Serial Monitor right after signing up, wait and try
> again later. This project uses the free **Current Weather Data** endpoint.

### ▶️ YouTube Data API v3 (subscriber count)

1. Open the **Google Cloud Console**: <https://console.cloud.google.com/>.
2. Create a new project (top bar → project dropdown → _New Project_).
3. Enable the API: go to **APIs & Services → Library**, search for
   **"YouTube Data API v3"**, and click **Enable**.
4. Create the key: **APIs & Services → Credentials → Create Credentials →
   API key**. Copy it into `YOUTUBE_API_KEY`.
5. _(Recommended)_ Click the key → **Restrict key** → under _API restrictions_
   limit it to **YouTube Data API v3** so it can't be abused elsewhere.
6. Find your **Channel ID**:
   - Sign in to YouTube → **Settings → Advanced settings**, where your channel
     ID is shown, **or**
   - Open your channel page and copy the ID from the URL
     `https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx`
     (the part starting with `UC...`).
   - Paste it into `YOUTUBE_CHANNEL`.

> 🔑 The YouTube Data API has a daily **quota** (10,000 units/day by default).
> Reading channel statistics costs ~1 unit per call, and this sketch only polls
> every 5 minutes, so you'll stay well within the free tier.

---

## Controlling the robot

Send any of the commands below either from the **Arduino Serial Monitor**
(115200 baud, newline ending) or from a **BLE UART app** on your phone.

### Connect over Bluetooth

The robot advertises as **`MicroHuli`** using the Nordic UART Service.
Use any BLE UART terminal app, for example:

- **nRF Connect** (Android / iOS)
- **Serial Bluetooth Terminal** (Android)
- **Bluefruit Connect** (iOS / Android) → _UART_ mode

Scan, connect to **MicroHuli**, open the UART/terminal view, and type a command.

### Command reference

| Command   | Action                                           |
| --------- | ------------------------------------------------ |
| `WALK`    | Walk forward                                     |
| `BACK`    | Walk backward                                    |
| `LEFT`    | Strafe / turn left                               |
| `RIGHT`   | Strafe / turn right                              |
| `SL`      | Spin left in place                               |
| `SR`      | Spin right in place                              |
| `STOP`    | Stop moving (idle)                               |
| `UP`      | Stand up (legs centered)                         |
| `DOWN`    | Lie down                                         |
| `REST`    | Rest pose, sleepy eyes, screen off               |
| `INFO`    | Sit + show clock / weather / YouTube info screen |
| `PUSHUPS` | Do push-ups (angry eyes)                         |
| `SWING`   | Swing dance                                      |
| `GALLOP`  | Gallop animation                                 |

Commands are case-insensitive. On boot the robot starts in **REST**.

---

## Info screen layout

When you send `INFO`, the OLED shows:

```
12:34      ☀         <- time (NTP) + weather icon
21C  Clear           <- temperature + condition
---------------------
▶  12345             <- YouTube subscriber count
```

Weather icons are drawn for: **clear, clouds, rain/drizzle, snow,
thunderstorm** (anything else falls back to a cloud).

---

## Tuning notes

- **Gait feel** — tweak `FREQUENCY`, `AMPLITUDE`, `off_set_walk[]`, and the
  per-mode `ampScale[]` arrays in `loop()`.
- **Smoothness of poses** — `MOVE_STEPS`, `SPEED_FACTOR`, `MAX_STEP`, `DELAY_TIME`.
- **Servo limits** — `SERVOMIN` / `SERVOMAX` clamp every write to keep servos safe.
- **Update intervals** — `WEATHER_INTERVAL` (10 min) and `YT_INTERVAL` (5 min).

---

## Troubleshooting

| Symptom                            | Likely cause / fix                                               |
| ---------------------------------- | ---------------------------------------------------------------- |
| Blank OLED                         | Check I²C wiring and address (`0x3C`), and SDA/SCL pins (8/9)    |
| `WiFi failed — continuing offline` | Wrong SSID/password, or 5 GHz-only network (ESP32 needs 2.4 GHz) |
| Weather HTTP `401`                 | API key not active yet (wait a few hours) or wrong key           |
| YouTube HTTP `403`                 | API not enabled, quota exceeded, or key restricted incorrectly   |
| Servos jitter / browns out         | Power servos from a separate 5 V supply with common ground       |
| Robot walks wrong direction        | Swap servo connectors or invert the relevant `ampScale[]` signs  |

---

## Credits

- Eyes animation: **FluxGarage RoboEyes** library
- Weather data: **OpenWeatherMap**
- Subscriber stats: **YouTube Data API v3**
