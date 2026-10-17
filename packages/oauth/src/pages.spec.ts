import { describe, expect, it } from 'vitest';
import { consentPage, errorPage, signInPage } from './pages.js';

const brand = { appName: 'Acme' };
const base = { clientName: 'Claude', redirectHost: 'claude.ai', user: 'a@x.com', grants: 'read and edit entries', hidden: {}, action: '/api/oauth/authorize' };

describe('OAuth pages', () => {
  it('escapes everything it renders', () => {
    const html = consentPage(
      { appName: '<i>Acme</i>' },
      { ...base, clientName: '<b>"Evil"</b>', redirectHost: 'a&b', user: "o'neil", hidden: { state: '"><script>' } },
    );
    expect(html).not.toContain('<b>"Evil"');
    expect(html).not.toContain('"><script>');
    expect(html).not.toContain('<i>Acme</i>');
    expect(html).toContain('&lt;b&gt;&quot;Evil&quot;&lt;/b&gt;');
    expect(html).toContain('o&#39;neil');
  });

  it('shows what is granted and offers sign-in again only when a link is configured', () => {
    expect(consentPage(brand, base)).toContain('asking to read and edit entries');
    expect(consentPage(brand, base)).not.toContain('Wrong account');
    expect(consentPage(brand, { ...base, signInAgain: { label: 'Sign in with GitHub', href: '/api/auth/github' } })).toContain('/api/auth/github');
  });

  it('applies the app css', () => {
    expect(consentPage({ appName: 'A', css: 'body{background:red}' }, base)).toContain('body{background:red}');
  });

  it('shows whichever sign-in methods exist, or says there are none', () => {
    const links = [{ label: 'Sign in with GitHub', href: '/api/auth/github' }];
    expect(signInPage(brand, { clientName: 'C', links })).toContain('Sign in with GitHub');
    expect(signInPage(brand, { clientName: 'C', links: [], localAction: '/api/oauth/local-sign-in' })).toContain('Local sign-in');
    expect(signInPage(brand, { clientName: 'C', links: [] })).toContain('No sign-in method is configured');
  });

  it('renders an error page', () => {
    expect(errorPage(brand, 'Nope', 'Because <reasons>')).toContain('Because &lt;reasons&gt;');
  });
});
