import { PRODUCT } from '../product.js';
import { Frame, invitationTokenInHash } from './SignIn.jsx';

/**
 * What a phone sees instead of the app, until there is a version made for one.
 *
 * Nothing is asked of the server first: a phone is turned away before it signs
 * in, so nobody is shown a library they cannot use. An invitation opened on a
 * phone — which is where email is often read — is told to open the same link
 * on a computer, where it still works.
 */
export function MobileNotice() {
  const invited = invitationTokenInHash(window.location.hash) !== null;
  return (
    <Frame title="Mobile version coming soon">
      <p className="mt-3 text-ui leading-relaxed text-ink-soft">
        The mobile version is being developed. Please open{' '}
        {invited ? 'this invitation link' : <span className="font-medium text-ink">{PRODUCT.site}</span>} on a
        computer.
      </p>
    </Frame>
  );
}
