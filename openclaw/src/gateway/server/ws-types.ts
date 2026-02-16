import type { WebSocket } from "ws";
import type { ConnectParams } from "../protocol/index.js";
import type { PmosRole } from "../pmos-auth.js";

export type GatewayWsClient = {
  socket: WebSocket;
  connect: ConnectParams;
  connId: string;
  pmosRole?: PmosRole;
  pmosUserId?: string;
  pmosWorkspaceId?: string;
  presenceKey?: string;
  clientIp?: string;
};
