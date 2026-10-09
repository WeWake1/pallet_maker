/**
 * Whether the app is being opened on a phone.
 *
 * The editor needs a screen that holds the form and the drawing side by side,
 * and a pointer that can hover and scroll a drawing; a phone has neither, so a
 * phone is shown a notice instead of a broken editor. A tablet is not a phone:
 * an iPad with a keyboard and trackpad is close enough to a laptop, and gets
 * the app.
 */

export interface Device {
  userAgent: string;
  /** `navigator.userAgentData.mobile`, in the browsers that have it. */
  mobileHint?: boolean | undefined;
  /** Whether the main pointer is a finger rather than a mouse or trackpad. */
  coarsePointer: boolean;
  /** The screen in CSS pixels, whichever way up it is held. */
  screenWidth: number;
  screenHeight: number;
}

/**
 * The shorter side of the largest phone, in CSS pixels, with room to spare.
 * The smallest tablets start at 600.
 */
const PHONE_SHORT_SIDE = 600;

export function isPhone(device: Device): boolean {
  // Chrome's own answer, and it already tells a phone from a tablet.
  if (device.mobileHint === true) return true;
  const agent = device.userAgent;
  if (/iPhone|iPod|Windows Phone|IEMobile|BlackBerry|Opera Mini/i.test(agent)) return true;
  // An Android tablet leaves "Mobile" out; a phone puts it in.
  if (/Android/i.test(agent) && /Mobile/i.test(agent)) return true;
  // Whatever the browser calls itself, a touch screen this small is a phone.
  return device.coarsePointer && Math.min(device.screenWidth, device.screenHeight) < PHONE_SHORT_SIDE;
}

/** The device this page is open on. */
export function thisDevice(): Device {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return {
    userAgent: nav.userAgent,
    mobileHint: nav.userAgentData?.mobile,
    coarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
  };
}
