export async function initMetaPixel() {
  try {
    const res = await fetch('/api/meta/config');
    if (!res.ok) return;
    const data = await res.json();
    const pixelId = data.pixelId;
    if (!pixelId) {
      console.log('[Meta Pixel] No Pixel ID configured.');
      return;
    }

    const w = window as any;
    if (!w.fbq) {
      w.fbq = function() {
        w.fbq.callMethod ? w.fbq.callMethod.apply(w, arguments) : w.fbq.queue.push(arguments);
      };
      w.fbq.push = w.fbq;
      w.fbq.loaded = true;
      w.fbq.version = '2.0';
      w.fbq.queue = [];
      const s = document.createElement('script');
      s.async = true;
      s.src = 'https://connect.facebook.net/en_US/fbevents.js';
      const firstScript = document.getElementsByTagName('script')[0];
      firstScript?.parentNode?.insertBefore(s, firstScript);
    }

    w.fbq('init', pixelId);
    w.fbq('track', 'PageView');
    console.log(`[Meta Pixel] Dynamic initialization success with ID: ${pixelId}`);
  } catch (error) {
    console.error('[Meta Pixel] Initialization failed:', error);
  }
}

export function trackMetaEvent(eventName: string, params?: Record<string, any>) {
  try {
    const w = window as any;
    if (w.fbq) {
      w.fbq('track', eventName, params);
      console.log(`[Meta Pixel] Tracked standard event: ${eventName}`, params);
    } else {
      console.log(`[Meta Pixel] Standard event ${eventName} queued/skipped (Pixel not loaded yet).`);
    }
  } catch (error) {
    console.error('[Meta Pixel] Client-side tracking failed:', error);
  }
}

export function trackMetaCustomEvent(eventName: string, params?: Record<string, any>) {
  try {
    const w = window as any;
    if (w.fbq) {
      w.fbq('trackCustom', eventName, params);
      console.log(`[Meta Pixel] Tracked custom event: ${eventName}`, params);
    } else {
      console.log(`[Meta Pixel] Custom event ${eventName} queued/skipped (Pixel not loaded yet).`);
    }
  } catch (error) {
    console.error('[Meta Pixel] Client-side custom tracking failed:', error);
  }
}
