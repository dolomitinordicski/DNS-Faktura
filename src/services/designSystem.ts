import { DNS_DESIGN_SYSTEM } from '@dolomitinordicski/dns-shared-data/design-system';

export function applyDNSDesignSystem() {
  const root = document.documentElement;
  const { colors, typography, shape, shadow, motion, contextSelector, navigation } = DNS_DESIGN_SYSTEM;

  root.style.setProperty('--color-dns-deep', colors.deep);
  root.style.setProperty('--color-dns-mid', colors.mid);
  root.style.setProperty('--color-dns-light', colors.light);
  root.style.setProperty('--color-dns-bg', colors.background);
  root.style.setProperty('--color-dns-surface', colors.surface);
  root.style.setProperty('--color-dns-muted', colors.mutedText);
  root.style.setProperty('--font-display', `"${typography.primaryFamily}", sans-serif`);
  root.style.setProperty('--font-alt', `"${typography.secondaryFamily}", sans-serif`);
  root.style.setProperty('--dns-card-radius', `${shape.cardRadiusPx}px`);
  root.style.setProperty('--dns-control-radius', `${shape.controlRadiusPx}px`);
  root.style.setProperty('--dns-card-shadow', shadow.card);
  root.style.setProperty('--dns-header-shadow', shadow.header);
  root.style.setProperty('--dns-motion-fast', `${motion.fastMs}ms`);
  root.style.setProperty('--dns-motion-standard', `${motion.standardMs}ms`);
  root.style.setProperty('--dns-motion-easing', motion.easing);
  root.style.setProperty('--dns-context-selected-bg', contextSelector.selected.background);
  root.style.setProperty('--dns-context-selected-text', contextSelector.selected.text);
  root.style.setProperty('--dns-context-selected-border', contextSelector.selected.border);
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

  return DNS_DESIGN_SYSTEM;
}
