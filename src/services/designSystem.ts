import { DNS_DESIGN_SYSTEM } from '@dolomitinordicski/dns-shared-data/design-system';
import { initDNSInteractionRuntime } from '@dolomitinordicski/dns-shared-data/ui/interaction';
import { initDNSRevealRuntime } from '@dolomitinordicski/dns-shared-data/ui/motion';
import { initDNSPrintRuntime } from '@dolomitinordicski/dns-shared-data/ui/print';
import { initDNSToolChromeRuntime } from '@dolomitinordicski/dns-shared-data/ui/tool-chrome';
import { initDNSUIPrimitives } from '@dolomitinordicski/dns-shared-data/ui/primitives';
import { initDNSContentPatterns } from '@dolomitinordicski/dns-shared-data/ui/content-patterns';

export const DNS_FAKTURA_FOUNDATION_VERSION = DNS_DESIGN_SYSTEM.version;

const SHARED_BRAND_BASE =
  'https://dolomitinordicski.github.io/dns-shared-data/brand';

export const DNS_SHARED_WEB_LOGO_URL = `${SHARED_BRAND_BASE}/logo-web.png`;
export const DNS_SHARED_PRINT_LOGO_URL = `${SHARED_BRAND_BASE}/logo.png`;

let printRuntime: ReturnType<typeof initDNSPrintRuntime> | null = null;

function applyFakturaFoundationSemantics(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('.dns-btn-secondary').forEach((element) => {
    element.classList.add('dns-button');
    element.dataset.variant = 'secondary';
  });

  root.querySelectorAll<HTMLElement>('.dns-primary-button').forEach((element) => {
    element.classList.add('dns-button');
    element.dataset.variant = 'primary';
  });

  root.querySelectorAll<HTMLElement>('.dns-status').forEach((element) => {
    const state =
      element.classList.contains('is-error') ? 'error' :
      element.classList.contains('is-connected') ? 'synced' :
      element.classList.contains('is-pending') ? 'warning' :
      element.classList.contains('is-draft') ? 'draft' :
      element.classList.contains('is-defined') ? 'ready' :
      null;
    if (state) element.dataset.status = state;
  });
}

function observeFakturaFoundationSemantics() {
  applyFakturaFoundationSemantics();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        applyFakturaFoundationSemantics(node);
        if (node.matches('.dns-btn-secondary')) {
          node.classList.add('dns-button');
          node.dataset.variant = 'secondary';
        }
        if (node.matches('.dns-primary-button')) {
          node.classList.add('dns-button');
          node.dataset.variant = 'primary';
        }
        if (node.matches('.dns-status')) {
          applyFakturaFoundationSemantics(node.parentElement ?? node);
        }
      });
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

