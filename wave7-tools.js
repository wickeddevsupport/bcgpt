/**
 * Wave 7: Platform Tools
 * Multi-Tenant, Template Marketplace, Automation Library, Plugin System
 */
export function getWave7Tools() {
  return [
    {
      name: 'list_templates',
      description: 'Browse available project templates from the marketplace. Templates are pre-built project structures, recipes, agent configs, and policies that can be installed with one command.',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['project', 'recipe', 'agent', 'policy', 'all'], description: 'Template category (default: all)' },
          search: { type: 'string', description: 'Search templates by keyword' }
        }
      }
    },

    {
      name: 'create_template',
      description: 'Package your current project setup, recipes, agents, or policies as a reusable template that can be shared or re-applied.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Template name' },
          description: { type: 'string', description: 'What this template does' },
          source_type: { type: 'string', enum: ['project', 'recipe', 'agent', 'policy'], description: 'What to package as a template' },
          source_id: { type: 'string', description: 'ID of the source item to templatize' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags for discoverability' }
        },
        required: ['name', 'source_type', 'source_id']
      }
    },

    {
      name: 'install_template',
      description: 'Install a template from the marketplace into your workspace. Creates the project structure, recipes, agents, or policies defined in the template.',
      inputSchema: {
        type: 'object',
        properties: {
          template_id: { type: 'string', description: 'Template ID to install' },
          customize: { type: 'object', description: 'Override template variables, e.g. {"project_name": "My Project"}' },
          dry_run: { type: 'boolean', description: 'Preview what will be created without executing (default: false)' }
        },
        required: ['template_id']
      }
    },

    {
      name: 'list_plugins',
      description: 'List installed plugins and available plugins from the registry.',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['installed', 'available', 'all'], description: 'Filter by status (default: all)' }
        }
      }
    },

    {
      name: 'manage_plugin',
      description: 'Install, uninstall, enable, or disable a plugin. Plugins extend BCGPT with custom tools, integrations, and capabilities.',
      inputSchema: {
        type: 'object',
        properties: {
          plugin_id: { type: 'string', description: 'Plugin ID' },
          action: { type: 'string', enum: ['install', 'uninstall', 'enable', 'disable', 'configure'], description: 'Action to perform' },
          config: { type: 'object', description: 'Plugin configuration (for install or configure)' }
        },
        required: ['plugin_id', 'action']
      }
    }
  ];
}
