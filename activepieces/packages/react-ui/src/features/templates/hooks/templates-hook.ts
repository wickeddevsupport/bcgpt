import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useDebounce } from 'use-debounce';

import { Template, TemplateType } from '@activepieces/shared';

import { templatesApi } from '../lib/templates-api';

export const templatesHooks = {
  useTemplateCategories: (enabled = true) => {
    return useQuery<string[], Error>({
      queryKey: ['template', 'categories'],
      enabled,
      queryFn: async () => {
        const result = await templatesApi.getCategories();
        const rawCategories: unknown = Array.isArray(result)
          ? result
          : (result as { value?: unknown })?.value;

        const categories = Array.isArray(rawCategories)
          ? rawCategories.filter((c): c is string => typeof c === 'string')
          : [];

        return Array.from(new Set(categories));
      },
      staleTime: 10 * 60 * 1000,
      retry: 1,
    });
  },

  useTemplate: (id: string) => {
    return useQuery<Template, Error>({
      queryKey: ['template', id],
      queryFn: () => templatesApi.getTemplate(id),
    });
  },

  useAllOfficialTemplates: (enabled = true) => {
    return useQuery<Template[], Error>({
      queryKey: ['templates', 'all'],
      enabled,
      queryFn: async () => {
        const result = await templatesApi.list({
          type: TemplateType.OFFICIAL,
        });
        return result.data;
      },
      staleTime: 5 * 60 * 1000,
    });
  },

  useTemplates: (type?: TemplateType) => {
    const [searchParams, setSearchParams] = useSearchParams();

    const search = searchParams.get('search') ?? '';
    const category = searchParams.get('category') ?? undefined;
    // Categories are only used for official templates in the current UI.
    // Leaving a category filter in the URL while browsing custom templates can
    // accidentally hide all results.
    const effectiveCategory =
      type === TemplateType.CUSTOM ? undefined : category;

    const [debouncedSearch] = useDebounce(search, 300);

    const templatesQuery = useQuery<Template[], Error>({
      queryKey: ['templates', type, debouncedSearch, effectiveCategory],
      queryFn: async () => {
        const templates = await templatesApi.list({
          type,
          search: debouncedSearch || undefined,
          category: effectiveCategory,
        });
        return templates.data;
      },
      staleTime: 5 * 60 * 1000,
      retry: 1,
    });

    const setSearch = (newSearch: string) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (newSearch) {
          params.set('search', newSearch);
        } else {
          params.delete('search');
        }
        return params;
      });
    };

    const setCategory = (newCategory: string) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (newCategory && newCategory !== 'All') {
          params.set('category', newCategory);
        } else {
          params.delete('category');
        }
        return params;
      });
    };

    return {
      templates: templatesQuery.data,
      isLoading: templatesQuery.isLoading,
      isFetching: templatesQuery.isFetching,
      isError: templatesQuery.isError,
      error: templatesQuery.error,
      refetch: templatesQuery.refetch,
      search,
      setSearch,
      category: type === TemplateType.CUSTOM ? 'All' : category || 'All',
      setCategory,
    };
  },
};
