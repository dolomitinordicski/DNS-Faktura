import { useEffect, useRef } from 'react';
import {
  initDNSAccessibilityRuntime,
  type DNSAccessibilityLanguage,
} from '@dolomitinordicski/dns-shared-data/ui/accessibility';

export function AccessibilityMount({
  language,
}: {
  language: DNSAccessibilityLanguage;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<ReturnType<typeof initDNSAccessibilityRuntime> | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;
    runtimeRef.current = initDNSAccessibilityRuntime({
      mountTarget: mountRef.current,
      language,
      storageKey: 'dns-accessibility-v1',
    });
    return () => {
      runtimeRef.current?.disconnect();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    runtimeRef.current?.setLanguage(language);
  }, [language]);

  return <div ref={mountRef} className="flex items-center" />;
}
