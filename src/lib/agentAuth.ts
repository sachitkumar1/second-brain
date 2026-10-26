import "server-only";
import { bearer } from "./auth";
import { safeEqual, sha256 } from "./crypto";
import { getKV } from "./settings";

/** The Mac agent authenticates with a token generated under Settings → Mac agent. Only its hash is stored. */
export async function agentAuthorized(req: Request): Promise<boolean> {
  const token = bearer(req);
  const hash = await getKV<string>("agent_token_hash");
  return !!token && !!hash && safeEqual(sha256(token), hash);
}
