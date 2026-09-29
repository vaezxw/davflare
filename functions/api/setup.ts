import { jsonResponse, textResponse } from "./_apikey";
import { authenticateBasicPrincipal } from "../_users";
import { runSetupChecks, type SetupEnv } from "./_setup";

/** GET /api/setup — Basic web session only (not API key). */
export const onRequestGet: PagesFunction<SetupEnv> = async (context) => {
  const { request, env } = context;
  const principal = await authenticateBasicPrincipal(
    request,
    env.BUCKET,
    env.WEBDAV_USERNAME,
    env.WEBDAV_PASSWORD
  );
  if (!principal || principal.role !== "admin") {
    return textResponse("Unauthorized", 401);
  }
  const result = await runSetupChecks(env, request);
  return jsonResponse(result);
};
