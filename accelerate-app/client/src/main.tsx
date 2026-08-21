import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './legacy-design-system.css'
import App from './App.tsx'
import { bootstrapPersistedCampaigns } from './data/requests'

// Folds server-persisted campaigns into REQUESTS before the first render —
// several pages (RequestDetailPage in particular) read REQUESTS
// synchronously during render, so a campaign created in an earlier session
// must already be in the array by the time anything reads it, not arrive
// later via a query that re-renders after the fact.
bootstrapPersistedCampaigns().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
