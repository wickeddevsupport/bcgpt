import { html, nothing } from "lit";
import type { PmosConnectorsStatus } from "../controllers/pmos-connectors.ts";

export type OnboardingStep = 1 | 2 | 3;

export type OnboardingProps = {
  currentStep: OnboardingStep;
  connectorsStatus: PmosConnectorsStatus | null;
  connectorsLoading: boolean;
  modelAuthConfigured: boolean;
  agentsCount: number;
  integrationsHref: string;
  agentsHref: string;
  chatHref: string;
  // Step 1: Connect Tools
  onConnectService: (serviceId: string) => void;
  // Step 2: Choose Agents
  onSelectAgent: (agentTemplate: string) => void;
  // Step 3: Add AI Keys
  onAddApiKey: () => void;
  // Navigation
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onComplete: () => void;
};

const TOOL_SERVICES = [
  { id: "basecamp", name: "Basecamp", icon: "🏕️", description: "Project management" },
  { id: "slack", name: "Slack", icon: "💬", description: "Team messaging" },
  { id: "github", name: "GitHub", icon: "🐙", description: "Code repositories" },
  { id: "email", name: "Email", icon: "📧", description: "Email automation" },
];

const AGENT_TEMPLATES = [
  { id: "personal", name: "Personal Agent", icon: "🤖", description: "General assistant for daily tasks", selected: true },
  { id: "sales", name: "Sales Agent", icon: "🤝", description: "Lead monitoring & CRM updates", selected: false },
  { id: "pm", name: "Project Manager", icon: "📋", description: "Deadlines & status reports", selected: false },
  { id: "dev", name: "Developer Agent", icon: "💻", description: "Code reviews & GitHub", selected: false },
  { id: "support", name: "Support Agent", icon: "🎧", description: "Tickets & responses", selected: false },
];

export function renderOnboarding(props: OnboardingProps) {
  const stepTitles = ["Connect Your Tools", "Choose Your Agents", "Add Your AI Keys"];
  
  return html`
    <div class="onboarding-wizard">
      <div class="onboarding-header">
        <div class="onboarding-logo">
          <img src="/wicked-os-logo.svg" alt="Wicked OS" style="height: 40px;" />
        </div>
        <div class="onboarding-progress">
          ${[1, 2, 3].map((step) => html`
            <div class="onboarding-step-indicator ${step === props.currentStep ? 'active' : ''} ${step < props.currentStep ? 'completed' : ''}">
              <span class="step-number">${step < props.currentStep ? '✓' : step}</span>
              <span class="step-label">${stepTitles[step - 1]}</span>
            </div>
            ${step < 3 ? html`<div class="step-connector ${step < props.currentStep ? 'completed' : ''}"></div>` : nothing}
          `)}
        </div>
      </div>
      
      <div class="onboarding-content">
        ${props.currentStep === 1 ? renderStep1(props) : nothing}
        ${props.currentStep === 2 ? renderStep2(props) : nothing}
        ${props.currentStep === 3 ? renderStep3(props) : nothing}
      </div>
      
      <div class="onboarding-footer">
        ${props.currentStep > 1
          ? html`<button class="btn btn--secondary" @click=${props.onBack}>Back</button>`
          : html`<button class="btn btn--link" @click=${props.onSkip}>Skip for now</button>`
        }
        
        ${props.currentStep < 3
          ? html`<button class="btn btn--primary" @click=${props.onNext}>Next Step</button>`
          : html`<button class="btn btn--primary" @click=${props.onComplete}>Start Using Wicked OS</button>`
        }
      </div>
    </div>
  `;
}

function renderStep1(props: OnboardingProps) {
  const ops = props.connectorsStatus?.ops;
  const bcgpt = props.connectorsStatus?.bcgpt;
  
  return html`
    <div class="onboarding-step">
      <h2>Connect Your Tools</h2>
      <p class="onboarding-subtitle">Connect the services your AI team will use. You can add more later.</p>
      
      <div class="onboarding-services-grid">
        ${TOOL_SERVICES.map((service) => {
          const isConnected = service.id === 'basecamp' 
            ? ops?.reachable === true 
            : service.id === 'github' 
              ? bcgpt?.authOk === true
              : false;
          
          return html`
            <div class="onboarding-service-card ${isConnected ? 'connected' : ''}">
              <div class="service-icon">${service.icon}</div>
              <div class="service-info">
                <div class="service-name">${service.name}</div>
                <div class="service-desc">${service.description}</div>
              </div>
              ${isConnected
                ? html`<span class="chip chip-ok">Connected</span>`
                : html`<button class="btn btn--sm" @click=${() => props.onConnectService(service.id)}>Connect</button>`
              }
            </div>
          `;
        })}
      </div>
      
      <div class="onboarding-hint">
        <span class="muted">💡 Tip: You can skip this step and connect services later in the Connections tab.</span>
      </div>
    </div>
  `;
}

function renderStep2(props: OnboardingProps) {
  return html`
    <div class="onboarding-step">
      <h2>Choose Your Agents</h2>
      <p class="onboarding-subtitle">Select pre-built agents to get started. You can customize or add more later.</p>
      
      <div class="onboarding-agents-grid">
        ${AGENT_TEMPLATES.map((agent) => html`
          <label class="onboarding-agent-card ${agent.selected ? 'selected' : ''}">
            <input 
              type="checkbox" 
              ?checked=${agent.selected}
              @change=${() => props.onSelectAgent(agent.id)}
            />
            <div class="agent-icon">${agent.icon}</div>
            <div class="agent-info">
              <div class="agent-name">${agent.name}</div>
              <div class="agent-desc">${agent.description}</div>
            </div>
            <span class="agent-checkbox">${agent.selected ? '✓' : ''}</span>
          </label>
        `)}
      </div>
      
      <div class="onboarding-hint">
        <span class="muted">💡 Tip: The Personal Agent is included by default and can help with any task.</span>
      </div>
    </div>
  `;
}

function renderStep3(props: OnboardingProps) {
  return html`
    <div class="onboarding-step">
      <h2>Add Your AI Keys</h2>
      <p class="onboarding-subtitle">Bring your own API keys to power your AI team. Your keys are stored locally and never leave your workspace.</p>
      
      <div class="onboarding-keys-section">
        ${props.modelAuthConfigured
          ? html`
            <div class="callout success">
              <strong>✓ AI model configured</strong>
              <p>Your AI model is ready to use.</p>
            </div>
          `
          : html`
            <div class="onboarding-key-card">
              <div class="key-header">
                <span class="key-icon">🔑</span>
                <span class="key-name">AI Provider API Key</span>
              </div>
              <p class="key-desc">
                Add an API key from Anthropic, OpenAI, OpenRouter, or another provider.
                This enables your agents to use AI models.
              </p>
              <button class="btn btn--primary" @click=${props.onAddApiKey}>
                Add API Key
              </button>
            </div>
          `
        }
        
        <div class="onboarding-security-note">
          <h4>🔒 Your Data Stays Local</h4>
          <ul>
            <li>API keys are stored in your local config</li>
            <li>Keys are never sent to external servers</li>
            <li>You can change or remove keys anytime</li>
          </ul>
        </div>
      </div>
      
      <div class="onboarding-hint">
        <span class="muted">💡 Tip: You can skip this step if you want to set up keys later in Integrations.</span>
      </div>
    </div>
  `;
}

export default renderOnboarding;
