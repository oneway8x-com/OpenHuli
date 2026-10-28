#include "weather_core.h"
namespace openhuli::weather {
Reading decode_dht11(const Pulse* p, size_t count) {
  if (!p || count < 82 || count > 96)
    return {};
  size_t start = count;
  for (size_t i = 0; i + 81 < count; ++i)
    if (!p[i].high && p[i].micros >= 65 && p[i].micros <= 110 && p[i + 1].high &&
        p[i + 1].micros >= 65 && p[i + 1].micros <= 110) {
      start = i + 2;
      break;
    }
  if (start == count)
    return {};
  uint8_t data[5]{};
  for (size_t bit = 0; bit < 40; ++bit) {
    const auto low = p[start + bit * 2], high = p[start + bit * 2 + 1];
    if (low.high || !high.high || low.micros < 35 || low.micros > 75 || high.micros < 15 ||
        high.micros > 90)
      return {};
    data[bit / 8] = uint8_t((data[bit / 8] << 1) | (high.micros > 50));
  }
  if (uint8_t(data[0] + data[1] + data[2] + data[3]) != data[4] || data[0] > 100 || data[1] > 9 ||
      data[2] > 50 || data[3] > 9)
    return {};
  const float humidity = data[0] + data[1] * .1f, temperature = data[2] + data[3] * .1f;
  if (humidity > 100 || temperature > 50)
    return {};
  return {true, temperature, humidity};
}
} // namespace openhuli::weather
