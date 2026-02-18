import { Property } from '@activepieces/pieces-framework';
import { basecampAuth } from '../../index';
import type { BasecampGatewayAuthConnection } from './client';
import { callGatewayTool } from './gateway';
import { extractList, toInt } from './payload';

type Project = { id?: number; name?: string };
type TodoList = { id?: number; name?: string; title?: string };
type Todo = {
  id?: number;
  content?: string;
  title?: string;
  due_on?: string | null;
  completed?: boolean;
  completed_at?: string | null;
};
type TodolistGroup = { id?: number; title?: string; name?: string };
type MessageType = { id?: number; name?: string; title?: string };
type Person = { id?: number; name?: string; email_address?: string; email?: string };

export const projectDropdown = <R extends boolean>(required: R) =>
  Property.Dropdown<string, R, typeof basecampAuth>({
    auth: basecampAuth,
    displayName: 'Project',
    description: 'Select a project.',
    required,
    refreshers: ['auth'],
    options: async ({ auth }) => {
      if (!auth) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Connect Basecamp first',
        };
      }
      const projectsResult = await callGatewayTool({
        auth: auth as unknown as BasecampGatewayAuthConnection,
        toolName: 'list_projects',
        args: {},
      });
      const projects = extractList<Project>(projectsResult, 'projects');
      return {
        disabled: false,
        options: projects.map((p) => ({
          label: p.name ?? String(p.id ?? 'Unknown project'),
          value: String(p.id ?? ''),
        })),
        placeholder: projects.length ? 'Select a project' : 'No projects found',
      };
    },
  });

export const todolistDropdown = <R extends boolean>(required: R) =>
  Property.Dropdown<string, R, typeof basecampAuth>({
    auth: basecampAuth,
    displayName: 'To-do list',
    description: 'Select a to-do list within the project.',
    required,
    refreshers: ['auth', 'project'],
    options: async ({ auth, project }) => {
      if (!auth) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Connect Basecamp first',
        };
      }
      if (!project) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Select a project first',
        };
      }

      const result = await callGatewayTool({
        auth: auth as unknown as BasecampGatewayAuthConnection,
        toolName: 'list_todolists',
        args: { project: String(project), compact: true, preview_limit: 0, inlineLimit: 500 },
      });
      const lists = extractList<TodoList>(result, 'todolists');

      return {
        disabled: false,
        options: lists
          .filter((l) => l?.id != null)
          .map((l) => ({
            label: l.name ?? l.title ?? String(l.id ?? 'Unknown list'),
            value: String(l.id ?? ''),
          })),
        placeholder: lists.length ? 'Select a to-do list' : 'No to-do lists found',
      };
    },
  });

export const todoDropdown = <R extends boolean>(required: R) =>
  Property.Dropdown<string, R, typeof basecampAuth>({
    auth: basecampAuth,
    displayName: 'To-do',
    description: 'Select a to-do from the selected to-do list.',
    required,
    refreshers: ['auth', 'project', 'todolist'],
    options: async ({ auth, project, todolist }) => {
      if (!auth) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Connect Basecamp first',
        };
      }
      if (!project) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Select a project first',
        };
      }
      if (!todolist) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Select a to-do list first',
        };
      }

      const result = await callGatewayTool({
        auth: auth as unknown as BasecampGatewayAuthConnection,
        toolName: 'list_todos_for_list',
        args: {
          project: String(project),
          todolist_id: toInt(todolist, 'To-do list'),
        },
      });
      const todos = extractList<Todo>(result, 'todos');

      return {
        disabled: false,
        options: todos
          .filter((t) => t?.id != null)
          .map((t) => ({
            label:
              (t.content ?? t.title ?? String(t.id ?? 'Unknown to-do')) +
              (t.due_on ? ` (due ${t.due_on})` : '') +
              (t.completed || t.completed_at ? ' [completed]' : ''),
            value: String(t.id ?? ''),
          })),
        placeholder: todos.length ? 'Select a to-do' : 'No to-dos found',
      };
    },
  });

export const todolistGroupDropdown = <R extends boolean>(required: R) =>
  Property.Dropdown<string, R, typeof basecampAuth>({
    auth: basecampAuth,
    displayName: 'To-do list group',
    description: 'Select a group in the selected to-do list.',
    required,
    refreshers: ['auth', 'project', 'todolist'],
    options: async ({ auth, project, todolist }) => {
      if (!auth) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Connect Basecamp first',
        };
      }
      if (!project) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Select a project first',
        };
      }
      if (!todolist) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Select a to-do list first',
        };
      }

      const result = await callGatewayTool({
        auth: auth as unknown as BasecampGatewayAuthConnection,
        toolName: 'list_todolist_groups',
        args: {
          project: String(project),
          todolist_id: toInt(todolist, 'To-do list'),
        },
      });
      const groups = extractList<TodolistGroup>(result, 'groups');

      return {
        disabled: false,
        options: groups
          .filter((g) => g?.id != null)
          .map((g) => ({
            label: g.title ?? g.name ?? String(g.id ?? 'Unknown group'),
            value: String(g.id ?? ''),
          })),
        placeholder: groups.length ? 'Select a group' : 'No groups found',
      };
    },
  });

export const messageTypeDropdown = <R extends boolean>(required: R) =>
  Property.Dropdown<string, R, typeof basecampAuth>({
    auth: basecampAuth,
    displayName: 'Message type',
    description: 'Select a message type (category).',
    required,
    refreshers: ['auth', 'project'],
    options: async ({ auth, project }) => {
      if (!auth) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Connect Basecamp first',
        };
      }
      if (!project) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Select a project first',
        };
      }

      const result = await callGatewayTool({
        auth: auth as unknown as BasecampGatewayAuthConnection,
        toolName: 'list_message_types',
        args: { project: String(project) },
      });
      const types = extractList<MessageType>(result, 'types');

      return {
        disabled: false,
        options: types
          .filter((t) => t?.id != null)
          .map((t) => ({
            label: t.name ?? t.title ?? String(t.id ?? 'Unknown type'),
            value: String(t.id ?? ''),
          })),
        placeholder: types.length ? 'Select a message type' : 'No message types found',
      };
    },
  });

export const projectPeopleMultiSelectDropdown = <R extends boolean>(params: {
  required: R;
  displayName: string;
  description?: string;
}) =>
  Property.MultiSelectDropdown<number, R, typeof basecampAuth>({
    auth: basecampAuth,
    displayName: params.displayName,
    description: params.description ?? 'Select one or more people in the project.',
    required: params.required,
    refreshers: ['auth', 'project'],
    options: async ({ auth, project }) => {
      if (!auth) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Connect Basecamp first',
        };
      }
      if (!project) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Select a project first',
        };
      }

      const result = await callGatewayTool({
        auth: auth as unknown as BasecampGatewayAuthConnection,
        toolName: 'list_project_people',
        args: { project: String(project) },
      });
      const people = extractList<Person>(result, 'people');

      return {
        disabled: false,
        options: people
          .filter((p) => p?.id != null)
          .map((p) => {
            const email = p.email_address ?? p.email;
            return {
              label: email ? `${p.name ?? p.id} <${email}>` : String(p.name ?? p.id),
              value: Number(p.id),
            };
          }),
        placeholder: people.length ? 'Select people' : 'No people found',
      };
    },
  });
