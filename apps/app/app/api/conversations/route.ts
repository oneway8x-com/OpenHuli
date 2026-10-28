import { consoleResponse } from "@/server/conversation-http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = (request: Request) => consoleResponse(request);
export const POST = (request: Request) => consoleResponse(request);
