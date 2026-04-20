/**
 * NiceMatrix override of LogtoSignature.
 *
 * Upstream file renders "Powered by" + Logto SVG logo, with a MutationObserver
 * integrity guard that restores the node if anyone tries to hide/delete it.
 *
 * We only replace the visual bits:
 *  - "Powered by" text is preserved
 *  - Icon is replaced with NiceMatrix wide logo (170x64, same aspect as Logto's 52x18)
 *  - Link target is replaced with https://www.nicematrix.com
 *  - aria-label is replaced accordingly
 *
 * Everything else (styles, integrity guard, MutationObserver, interval poll)
 * is kept identical to upstream so future upstream changes merge cleanly.
 */
import { Theme } from '@logto/schemas';
import { useEffect, useRef } from 'react';

import styles from './index.module.scss';

const brandUrl = 'https://www.nicematrix.com';
const brandLogoUrl = 'https://m.nicematrix.com/branding/NiceMatrix-170x64.svg';

const guardStyleSelector = 'style[data-logto-signature-guard="true"]';

const signatureGuardStyle = `
[data-logto-signature-container="secured"][data-logto-signature-container="secured"] {
  display: block !important;
  visibility: visible !important;
  opacity: 1 !important;
}

[data-logto-signature="secured"][data-logto-signature="secured"] {
  display: flex !important;
  align-items: center !important;
  justify-content: flex-start !important;
  font-size: 14px !important;
  line-height: 1.4 !important;
  font-weight: normal !important;
  color: var(--color-neutral-variant-60) !important;
  padding: 6px 10px !important;
  text-decoration: none !important;
  opacity: 100% !important;
  direction: ltr !important;
  position: relative !important;
  inset: auto !important;
  left: auto !important;
  right: auto !important;
  top: auto !important;
  bottom: auto !important;
  transform: none !important;
  pointer-events: auto !important;
}

[data-logto-signature="secured"][data-logto-signature="secured"]:is(:hover, :active, :focus-visible) {
  opacity: 85% !important;
}

[data-logto-signature="secured"][data-logto-signature="secured"] [data-logto-signature-icon="static"] {
  display: block !important;
  height: 32px !important;
  width: auto !important;
}

[data-logto-signature-text] {
  margin-inline-end: 8px !important;
}

body.mobile [data-logto-signature="secured"][data-logto-signature="secured"] {
  color: var(--color-neutral-variant-80) !important;
  font-size: 12px !important;
  line-height: 1.4 !important;
}
`;

type Props = {
  readonly className?: string;
  readonly theme: Theme;
};

const LogtoSignature = ({ className, theme: _theme }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const { current: container } = containerRef;
    const { current: anchor } = anchorRef;

    if (!anchor) {
      return;
    }

    const ensureGuardStyle = (): { created: boolean; element: HTMLStyleElement } => {
      const existing = document.head.querySelector<HTMLStyleElement>(guardStyleSelector);

      if (existing) {
        return { created: false, element: existing };
      }

      const createdElement = document.createElement('style');
      Reflect.set(createdElement.dataset, 'logtoSignatureGuard', 'true');
      createdElement.append(signatureGuardStyle);
      document.head.append(createdElement);

      return { created: true, element: createdElement };
    };

    const { created, element: guardStyleElement } = ensureGuardStyle();

    const enforceIntegrity = () => {
      if (container) {
        container.removeAttribute('hidden');
        container.style.setProperty('display', 'block', 'important');
        container.style.setProperty('visibility', 'visible', 'important');
        container.style.setProperty('opacity', '1', 'important');
      }

      anchor.removeAttribute('hidden');

      if (styles.signature && !anchor.classList.contains(styles.signature)) {
        anchor.classList.add(styles.signature);
      }

      anchor.style.removeProperty('display');
      anchor.style.removeProperty('visibility');
      anchor.style.removeProperty('opacity');
      anchor.style.removeProperty('position');
      anchor.style.removeProperty('left');
      anchor.style.removeProperty('right');
      anchor.style.removeProperty('top');
      anchor.style.removeProperty('bottom');
      anchor.style.removeProperty('transform');
    };

    enforceIntegrity();

    const observer = new MutationObserver(() => {
      enforceIntegrity();
    });

    observer.observe(anchor, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });

    if (container) {
      observer.observe(container, {
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden'],
      });
    }

    const intervalId = window.setInterval(enforceIntegrity, 2000);

    return () => {
      observer.disconnect();
      window.clearInterval(intervalId);

      if (created) {
        guardStyleElement.remove();
      }
    };
  }, []);

  return (
    <div ref={containerRef} className={className} data-logto-signature-container="secured">
      <a
        ref={anchorRef}
        aria-label="Powered By NiceMatrix"
        className={styles.signature}
        data-logto-signature="secured"
        href={brandUrl}
        rel="noopener"
        target="_blank"
      >
        <span data-logto-signature-text className={styles.text}>
          Powered by
        </span>
        <img
          data-logto-signature-icon="static"
          className={styles.staticIcon}
          src={brandLogoUrl}
          alt="NiceMatrix"
          style={{ height: 32, width: 'auto' }}
        />
      </a>
    </div>
  );
};

export default LogtoSignature;
