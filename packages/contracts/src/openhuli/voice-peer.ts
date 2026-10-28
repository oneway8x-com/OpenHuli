import {
  OPENHULI_MAX_TURN_CHUNKS,
  parseOpenHuliAudio,
  type OpenHuliAudioFrame,
} from "./audio";
import { OpenHuliProtocolError } from "./common";
import {
  DeviceCapabilityManifestSchema,
  type DeviceCapabilityManifest,
} from "./device";
import {
  parseOpenHuliVoiceClientMessage,
  parseOpenHuliVoiceServerMessage,
  type OpenHuliVoiceMessage,
} from "./voice";

type PeerRole = "server" | "device";
type ActiveTurn = {
  id: string;
  sequence: number;
  inputStream: number;
  inputNext: number;
  committed: boolean;
  text: boolean;
  deltaChars: number;
  toolResults: number;
  outputStream?: number;
  outputNext: number;
  generated: boolean;
  played: boolean;
};

/** Connection-local wire validation only; never grants authority or dispatches a tool. */
export class OpenHuliVoicePeer {
  private readonly manifest: DeviceCapabilityManifest;
  private phase: "new" | "offered" | "ready" | "closed" = "new";
  private offeredOutput = false;
  private offeredStreaming = false;
  private streaming = false;
  private outputEnabled = false;
  private readonly messages = new Set<string>();
  private readonly turns = new Set<string>();
  private readonly streams = new Set<number>();
  private turnSequence = 0;
  private nextOutput = 0x80000000;
  private active: ActiveTurn | undefined;

  constructor(
    private readonly role: PeerRole,
    boundManifest: DeviceCapabilityManifest,
  ) {
    this.manifest = DeviceCapabilityManifestSchema.parse(boundManifest);
  }

  /** Server allocation uses the same connection-local stream history as wire validation. */
  allocateOutputStream(): number {
    this.require(
      this.role === "server" && this.phase === "ready",
      "Output allocation unavailable",
    );
    while (this.streams.has(this.nextOutput)) this.nextOutput++;
    return this.nextOutput++;
  }

  sendControl(text: string): OpenHuliVoiceMessage {
    return this.control(this.role, text);
  }

  receiveControl(text: string): OpenHuliVoiceMessage {
    return this.control(this.role === "server" ? "device" : "server", text);
  }

  sendAudio(bytes: Uint8Array): OpenHuliAudioFrame {
    return this.audio(this.role, bytes);
  }

  receiveAudio(bytes: Uint8Array): OpenHuliAudioFrame {
    return this.audio(this.role === "server" ? "device" : "server", bytes);
  }

  /** Disconnect discards uncommitted input; reconnect requires a fresh authenticated peer. */
  close(): void {
    this.phase = "closed";
    this.active = undefined;
  }

  private require(condition: unknown, message: string): asserts condition {
    if (!condition) throw new OpenHuliProtocolError(message);
  }

