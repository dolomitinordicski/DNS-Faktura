import { useLayoutEffect } from 'react';
import { initDNSNavigationRuntime } from '@dolomitinordicski/dns-shared-data/ui/navigation';

export function NavigationRuntimeMount() {
  useLayoutEffect(() => {
    const header = document.getElementById('dns-faktura-header');
    const nav = document.getElementById('dns-faktura-nav');
    if (!(header instanceof HTMLElement) || !(nav instanceof HTMLElement)) return;

    const runtime = initDNSNavigationRuntime({
      header,
      nav,
      progressTrack: document.getElementById('dns-scroll-progress'),
      progressBar: document.getElementById('dns-scroll-progress-bar'),
    });

    return () => runtime.disconnect();
  }, []);

  return null;
}