export function applyDNSDesignSystem() {
  initDNSUIPrimitives();
  initDNSContentPatterns();
  const root = document.documentElement;
  const {
    colors,
    typography,
    shape,
    shadow,
    motion,
    contextSelector,
    navigation,
    header,
    spacing,
    responsive,
    metrics,
    tables,
    footer,
    controls,
    cards,
  } = DNS_DESIGN_SYSTEM;

  root.style.setProperty('--color-dns-deep', colors.deep);
  root.style.setProperty('--color-dns-mid', colors.mid);
  root.style.setProperty('--color-dns-light', colors.light);
  root.style.setProperty('--color-dns-bg', colors.background);
  root.style.setProperty('--color-dns-surface', colors.surface);
  root.style.setProperty('--color-dns-muted', colors.mutedText);
  root.style.setProperty('--font-display', `"${typography.primaryFamily}", sans-serif`);
  root.style.setProperty('--font-alt', `"${typography.secondaryFamily}", sans-serif`);
  root.style.setProperty('--dns-base-font-size', `${typography.baseFontSizePx}px`);
  root.style.setProperty('--dns-section-title-size', `${typography.sectionTitlePx}px`);
  root.style.setProperty('--dns-label-size', `${typography.labelPx}px`);
  root.style.setProperty('--dns-micro-size', `${typography.microPx}px`);
  root.style.setProperty('--dns-value-size', `${typography.valuePx}px`);
  root.style.setProperty('--dns-heading-size', `${typography.headingPx}px`);
  root.style.setProperty('--dns-card-radius', `${shape.cardRadiusPx}px`);
  root.style.setProperty('--dns-control-radius', `${shape.controlRadiusPx}px`);
  root.style.setProperty('--dns-card-shadow', shadow.card);
  root.style.setProperty('--dns-header-shadow', shadow.header);
  root.style.setProperty('--dns-header-bg', header.background);
  root.style.setProperty('--dns-header-logo-height', `${header.logoHeightPx}px`);
  root.style.setProperty('--dns-header-title-size', `${header.titleSizePx}px`);
  root.style.setProperty('--dns-header-subtitle-size', `${header.subtitleSizePx}px`);
  root.style.setProperty('--dns-header-title-color', header.titleColor);
  root.style.setProperty('--dns-header-subtitle-color', header.subtitleColor);
  root.style.setProperty('--dns-page-x', `${spacing.pageXRem}rem`);
  root.style.setProperty('--dns-page-x-desktop', `${responsive.page.desktop.paddingXRem}rem`);
  root.style.setProperty('--dns-page-x-tablet', `${responsive.page.tablet.paddingXRem}rem`);
  root.style.setProperty('--dns-page-x-mobile', `${responsive.page.mobile.paddingXRem}rem`);
  root.style.setProperty('--dns-mobile-header-logo-height', `${responsive.header.mobile.logoHeightPx}px`);
  root.style.setProperty('--dns-tablet-header-logo-height', `${responsive.header.tablet.logoHeightPx}px`);
  root.style.setProperty('--dns-motion-fast', `${motion.fastMs}ms`);
  root.style.setProperty('--dns-motion-standard', `${motion.standardMs}ms`);
  root.style.setProperty('--dns-motion-easing', motion.easing);
  root.style.setProperty('--dns-context-selected-bg', contextSelector.selected.background);
  root.style.setProperty('--dns-context-selected-text', contextSelector.selected.text);
  root.style.setProperty('--dns-context-selected-border', contextSelector.selected.border);
  root.style.setProperty('--dns-context-hover-bg', contextSelector.hover.background);
  root.style.setProperty('--dns-context-hover-border', contextSelector.hover.border);
  root.style.setProperty('--dns-context-focus-color', contextSelector.focus.color);
  root.style.setProperty('--dns-context-focus-width', `${contextSelector.focus.widthPx}px`);
  root.style.setProperty('--dns-context-focus-offset', `${contextSelector.focus.offsetPx}px`);
  root.style.setProperty('--dns-tab-bg', navigation.tabs.containerBackground);
  root.style.setProperty('--dns-tab-text', navigation.tabs.textColor);
  root.style.setProperty('--dns-tab-active', navigation.tabs.activeTextColor);
  root.style.setProperty('--dns-tab-hover', navigation.tabs.hoverTextColor);
  root.style.setProperty('--dns-tab-indicator', navigation.tabs.activeIndicatorColor);
  root.style.setProperty('--dns-tab-indicator-width', `${navigation.tabs.activeIndicatorWidthPx}px`);
  root.style.setProperty('--dns-tab-size', `${navigation.tabs.fontSizePx}px`);
  root.style.setProperty('--dns-tab-weight', String(navigation.tabs.fontWeight));
  root.style.setProperty('--dns-tab-tracking', `${navigation.tabs.letterSpacingEm}em`);
  root.style.setProperty('--dns-nav-surface-bg', navigation.tabs.surfaceBackground);
  root.style.setProperty('--dns-nav-backdrop-blur', `${navigation.tabs.backdropBlurPx}px`);
  root.style.setProperty('--dns-scroll-progress-height', `${navigation.tabs.scrollProgress.heightPx}px`);
  root.style.setProperty('--dns-scroll-progress-color', navigation.tabs.scrollProgress.color);
  root.style.setProperty('--dns-scroll-progress-track', navigation.tabs.scrollProgress.track);
  root.style.setProperty('--dns-metric-accent-width', `${metrics.accentWidthPx}px`);
  root.style.setProperty('--dns-metric-value-size', `${metrics.valueSizePx}px`);
  root.style.setProperty('--dns-table-header-size', `${tables.headerSizePx}px`);
  root.style.setProperty('--dns-table-body-size', `${tables.bodySizePx}px`);
  root.style.setProperty('--dns-table-row-border', tables.rowBorder);
  root.style.setProperty('--dns-table-header-border', tables.headerBorder);
  root.style.setProperty('--dns-footer-font-size', `${footer.fontSizePx}px`);
  root.style.setProperty('--dns-control-border', controls.border);
  root.style.setProperty('--dns-card-bg', cards.background);
  root.style.setProperty('--dns-card-accent', cards.defaultAccent);

  const interaction = initDNSInteractionRuntime({
    interaction: DNS_DESIGN_SYSTEM.interaction,
    motion: DNS_DESIGN_SYSTEM.motion,
  });
  const reveal = initDNSRevealRuntime({ motion: DNS_DESIGN_SYSTEM.motion });
  const chrome = initDNSToolChromeRuntime({
    navigation: DNS_DESIGN_SYSTEM.navigation,
    responsive: DNS_DESIGN_SYSTEM.responsive,
    headerTokens: DNS_DESIGN_SYSTEM.header,
    motion: DNS_DESIGN_SYSTEM.motion,
  });
  printRuntime = initDNSPrintRuntime({ print: DNS_DESIGN_SYSTEM.print });
  const disconnectSemanticBridge = observeFakturaFoundationSemantics();

  document.body.dataset.dnsDesignVersion = DNS_DESIGN_SYSTEM.version;
  document.body.dataset.dnsDesignSource = 'package';

  return () => {
    chrome.disconnect();
    interaction.disconnect();
    reveal.disconnect();
    printRuntime?.disconnect();
    disconnectSemanticBridge();
    printRuntime = null;
  };
}

export function printDNSDocument() {
  printRuntime?.printNow();
}
