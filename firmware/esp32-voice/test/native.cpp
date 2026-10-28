#include "config.example.h"
#include "voice_core.h"
#include <cassert>
#include <cstring>
#include <iostream>
#include <limits>
#include <string>
using namespace openhuli;
int main() {
  assert(!config::hardware_confirmed);
  assert(config::mic_bclk == -1 && config::mic_ws == -1 && config::mic_data == -1 &&
         config::button == -1);
  assert(!*config::wifi_ssid && !*config::device_voice_token && !*config::root_ca);
  assert(valid_id("s2-test.1"));
  assert(!valid_id(""));
  assert(!valid_id("_bad"));
  assert(!valid_id("unsafe\""));
  assert(!valid_id(std::string(65, 'x').c_str()));
  assert(pcm_sample(INT32_MAX, 16) == 32767);
  assert(pcm_sample(INT32_MIN, 16) == -32768);
  assert(pcm_sample(-1, 16) == -1);
  assert(pcm_sample(65536, 16) == 1);
  assert(pcm_sample(INT32_MAX, 8) == 32767);
  assert(pcm_sample(INT32_MIN, 8) == -32768);
  assert(pcm_sample(1, 32) == 0);
  int32_t samples[2] = {65536, -65536};
  uint8_t pcm[pcm_bytes];
  convert_pcm(samples, 2, 16, pcm);
  assert(pcm[0] == 1 && pcm[1] == 0 && pcm[2] == 255 && pcm[3] == 255);
  for (size_t i = 4; i < pcm_bytes; ++i)
    assert(pcm[i] == 0);
  uint8_t frame[frame_bytes];
  encode_frame(frame, 0x01020304, 1, 0, pcm);
  const uint8_t expected[] = {0x4f, 0x48, 1, 1, 1, 2, 3, 4,    0, 0, 0, 1,
                              0,    0,    0, 0, 0, 0, 2, 0x80, 0, 0, 0, 0};
  assert(std::memcmp(frame, expected, 24) == 0);
  char control[512];
  assert(!write_control(control, 5, Control::session, "message", "session"));
  assert(!write_control(control, sizeof(control), Control::start, "message", "turn", 0, 1));
  VoiceCore voice;
  assert(!voice.start());
  assert(!voice.commit());
  voice.connected();
  assert(!voice.start());
  assert(voice.ready());
  for (unsigned i = 0; i < 20; ++i) {
    assert(voice.start());
    assert(!voice.start());
    assert(!voice.commit());
    assert(voice.frame_sent());
    assert(voice.release());
    assert(voice.frame_sent());
    assert(voice.commit());
    assert(!voice.commit());
    assert(!voice.frame_sent());
    assert(!voice.completed());
    assert(voice.response());
    assert(!voice.response());
    assert(voice.completed());
    assert(voice.state == State::ready);
  }
  assert(voice.start());
  assert(voice.release());
  assert(!voice.commit());
  assert(voice.cancel());
  assert(!voice.commit());
  assert(voice.start());
  assert(voice.frame_sent());
  voice.disconnected();
  assert(!voice.commit());
  assert(!voice.start());
  voice.connected();
  assert(voice.ready());
  assert(voice.start());
  assert(voice.sent == 0 && voice.turn == 1);
  assert(voice.frame_sent());
  voice.fail();
  assert(!voice.commit());
  assert(!voice.frame_sent());
  voice.connected();
  assert(voice.ready());
  for (uint32_t turn = 0; turn < max_turns; ++turn) {
    assert(voice.start());
    assert(voice.cancel());
  }
  assert(!voice.start());
  voice.connected();
  assert(voice.ready());
  assert(voice.start());
  for (uint32_t i = 0; i < max_chunks; ++i)
    assert(voice.frame_sent());
  assert(!voice.frame_sent());
  assert(voice.cancel());
  ControlBuffer buffer;
  const std::string message = "{\"version\":1}";
  for (size_t split = 0; split <= message.size(); ++split) {
    assert(buffer.push(reinterpret_cast<const uint8_t*>(message.data()), split, true, false) ==
           FragmentResult::incomplete);
    assert(buffer.push(reinterpret_cast<const uint8_t*>(message.data() + split),
                       message.size() - split, false, true) == FragmentResult::complete);
    assert(std::strcmp(buffer.data(), message.c_str()) == 0);
  }
  assert(buffer.push(nullptr, 0, false, true) == FragmentResult::rejected);
  std::string maximum(max_control_bytes, 'a');
  assert(buffer.push(reinterpret_cast<const uint8_t*>(maximum.data()), maximum.size(), true,
                     true) == FragmentResult::complete);
  assert(buffer.push(reinterpret_cast<const uint8_t*>(maximum.data()), maximum.size(), true,
                     false) == FragmentResult::incomplete);
  assert(buffer.push(reinterpret_cast<const uint8_t*>("x"), 1, false, true) ==
         FragmentResult::rejected);
  assert(buffer.push(nullptr, 0, true, false) == FragmentResult::incomplete);
  assert(buffer.push(nullptr, 0, true, true) == FragmentResult::rejected);
  buffer.clear();
  MessageHistory history;
  assert(history.accept("first"));
  assert(!history.accept("first"));
  history.clear();
  for (size_t i = 0; i < 256; ++i)
    assert(history.accept(("server-" + std::to_string(i)).c_str()));
  assert(!history.accept("too-many"));
  history.clear();
  assert(history.accept("first"));
  Button button;
  button.initialize(true, 0);
  assert(!button.update(true, 100)); // Held on startup never creates a press edge.
  assert(!button.update(false, 100));
  assert(!button.update(true, 110));
  assert(!button.update(false, 120));
  assert(button.update(false, 150));
  assert(!button.down());
  button.initialize(false, UINT32_MAX - 10);
  assert(!button.update(true, UINT32_MAX - 5));
  assert(button.update(true, 25));
  auto print_control = [&](Control kind, const char* id, const char* ref, uint32_t turn = 0,
                           uint32_t stream = 0, uint32_t sequence = 0) {
    assert(write_control(control, sizeof(control), kind, id, ref, turn, stream, sequence));
    std::cout << "CONTROL " << control << '\n';
  };
  print_control(Control::session, "firmware-session", "new-session");
  print_control(Control::start, "firmware-turn", "turn-1", 1, 0x01020304);
  std::cout << "FRAME ";
  constexpr char hex[] = "0123456789abcdef";
  for (const uint8_t byte : frame)
    std::cout << hex[byte >> 4] << hex[byte & 15];
  std::cout << '\n';
  print_control(Control::commit, "firmware-commit", "turn-1", 0, 0, 0);
  print_control(Control::cancel, "firmware-cancel", "turn-1");
  std::cout << "PASS portable firmware state, bounds, conversion, 20 turns and reconnect\n";
}
