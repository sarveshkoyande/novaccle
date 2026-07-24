import type { FormSection, FormField } from './types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  getSchema: () => fetch('/api/schema').then((r) => json<{ sections: FormSection[] }>(r)),

  addField: (sectionId: string, data: Partial<FormField>) =>
    fetch(`/api/admin/sections/${sectionId}/fields`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => json<{ field: FormField }>(r)),

  updateField: (id: string, data: Partial<FormField>) =>
    fetch(`/api/admin/fields/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => json<{ field: FormField }>(r)),

  deleteField: (id: string) =>
    fetch(`/api/admin/fields/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: true }>(r)),
};
