import { html, nothing } from "lit";
import type { PmosConnectorsStatus } from "../controllers/pmos-connectors.ts";

export type ConnectionService = {
  id: string;
  name: string;
  icon: string;
  description: string;
  category: "productivity" | "communication" | "development" | "data" | "automation";
  configured: boolean;
  accountInfo?: string;
  status?: "connected" | "error" | "pending";
};

export type ConnectionsProps = {
  connectorsStatus: PmosConnectorsStatus | null;
  connectorsLoading: boolean;
  connectorsError: string | null;
  onRefreshConnectors: () => void;
  onConnectService: (serviceId: string) => void;
  onDisconnectService: (serviceId: string) => void;
  integrationsHref: string;
};

const AVAILABLE_SERVICES: Omit<ConnectionService, "configured" | "accountInfo" | "status">[] = [
  {
    id: "basecamp",
    name: "Basecamp",
    icon: "🏕️",
    description: "Project management and team collaboration",
    category: "productivity",
  },
  {
    id: "slack",
    name: "Slack",
    icon: "💬",
    description: "Team messaging and notifications",
    category: "communication",
  },
  {
    id: "github",
    name: "GitHub",
    icon: "🐙",
    description: "Code repositories and CI/CD",
    category: "development",
  },
  {
    id: "email",
    name: "Email (SMTP)",
    icon: "📧",
    description: "Send and receive emails",
    category: "communication",
  },
  {
    id: "google",
    name: "Google Workspace",
    icon: "🔷",
    description: "Gmail, Calendar, Drive, and more",
    category: "productivity",
  },
  {
    id: "notion",
    name: "Notion",
    icon: "📝",
    description: "Notes, docs, and knowledge base",
    category: "productivity",
  },
  {
    id: "linear",
    name: "Linear",
    icon: "📐",
    description: "Issue tracking and project management",
    category: "development",
  },
  {
    id: "jira",
    name: "Jira",
    icon: "🧭",
    description: "Issue and project tracking",
    category: "development",
  },
  {
    id: "salesforce",
    name: "Salesforce",
    icon: "☁️",
    description: "CRM and sales automation",
    category: "automation",
  },
  {
    id: "hubspot",
    name: "HubSpot",
    icon: "🧡",
    description: "Marketing, sales, and service",
    category: "automation",
  },
];

function getServiceStatus(serviceId: string, connectorsStatus: PmosConnectorsStatus | null): {
  configured: boolean;
  accountInfo?: string;
  status?: "connected" | "error" | "pending";
} {
  if (!connectorsStatus) {
    return { configured: false };
  }
  
  // Map service IDs to connector status
  if (serviceId === "ops" || serviceId === "basecamp") {
    const ops = connectorsStatus.ops;
    if (!ops?.configured) return { configured: false };
    return {
      configured: true,
      accountInfo: ops.reachable ? "Connected" : "Connection issue",
      status: ops.reachable ? "connected" : "error",
    };
  }
  
  if (serviceId === "bcgpt" || serviceId === "github") {
    const bcgpt = connectorsStatus.bcgpt;
    if (!bcgpt?.configured) return { configured: false };
    return {
      configured: true,
      accountInfo: bcgpt.authOk ? "Authenticated" : "Auth required",
      status: bcgpt.authOk ? "connected" : "error",
    };
  }
  
  // Other services not yet implemented
  return { configured: false };
}

