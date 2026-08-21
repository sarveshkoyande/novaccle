import { useState } from 'react';
import AdminFormsTab from '../admin/AdminFormsTab';
import AdminSectionsTab from '../admin/AdminSectionsTab';
import AdminFieldsTab from '../admin/AdminFieldsTab';
import AdminNudgesTab from '../admin/AdminNudgesTab';

type AdminTab = 'forms' | 'sections' | 'fields' | 'nudges';

// Ported from index.html's #adminTabs/showAdminTab() — 4-tab admin shell
// (Forms / Sections / Fields / Nudges), each with full drawer-based CRUD.
export default function AdminPage() {
  const [tab, setTab] = useState<AdminTab>('sections');
  const [formId, setFormId] = useState('form-default');

  function manageSections(id: string) {
    setFormId(id);
    setTab('sections');
  }

  return (
    <div className="view on">
      <div className="admin-tabs">
        <button className={tab === 'forms' ? 'on' : ''} onClick={() => setTab('forms')}>Manage forms</button>
        <button className={tab === 'sections' ? 'on' : ''} onClick={() => setTab('sections')}>Manage sections</button>
        <button className={tab === 'fields' ? 'on' : ''} onClick={() => setTab('fields')}>Manage form fields</button>
        <button className={tab === 'nudges' ? 'on' : ''} onClick={() => setTab('nudges')}>Manage nudges</button>
      </div>

      {tab === 'forms' && <AdminFormsTab onManageSections={manageSections} />}
      {tab === 'sections' && <AdminSectionsTab formId={formId} />}
      {tab === 'fields' && <AdminFieldsTab formId={formId} />}
      {tab === 'nudges' && <AdminNudgesTab />}
    </div>
  );
}
