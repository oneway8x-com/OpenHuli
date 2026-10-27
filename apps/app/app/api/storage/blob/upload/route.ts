import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { z } from "zod";
import { authorizeOwnerUpload } from "@corely/modules-identity";
import {
  getObjectStorage,
  getStorageKeyPrefix,
  getUploadTtlSeconds,
} from "@/server/object-storage";
import { getTenantContext } from "@/server/tenant-context";
import { problemFromError } from "@/server/problem-details";

const BodySchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("blob.generate-client-token"),
      payload: z
        .object({
          pathname: z.string(),
          multipart: z.boolean(),
          clientPayload: z.string().nullable(),
        })
        .passthrough(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("blob.upload-completed"),
      payload: z
        .object({
          blob: z
            .object({
              url: z.string(),
              downloadUrl: z.string(),
              pathname: z.string(),
              contentType: z.string(),
              contentDisposition: z.string(),
              etag: z.string(),
            })
            .passthrough(),
          tokenPayload: z.string().nullable().optional(),
        })
        .passthrough(),
    })
    .passthrough(),
]);
function isUploadBody(value: unknown): value is HandleUploadBody {
  return BodySchema.safeParse(value).success;
}

export async function POST(request: Request): Promise<Response> {
  try {
    // Only provider callbacks may use SDK signature verification in place of an owner session.
    let tenantId: string | undefined;
    if (!request.headers.has("x-vercel-signature"))
      ({ tenantId } = await getTenantContext(request));
    const body: unknown = await request.json();
    if (!isUploadBody(body))
      return Response.json(
        { title: "Invalid upload body", status: 400 },
        { status: 400 },
      );
    if (body.type === "blob.generate-client-token" && !tenantId)
      ({ tenantId } = await getTenantContext(request));
    const storage = getObjectStorage();
    if (storage.provider() !== "vercel_blob")
      return Response.json(
        { title: "Storage provider not enabled", status: 404 },
        { status: 404 },
      );
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!tenantId) throw new Error("Owner authorization required");
        const path = authorizeOwnerUpload(
          tenantId,
          pathname,
          getStorageKeyPrefix(),
        );
        return {
          addRandomSuffix: false,
          allowOverwrite: true,
          validUntil: Date.now() + getUploadTtlSeconds() * 1000,
          tokenPayload: JSON.stringify({ tenantId, pathname: path }),
        };
      },
      // handleUpload verifies x-vercel-signature before invoking this callback. Preserve the raw body for its signature.
      onUploadCompleted: async () => {},
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof SyntaxError)
      return Response.json(
        { title: "Invalid JSON request body", status: 400 },
        { status: 400 },
      );
    return problemFromError(error);
  }
}