export function renderConnections(props: ConnectionsProps) {
  const services: ConnectionService[] = AVAILABLE_SERVICES.map((service) => {
    const status = getServiceStatus(service.id, props.connectorsStatus);
    return { ...service, ...status };
  });
  
  const connectedServices = services.filter((s) => s.configured);
  const availableServices = services.filter((s) => !s.configured);
  
  return html`
    <div class="page-header">
      <div class="page-title">Connections</div>
      <div class="page-subtitle">Connect the services your AI agents will use</div>
    </div>
    
    ${props.connectorsError
      ? html`
        <div class="callout danger" style="margin-bottom: 18px;">
          <strong>Connection error:</strong> ${props.connectorsError}
          <button class="btn btn--sm" @click=${() => props.onRefreshConnectors()} ?disabled=${props.connectorsLoading}>
            Retry
          </button>
        </div>
      `
      : nothing}
    
    <!-- Connected Services -->
    <section class="card" style="margin-bottom: 18px;">
      <div class="card-title">Connected Services</div>
      <div class="card-sub">These services are available to your AI agents</div>
      
      ${
        connectedServices.length === 0
          ? html`
            <div class="muted" style="padding: 24px; text-align: center;">
              No services connected yet. Connect a service below to get started.
            </div>
          `
          : html`
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; margin-top: 16px;">
              ${connectedServices.map((service) => html`
                <div class="card" style="padding: 16px;">
                  <div class="row" style="gap: 12px; align-items: flex-start;">
                    <div style="font-size: 24px;">${service.icon}</div>
                    <div style="flex: 1;">
                      <div style="font-weight: 600;">${service.name}</div>
                      <div class="muted">${service.description}</div>
                      ${service.accountInfo
                        ? html`<div style="margin-top: 4px;"><code class="mono">${service.accountInfo}</code></div>`
                        : nothing}
                    </div>
                    <span class="chip ${service.status === "connected" ? "chip-ok" : "chip-warn"}">
                      ${service.status === "connected" ? "Connected" : "Issue"}
                    </span>
                  </div>
                  <div class="row" style="gap: 8px; margin-top: 12px;">
                    <button class="btn btn--sm" @click=${() => props.onConnectService(service.id)}>
                      Configure
                    </button>
                    <button class="btn btn--sm btn--danger" @click=${() => props.onDisconnectService(service.id)}>
                      Disconnect
                    </button>
                  </div>
                </div>
              `)}
            </div>
          `
      }
    </section>
    
    <!-- Available Services -->
    <section class="card" style="margin-bottom: 18px;">
      <div class="card-title">Available Services</div>
      <div class="card-sub">Connect services to expand your agents' capabilities. Some require setup in the Workflow Engine.</div>
      
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; margin-top: 16px;">
        ${availableServices.map((service) => {
          const isNative = service.id === 'basecamp' || service.id === 'github';
          return html`
            <div class="card" style="padding: 16px;">
              <div class="row" style="gap: 12px; align-items: flex-start;">
                <div style="font-size: 24px;">${service.icon}</div>
                <div style="flex: 1;">
                  <div style="font-weight: 600;">${service.name}</div>
                  <div class="muted">${service.description}</div>
                </div>
              </div>
              <div style="margin-top: 12px; display: flex; gap: 8px; align-items: center;">
                <button
                  class="btn btn--sm ${isNative ? 'btn--primary' : 'btn--secondary'}"
                  @click=${() => props.onConnectService(service.id)}
                  ?disabled=${!isNative}
                  title=${isNative
                    ? 'Connect this service directly'
                    : 'Available through Workflow Engine nodes'}
                >
                  ${isNative ? 'Connect' : 'Use in Workflows'}
                </button>
                ${!isNative ? html`
                  <a href="${props.integrationsHref}" class="muted" style="font-size: 11px;">
                    Setup →
                  </a>
                ` : nothing}
              </div>
            </div>
          `;
        })}
      </div>
    </section>
    
    <!-- Custom API -->
    <section class="card" style="margin-bottom: 18px;">
      <div class="card-title">Custom Integration</div>
      <div class="card-sub">Connect to any REST API with custom configuration</div>
      
      <div style="padding: 16px;">
        <div class="muted" style="margin-bottom: 12px;">
          Add a custom API connection to integrate with services not listed above.
          Your agents can use any HTTP endpoint you configure.
        </div>
        <button class="btn btn--secondary" @click=${() => props.onConnectService("custom-api")}>
          + Add Custom API
        </button>
      </div>
    </section>
  `;
}

export default renderConnections;
