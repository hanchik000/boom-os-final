import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api';

// ---------------------------------------------------------------------------------------------
// Stage 36 -- the ONE branding source of truth for the whole frontend.
//
// Before this, the product name, the network name and the "B" wordmark were hardcoded literals
// duplicated across the sidebar, the login screen and the POS headers. They now come from the
// existing system_settings table (BRANDING_* keys), read once here and shared by every surface.
// The values are pure presentation: nothing here participates in pricing, permissions or any
// other business decision, and the defaults below are only what renders before the fetch lands
// (and if the network fails) so no screen ever shows an empty brand area.
// ---------------------------------------------------------------------------------------------

export interface Branding {
  product_name: string;
  network_name: string;
  mark: string;
  logo_url: string;
  logo_dark_url: string;
  favicon_url: string;
}

const FALLBACK: Branding = {
  product_name: 'BOOM OS',
  network_name: '',
  mark: 'B',
  logo_url: '',
  logo_dark_url: '',
  favicon_url: '',
};

interface BrandingContextValue {
  branding: Branding;
  reloadBranding: () => Promise<void>;
}

const BrandingContext = createContext<BrandingContextValue>({ branding: FALLBACK, reloadBranding: async () => undefined });

export const BrandingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [branding, setBranding] = useState<Branding>(FALLBACK);

  const reloadBranding = useCallback(async () => {
    try {
      const r = await api.getPublicBranding();
      // Only overwrite with what the server actually sent; a missing key keeps its fallback so a
      // half-configured branding row can never blank out the header.
      setBranding({ ...FALLBACK, ...(r.branding || {}) });
    } catch { /* keep the last good branding; the brand area is never left empty */ }
  }, []);

  useEffect(() => { void reloadBranding(); }, [reloadBranding]);

  // The document title is branding too, and it lives outside React's tree.
  useEffect(() => {
    const suffix = branding.network_name ? ` | ${branding.network_name}` : '';
    document.title = `${branding.product_name}${suffix}`;
  }, [branding.product_name, branding.network_name]);

  // The favicon is the one branding value that lives outside React's tree.
  useEffect(() => {
    if (!branding.favicon_url) return;
    const link = document.querySelector<HTMLLinkElement>("link[rel~='icon']") || document.createElement('link');
    link.rel = 'icon';
    link.href = branding.favicon_url;
    if (!link.parentNode) document.head.appendChild(link);
  }, [branding.favicon_url]);

  const value = useMemo(() => ({ branding, reloadBranding }), [branding, reloadBranding]);
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
};

export function useBranding(): BrandingContextValue {
  return useContext(BrandingContext);
}
