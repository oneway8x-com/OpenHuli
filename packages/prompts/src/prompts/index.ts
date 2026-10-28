import { deviceAssistantPrompts } from "./device-assistant";
import { copilotPrompts } from "./copilot";
import { approvalPrompts } from "./approvals";

export const promptDefinitions = [
  ...deviceAssistantPrompts,
  ...copilotPrompts,
  ...approvalPrompts,
];
