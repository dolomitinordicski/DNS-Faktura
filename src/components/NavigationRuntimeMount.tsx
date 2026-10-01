import { useLayoutEffect } from 'react';
import { initDNSNavigationRuntime } from '@dolomitinordicski/dns-shared-data/ui/navigation';

export function NavigationRuntimeMount() {
  useLayoutEffect(() => {
    const header = document.getElementById('dns-faktura-header');
    const nav = document.getElementById('dns-faktura-nav');
    if (!(header instanceof HTMLElement) || !(nav instanceof HTMLElement)) return;

    const tabs = Array.from(nav.querySelectorAll<HTMLElement>('.dns-tab[data-section]'));
    const sections = tabs
      .map((tab) => document.getElementById(tab.dataset.section ?? ''))
      .filter((section): section is HTMLElement => section instanceof HTMLElement);

    const runtime = initDNSNavigationRuntime({
      header,
      nav,
      progressTrack: document.getElementById('dns-scroll-progress'),
      progressBar: document.getElementById('dns-scroll-progress-bar'),
      sectionTabs: tabs,
      sectionElements: sections,
    });

    return () => runtime.disconnect();
  }, []);

  return null;
}