  private control(sender: PeerRole, text: string): OpenHuliVoiceMessage {
    const message =
      sender === "device"
        ? parseOpenHuliVoiceClientMessage(text)
        : parseOpenHuliVoiceServerMessage(text);
    this.require(this.phase !== "closed", "Session is closed");
    this.require(!this.messages.has(message.messageId), "Duplicate messageId");
    this.require(this.messages.size < 8192, "Session message limit reached");
    if (message.type === "session.error") {
      this.close();
    } else if (message.type === "session.start") {
      this.require(this.phase === "new", "Session already started");
      this.require(
        this.manifest.capabilities.some((item) => item.kind === "microphone"),
        "Microphone capability required",
      );
      this.require(
        !message.outputFormat ||
          this.manifest.capabilities.some((item) => item.kind === "speaker"),
        "Speaker capability required",
      );
      this.offeredOutput = Boolean(message.outputFormat);
      this.offeredStreaming = Boolean(message.streamingResponses);
      this.phase = "offered";
    } else if (message.type === "session.ready") {
      this.require(this.phase === "offered", "Session format was not offered");
      this.require(
        !message.outputFormat || this.offeredOutput,
        "Output format was not offered",
      );
      this.require(
        !message.streamingResponses || this.offeredStreaming,
        "Streaming was not offered",
      );
      this.streaming = Boolean(message.streamingResponses);
      this.outputEnabled = Boolean(message.outputFormat);
      this.phase = "ready";
    } else {
      this.require(this.phase === "ready", "Session is not ready");
      if (message.type === "turn.start" || message.type === "turn.text") {
        this.require(!this.active, "Another turn is active");
        this.require(this.turns.size < 256, "Session turn limit reached");
        this.require(!this.turns.has(message.turnId), "Duplicate turnId");
        this.require(
          message.turnSequence === this.turnSequence + 1,
          "Unexpected turn sequence",
        );
        if (message.type === "turn.start")
          this.require(
            !this.streams.has(message.streamId),
            "Duplicate streamId",
          );
        this.active = {
          id: message.turnId,
          sequence: message.turnSequence,
          inputStream: message.type === "turn.start" ? message.streamId : 0,
          inputNext: 0,
          committed: message.type === "turn.text",
          text: false,
          deltaChars: 0,
          toolResults: 0,
          outputNext: 0,
          generated: false,
          played: false,
        };
        this.turns.add(message.turnId);
        if (message.type === "turn.start") this.streams.add(message.streamId);
        this.turnSequence = message.turnSequence;
      } else {
        const active = this.active;
        this.require(
          active && active.id === message.turnId,
          "No matching active turn",
        );
        switch (message.type) {
          case "turn.commit":
            this.require(
              !active.committed &&
                active.inputNext > 0 &&
                message.lastSequence === active.inputNext - 1,
              "Invalid input commit",
            );
            active.committed = true;
            break;
          case "turn.cancel":
          case "turn.failed":
            this.active = undefined;
            break;
          case "response.delta":
            this.require(
              this.streaming &&
                active.committed &&
                !active.text &&
                active.deltaChars + message.text.length <= 4096,
              "Progress is out of order or too long",
            );
            active.deltaChars += message.text.length;
            break;
          case "tool.result":
            this.require(
              this.streaming &&
                active.committed &&
                !active.text &&
                active.toolResults < 16,
              "Tool progress is out of order or too long",
            );
            active.toolResults++;
            break;
          case "response.text":
            this.require(
              active.committed && !active.text,
              "Text response is out of order",
            );
            active.text = true;
            break;
          case "audio.start":
            this.require(
              active.committed &&
                this.outputEnabled &&
                active.outputStream === undefined,
              "Output audio is not allowed",
            );
            this.require(
              !this.streams.has(message.streamId),
              "Duplicate streamId",
            );
            this.streams.add(message.streamId);
            active.outputStream = message.streamId;
            break;
          case "audio.generation.completed":
            this.require(
              active.outputStream === message.streamId &&
                !active.generated &&
                active.outputNext > 0 &&
                message.lastSequence === active.outputNext - 1,
              "Invalid generation completion",
            );
            active.generated = true;
            break;
          case "playback.completed":
            this.require(
              active.generated &&
                !active.played &&
                active.outputStream === message.streamId &&
                message.lastSequence === active.outputNext - 1,
              "Invalid playback completion",
            );
            active.played = true;
            break;
          case "turn.completed":
            this.require(
              active.committed && (active.text || active.generated),
              "Turn has no response",
            );
            this.require(
              active.outputStream === undefined ||
                (active.generated && active.played),
              "Playback is not complete",
            );
            this.active = undefined;
            break;
        }
      }
    }
    this.messages.add(message.messageId);
    return message;
  }

  private audio(sender: PeerRole, bytes: Uint8Array): OpenHuliAudioFrame {
    const frame = parseOpenHuliAudio(bytes);
    const active = this.active;
    this.require(this.phase === "ready" && active, "No active audio turn");
    this.require(
      frame.turnSequence === active.sequence,
      "Audio belongs to another turn",
    );
    if (sender === "device") {
      this.require(
        frame.kind === "input" &&
          !active.committed &&
          frame.streamId === active.inputStream,
        "Input audio is not allowed",
      );
      this.require(
        frame.sequence === active.inputNext &&
          active.inputNext < OPENHULI_MAX_TURN_CHUNKS,
        "Unexpected input sequence or audio limit",
      );
      active.inputNext++;
    } else {
      this.require(
        frame.kind === "output" &&
          active.committed &&
          !active.generated &&
          frame.streamId === active.outputStream,
        "Output audio is not allowed",
      );
      this.require(
        frame.sequence === active.outputNext &&
          active.outputNext < OPENHULI_MAX_TURN_CHUNKS,
        "Unexpected output sequence or audio limit",
      );
      active.outputNext++;
    }
    return frame;
  }
}
