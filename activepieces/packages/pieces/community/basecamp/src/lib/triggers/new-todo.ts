import dayjs from 'dayjs';
import {
  FilesService,
  Store,
  createTrigger,
  Property,
  TriggerStrategy,
} from '@activepieces/pieces-framework';
import {
  DedupeStrategy,
  Polling,
  pollingHelper,
} from '@activepieces/pieces-common';
import { gatewayPost, type BasecampGatewayAuthConnection } from '../common/client';
import { basecampAuth } from '../../index';

type TodoItem = {
  id: number;
  content?: string;
  description?: string;
  completed?: boolean;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  due_on?: string | null;
  [key: string]: unknown;
};

type TodoGroup = {
  todolistId?: number;
  todolist?: string;
  todos?: TodoItem[];
};

const polling = {
  strategy: DedupeStrategy.LAST_ITEM as const,
  items: async ({ auth, propsValue }: {
    auth: BasecampGatewayAuthConnection;
    propsValue: { project: string };
    store: Store;
    files?: FilesService;
    lastItemId: unknown;
  }) => {
    if (!auth?.props?.base_url) {
      throw new Error('Missing BCGPT base URL in connection.');
    }
    if (!auth?.props?.api_key) {
      throw new Error('Missing API key in the connection.');
    }

    const data = await gatewayPost({
      baseUrl: auth.props.base_url,
      path: '/action/list_todos_for_project',
      body: {
        project: propsValue.project,
        compact: false,
        preview_limit: 0,
        inlineLimit: 2000,
      },
      auth,
    });

    const project = data?.project ?? null;
    const groups: TodoGroup[] = data?.groups ?? data?.groups_preview ?? [];

    const todos = groups.flatMap((group) =>
      (group.todos || [])
        .filter((t) => !t?.completed && !t?.completed_at)
        .map((todo) => ({
          todo,
          todolist: group.todolist ?? null,
          todolist_id: group.todolistId ?? null,
          project,
        })),
    );

    const items = todos
      .map((row) => {
        const todo = row.todo as TodoItem;
        const timestamp =
          todo.created_at ||
          todo.updated_at ||
          todo.due_on ||
          null;
        const epochMilliSeconds = timestamp
          ? dayjs(timestamp).valueOf()
          : Date.now();
        return {
          id: `${epochMilliSeconds}-${todo.id}`,
          data: {
            ...todo,
            project: row.project,
            todolist: row.todolist,
            todolist_id: row.todolist_id,
          },
        };
      })
      .sort((a, b) => {
        // sort newest first by epoch, fallback to id to stabilize
        const epochA = Number(a.id.split('-')[0]);
        const epochB = Number(b.id.split('-')[0]);
        if (epochA === epochB) {
          return a.id > b.id ? -1 : 1;
        }
        return epochB - epochA;
      });

    return items;
  },
} satisfies Polling<BasecampGatewayAuthConnection, { project: string }>;

export const newTodoTrigger = createTrigger({
  auth: basecampAuth,
  name: 'new_todo',
  displayName: 'New Todo',
  description: 'Triggers when a new todo is created in a Basecamp project.',
  type: TriggerStrategy.POLLING,
  props: {
    project: Property.ShortText({
      displayName: 'Project',
      description: 'Project name or ID.',
      required: true,
    }),
  },
  async onEnable(context) {
    await pollingHelper.onEnable(polling, context);
  },
  async onDisable(context) {
    await pollingHelper.onDisable(polling, context);
  },
  async run(context) {
    return await pollingHelper.poll(polling, context);
  },
  async test(context) {
    return await pollingHelper.test(polling, context);
  },
  sampleData: {
    id: 123456,
    content: 'Example todo',
    description: 'Example description',
    completed: false,
    created_at: '2024-01-01T00:00:00Z',
    project: { id: 999, name: 'Example Project' },
    todolist: 'General',
    todolist_id: 888,
  },
});
